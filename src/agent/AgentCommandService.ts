import { parseTextTransactions } from '../classification/parseTextTransactions';
import type {
  ParsedTransactionCandidate,
  TextParsingContext,
} from '../classification/types';
import { reviewDisposition } from '../domain/services/reviewDisposition';
import type {
  Account,
  Category,
  Merchant,
  Project,
  Tag,
  Transaction,
  UserRule,
} from '../domain/entities';
import { buildTextTransaction } from '../domain/services/textTransaction';
import { createId } from '../utils/createId';
import { sha256 } from '../utils/sha256';

export const AGENT_COMMAND_SCHEMA_VERSION = 1;
const SAFE_AGENT_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/u;

export class AgentCommandValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentCommandValidationError';
  }
}

export type AgentBillPreviewInput = {
  text: string;
  referenceDate?: string;
  timezoneOffsetMinutes?: number;
};

export type AgentBillPreviewContext = Omit<
  TextParsingContext,
  'referenceDate' | 'timezoneOffsetMinutes'
>;

export type AgentBillCandidate = ReturnType<typeof agentCandidate>;

export type AgentBillPreviewResult = {
  schemaVersion: typeof AGENT_COMMAND_SCHEMA_VERSION;
  command: 'bill.preview';
  referenceDate: string;
  normalizedText: string;
  candidateCount: number;
  candidates: AgentBillCandidate[];
};

export type AgentPendingBillInput = AgentBillPreviewInput & {
  callerId: string;
  idempotencyKey: string;
};

export type AgentPendingBillResult = {
  schemaVersion: typeof AGENT_COMMAND_SCHEMA_VERSION;
  command: 'bill.create-pending';
  status: 'COMMITTED' | 'ALREADY_COMMITTED' | 'CONSUMED_DELETED';
  transactions: readonly Transaction[];
};

type AgentOperationResult = {
  status: 'COMMITTED' | 'ALREADY_COMMITTED' | 'CONSUMED_DELETED';
  transactions: readonly Transaction[];
};

/** Minimal capability surface; callers never hand this service a database. */
export type AgentCommandRepositories = {
  accounts: { listAll(): Promise<Account[]> };
  agentOperations: {
    reconcile(
      callerId: string,
      idempotencyKey: string,
      payloadHash: string,
    ): Promise<AgentOperationResult | undefined>;
    commitPending(
      callerId: string,
      idempotencyKey: string,
      payloadHash: string,
      items: readonly {
        transaction: Transaction;
        tagIds: readonly string[];
      }[],
      committedAt: string,
    ): Promise<AgentOperationResult>;
  };
  categories: { listAll(): Promise<Category[]> };
  merchants: { listAll(): Promise<Merchant[]> };
  projects: { listAll(): Promise<Project[]> };
  tags: { listAll(): Promise<Tag[]> };
  userRules: { listEnabled(): Promise<UserRule[]> };
};

function referenceDateOf(value: string | undefined, now: Date): Date {
  const date = value === undefined ? new Date(now) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AgentCommandValidationError(
      'AGENT-REFERENCE-DATE-INVALID',
      'referenceDate 必须是有效日期。',
    );
  }
  return date;
}

function timezoneOffsetOf(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < -840 || value > 840) {
    throw new AgentCommandValidationError(
      'AGENT-TIMEZONE-OFFSET-INVALID',
      'timezoneOffsetMinutes 必须是 -840 到 840 之间的整数。',
    );
  }
  return value;
}

function validatedAgentIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_AGENT_IDENTIFIER.test(normalized)) {
    throw new AgentCommandValidationError(
      'AGENT-IDENTIFIER-INVALID',
      `${field} 必须是 1 到 128 位安全标识符。`,
    );
  }
  return normalized;
}

function agentCandidate(candidate: ParsedTransactionCandidate) {
  return {
    type: candidate.type,
    amountMinor: candidate.amountMinor,
    currency: candidate.currency,
    occurredAt: candidate.occurredAt,
    categoryKey: candidate.categoryKey,
    subcategoryKey: candidate.subcategoryKey,
    accountKey: candidate.accountKey,
    targetAccountKey: candidate.targetAccountKey,
    merchantRawName: candidate.merchantRawName,
    projectName: candidate.projectName,
    tags: candidate.tags,
    note: candidate.note,
    confidence: candidate.confidence,
    confidenceLevel: candidate.confidenceLevel,
    missingFields: candidate.missingFields,
    ambiguityReasons: candidate.ambiguityReasons,
    advisoryReasons: candidate.advisoryReasons ?? [],
    categoryAlternatives: candidate.categoryAlternatives,
    suggestionSource: candidate.suggestionSource,
    accountResolutionSource: candidate.accountResolutionSource,
    reviewDisposition: reviewDisposition(candidate),
    sourceText: candidate.sourceText,
  };
}

/**
 * Platform-neutral agent preview boundary. CLI and future MCP adapters must use
 * this service instead of duplicating or weakening the App parser policy.
 */
export function previewAgentBill(
  input: AgentBillPreviewInput,
  context: AgentBillPreviewContext = {},
  now: Date = new Date(),
): AgentBillPreviewResult {
  if (Number.isNaN(now.getTime())) {
    throw new Error('now 必须是有效日期。');
  }
  const referenceDate = referenceDateOf(input.referenceDate, now);
  const timezoneOffsetMinutes = timezoneOffsetOf(input.timezoneOffsetMinutes);
  const parsed = parseTextTransactions(input.text, {
    ...context,
    referenceDate,
    ...(timezoneOffsetMinutes === undefined ? {} : { timezoneOffsetMinutes }),
  });

  return {
    schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
    command: 'bill.preview',
    referenceDate: referenceDate.toISOString(),
    normalizedText: parsed.normalizedText,
    candidateCount: parsed.candidates.length,
    candidates: parsed.candidates.map(agentCandidate),
  };
}

function agentRequestHash(input: AgentPendingBillInput): string {
  return `sha256-v1:${sha256(
    JSON.stringify({
      schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
      command: 'bill.create-pending',
      callerId: input.callerId.trim(),
      idempotencyKey: input.idempotencyKey.trim(),
      text: input.text.trim(),
      referenceDate: input.referenceDate ?? null,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes ?? null,
    }),
  )}`;
}

function sourceReferenceId(
  callerId: string,
  idempotencyKey: string,
  index: number,
): string {
  return `agent:${sha256(callerId).slice(0, 16)}:${sha256(idempotencyKey).slice(0, 24)}:${index}`;
}

/**
 * Creates only PENDING ledger rows. The repository binds caller + idempotency
 * key to the request hash and commits the receipt and every transaction in one
 * SQLite transaction.
 */
export async function createPendingAgentBills(
  input: AgentPendingBillInput,
  repositories: AgentCommandRepositories,
  now: Date = new Date(),
): Promise<AgentPendingBillResult> {
  if (Number.isNaN(now.getTime())) {
    throw new Error('now 必须是有效日期。');
  }
  const normalizedInput = {
    ...input,
    callerId: validatedAgentIdentifier(input.callerId, 'callerId'),
    idempotencyKey: validatedAgentIdentifier(
      input.idempotencyKey,
      'idempotencyKey',
    ),
  };
  const payloadHash = agentRequestHash(normalizedInput);
  const reconciled = await repositories.agentOperations.reconcile(
    normalizedInput.callerId,
    normalizedInput.idempotencyKey,
    payloadHash,
  );
  if (reconciled !== undefined) {
    return {
      schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
      command: 'bill.create-pending',
      status: reconciled.status,
      transactions: reconciled.transactions,
    };
  }

  const [categories, accounts, projects, tags, userRules, merchants] =
    await Promise.all([
      repositories.categories.listAll(),
      repositories.accounts.listAll(),
      repositories.projects.listAll(),
      repositories.tags.listAll(),
      repositories.userRules.listEnabled(),
      repositories.merchants.listAll(),
    ]);
  const preview = previewAgentBill(
    normalizedInput,
    { categories, accounts, userRules, merchants },
    now,
  );
  if (preview.candidateCount === 0 || preview.candidateCount > 20) {
    throw new AgentCommandValidationError(
      'AGENT-CANDIDATE-COUNT-INVALID',
      '代理记账每次必须解析出 1 到 20 笔候选。',
    );
  }

  const nowIso = now.toISOString();
  const parsed = parseTextTransactions(normalizedInput.text, {
    referenceDate: new Date(preview.referenceDate),
    ...(normalizedInput.timezoneOffsetMinutes === undefined
      ? {}
      : { timezoneOffsetMinutes: normalizedInput.timezoneOffsetMinutes }),
    categories,
    accounts,
    userRules,
    merchants,
  });
  const items = parsed.candidates.map((candidate, index) => {
    const built = buildTextTransaction(
      candidate,
      { categories, accounts, projects, tags },
      createId('agent-pending', now.getTime() + index),
      nowIso,
      'PENDING',
      'TEXT',
    );
    return {
      tagIds: built.tagIds,
      transaction: {
        ...built.transaction,
        sourceReferenceId: sourceReferenceId(
          normalizedInput.callerId,
          normalizedInput.idempotencyKey,
          index,
        ),
      },
    };
  });
  const outcome = await repositories.agentOperations.commitPending(
    normalizedInput.callerId,
    normalizedInput.idempotencyKey,
    payloadHash,
    items,
    nowIso,
  );
  return {
    schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
    command: 'bill.create-pending',
    status: outcome.status,
    transactions: outcome.transactions,
  };
}
