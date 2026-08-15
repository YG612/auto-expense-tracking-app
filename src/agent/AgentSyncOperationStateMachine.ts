import { sha256 } from '../utils/sha256';
import {
  AGENT_SYNC_PROTOCOL_VERSION,
  AgentSyncProtocolError,
  type AgentSyncOperationReceipt,
  type AgentSyncCreateRequest,
  type AgentSyncRequestEnvelope,
  parseAgentSyncOperationReceipt,
} from './AgentSyncProtocol';

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;

export type AgentSyncOperationRecord = AgentSyncOperationReceipt & {
  revision: number;
  accountId: string;
  callerId: string;
  deviceId: string;
  idempotencyKey: string;
  payloadSha256: string;
  expiresAt: string;
  request: AgentSyncCreateRequest;
};

export type AgentSyncClaimedOperation = AgentSyncCreateRequest & {
  operationId: string;
  requestKey: string;
  idempotencyKey: string;
  expiresAt: string;
};

export type AgentSyncCreateOperationInput = {
  accountId: string;
  operationId: string;
  envelope: AgentSyncRequestEnvelope;
  now: string;
  expiresAt: string;
  existing?: AgentSyncOperationRecord;
};

export type AgentSyncCreateOperationResult = {
  disposition: 'CREATED' | 'DUPLICATE';
  record: AgentSyncOperationRecord;
  receipt: AgentSyncOperationReceipt;
};

export class AgentSyncOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentSyncOperationError';
  }
}

export function agentSyncRevisionEtag(
  record: AgentSyncOperationRecord,
): string {
  if (!Number.isSafeInteger(record.revision) || record.revision < 1) {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-INVALID-REVISION',
      'The operation revision is invalid.',
    );
  }
  return `"${String(record.revision)}"`;
}

export function parseAgentSyncRevisionEtag(value: string): number {
  const match = /^"([1-9]\d*)"$/u.exec(value.trim());
  const revision = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(revision)) {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-INVALID-REVISION',
      'If-Match must contain one strong numeric operation ETag.',
    );
  }
  return revision;
}

function identifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER.test(normalized)) {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-INVALID-IDENTIFIER',
      `${field} is invalid.`,
    );
  }
  return normalized;
}

function instant(value: string, field: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-INVALID-TIMESTAMP',
      `${field} is invalid.`,
    );
  }
  return timestamp.toISOString();
}

function expectedRevision(
  record: AgentSyncOperationRecord,
  expected: number,
): void {
  if (!Number.isSafeInteger(expected) || record.revision !== expected) {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-REVISION-CONFLICT',
      'The operation revision changed.',
    );
  }
}

function next(
  record: AgentSyncOperationRecord,
  patch: Partial<AgentSyncOperationRecord>,
  now: string,
): AgentSyncOperationRecord {
  return {
    ...record,
    ...patch,
    revision: record.revision + 1,
    updatedAt: instant(now, 'now'),
  };
}

export function toAgentSyncOperationReceipt(
  record: AgentSyncOperationRecord,
): AgentSyncOperationReceipt {
  return parseAgentSyncOperationReceipt({
    schemaVersion: record.schemaVersion,
    operationId: record.operationId,
    requestKey: record.requestKey,
    status: record.status,
    transactionIds: [...record.transactionIds],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.completedAt === undefined
      ? {}
      : { completedAt: record.completedAt }),
    ...(record.errorCode === undefined ? {} : { errorCode: record.errorCode }),
  });
}

export function toAgentSyncClaimedOperation(
  record: AgentSyncOperationRecord,
): AgentSyncClaimedOperation {
  if (record.status !== 'CLAIMED') {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-INVALID-TRANSITION',
      'Only a claimed operation can expose its app command.',
    );
  }
  return {
    ...record.request,
    operationId: record.operationId,
    requestKey: record.requestKey,
    idempotencyKey: record.idempotencyKey,
    expiresAt: record.expiresAt,
  };
}

export function createAgentSyncOperation(
  input: AgentSyncCreateOperationInput,
): AgentSyncCreateOperationResult {
  const accountId = identifier(input.accountId, 'accountId');
  const operationId = identifier(input.operationId, 'operationId');
  const idempotencyKey = identifier(
    input.envelope.headers['Idempotency-Key'],
    'idempotencyKey',
  );
  const payloadSha256 = input.envelope.headers['X-QingJi-Payload-SHA256'];
  if (
    !SHA256_HEX.test(payloadSha256) ||
    payloadSha256 !== sha256(JSON.stringify(input.envelope.body))
  ) {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-PAYLOAD-HASH-MISMATCH',
      'The payload fingerprint does not match the body.',
    );
  }
  const now = instant(input.now, 'now');
  const expiresAt = instant(input.expiresAt, 'expiresAt');
  if (new Date(expiresAt).getTime() <= new Date(now).getTime()) {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-INVALID-EXPIRY',
      'expiresAt must be after now.',
    );
  }

  const existing = input.existing;
  if (existing !== undefined) {
    if (
      existing.accountId !== accountId ||
      existing.callerId !== input.envelope.body.callerId ||
      existing.idempotencyKey !== idempotencyKey
    ) {
      throw new AgentSyncOperationError(
        'AGENT-SYNC-IDEMPOTENCY-SCOPE-MISMATCH',
        'The existing operation does not belong to this idempotency scope.',
      );
    }
    if (existing.payloadSha256 !== payloadSha256) {
      throw new AgentSyncOperationError(
        'AGENT-SYNC-IDEMPOTENCY-PAYLOAD-MISMATCH',
        'The idempotency key was already used for another payload.',
      );
    }
    return {
      disposition: 'DUPLICATE',
      record: existing,
      receipt: toAgentSyncOperationReceipt(existing),
    };
  }

  const requestKey = sha256(
    JSON.stringify({
      accountId,
      callerId: input.envelope.body.callerId,
      idempotencyKey,
      payloadSha256,
    }),
  );
  const record: AgentSyncOperationRecord = {
    schemaVersion: AGENT_SYNC_PROTOCOL_VERSION,
    operationId,
    requestKey,
    status: 'QUEUED',
    transactionIds: [],
    createdAt: now,
    updatedAt: now,
    revision: 1,
    accountId,
    callerId: input.envelope.body.callerId,
    deviceId: input.envelope.body.deviceId,
    idempotencyKey,
    payloadSha256,
    expiresAt,
    request: { ...input.envelope.body },
  };
  return {
    disposition: 'CREATED',
    record,
    receipt: toAgentSyncOperationReceipt(record),
  };
}

export function claimAgentSyncOperation(
  record: AgentSyncOperationRecord,
  expected: number,
  now: string,
): AgentSyncOperationRecord {
  expectedRevision(record, expected);
  if (record.status !== 'QUEUED') {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-INVALID-TRANSITION',
      'Only a queued operation can be claimed.',
    );
  }
  if (new Date(now).getTime() >= new Date(record.expiresAt).getTime()) {
    return expireAgentSyncOperation(record, expected, now);
  }
  return next(record, { status: 'CLAIMED' }, now);
}

export function completeAgentSyncOperation(
  record: AgentSyncOperationRecord,
  expected: number,
  now: string,
  result:
    | { status: 'COMMITTED' | 'ALREADY_COMMITTED'; transactionIds: string[] }
    | { status: 'REJECTED'; errorCode: string },
): AgentSyncOperationRecord {
  expectedRevision(record, expected);
  if (record.status !== 'CLAIMED') {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-INVALID-TRANSITION',
      'Only a claimed operation can be completed.',
    );
  }
  const completedAt = instant(now, 'now');
  if (result.status === 'REJECTED') {
    return next(
      record,
      {
        status: 'REJECTED',
        transactionIds: [],
        completedAt,
        errorCode: identifier(result.errorCode, 'errorCode'),
      },
      now,
    );
  }
  if (
    result.transactionIds.length === 0 ||
    result.transactionIds.length > 20 ||
    result.transactionIds.some(value => !SAFE_IDENTIFIER.test(value))
  ) {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-INVALID-COMPLETION',
      'A committed result must contain 1 to 20 safe transaction IDs.',
    );
  }
  return next(
    record,
    {
      status: result.status,
      transactionIds: [...result.transactionIds],
      completedAt,
      errorCode: undefined,
    },
    now,
  );
}

export function cancelAgentSyncOperation(
  record: AgentSyncOperationRecord,
  expected: number,
  now: string,
): AgentSyncOperationRecord {
  expectedRevision(record, expected);
  if (record.status !== 'QUEUED') {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-INVALID-TRANSITION',
      'Only an unclaimed queued operation can be cancelled.',
    );
  }
  const completedAt = instant(now, 'now');
  return next(record, { status: 'CANCELLED', completedAt }, now);
}

export function expireAgentSyncOperation(
  record: AgentSyncOperationRecord,
  expected: number,
  now: string,
): AgentSyncOperationRecord {
  expectedRevision(record, expected);
  if (!['QUEUED', 'CLAIMED'].includes(record.status)) {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-INVALID-TRANSITION',
      'Only an unfinished operation can expire.',
    );
  }
  const completedAt = instant(now, 'now');
  if (new Date(completedAt).getTime() < new Date(record.expiresAt).getTime()) {
    throw new AgentSyncOperationError(
      'AGENT-SYNC-NOT-EXPIRED',
      'The operation has not reached its expiry time.',
    );
  }
  return next(record, { status: 'EXPIRED', completedAt }, now);
}

// Keep protocol errors distinct from transition errors when callers expose
// machine-readable HTTP Problem Details.
export { AgentSyncProtocolError };
