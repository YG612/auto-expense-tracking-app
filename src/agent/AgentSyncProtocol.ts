import { sha256 } from '../utils/sha256';
import { type AgentPendingBillInput } from './AgentCommandService';
import { MAX_AGENT_BILL_TEXT_LENGTH } from './AndroidReviewBridge';

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;

export const AGENT_SYNC_PROTOCOL_VERSION = 1 as const;

export type AgentSyncCreateInput = AgentPendingBillInput & {
  deviceId: string;
};

export type AgentSyncCreateRequest = {
  schemaVersion: typeof AGENT_SYNC_PROTOCOL_VERSION;
  command: 'bill.create-pending';
  callerId: string;
  deviceId: string;
  text: string;
  referenceDate?: string;
  timezoneOffsetMinutes?: number;
};

export type AgentSyncRequestEnvelope = {
  body: AgentSyncCreateRequest;
  headers: {
    'Idempotency-Key': string;
    'X-QingJi-Payload-SHA256': string;
  };
};

export const AGENT_SYNC_OPERATION_STATUSES = [
  'QUEUED',
  'CLAIMED',
  'COMMITTED',
  'ALREADY_COMMITTED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type AgentSyncOperationStatus =
  (typeof AGENT_SYNC_OPERATION_STATUSES)[number];

export type AgentSyncOperationReceipt = {
  schemaVersion: typeof AGENT_SYNC_PROTOCOL_VERSION;
  operationId: string;
  requestKey: string;
  status: AgentSyncOperationStatus;
  transactionIds: readonly string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  errorCode?: string;
};

export class AgentSyncProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentSyncProtocolError';
  }
}

function safeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER.test(normalized)) {
    throw new AgentSyncProtocolError(
      'AGENT-SYNC-INVALID-IDENTIFIER',
      `${field} must be a 1 to 128 character safe identifier.`,
    );
  }
  return normalized;
}

function safeText(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    [...normalized].length > MAX_AGENT_BILL_TEXT_LENGTH ||
    normalized.includes('\0')
  ) {
    throw new AgentSyncProtocolError(
      'AGENT-SYNC-INVALID-TEXT',
      `Bill text must contain 1 to ${MAX_AGENT_BILL_TEXT_LENGTH} Unicode characters and no null character.`,
    );
  }
  return normalized;
}

function safeReferenceDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AgentSyncProtocolError(
      'AGENT-SYNC-INVALID-REFERENCE-DATE',
      'referenceDate must be a valid ISO 8601 timestamp.',
    );
  }
  return date.toISOString();
}

function safeTimezoneOffset(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < -840 || value > 840) {
    throw new AgentSyncProtocolError(
      'AGENT-SYNC-INVALID-TIMEZONE',
      'timezoneOffsetMinutes must be an integer from -840 to 840.',
    );
  }
  return value;
}

/**
 * Builds the transport-independent production request. Authorization and DPoP
 * headers are deliberately absent: a platform credential provider must inject
 * them immediately before HTTPS transport, never into this serializable body.
 */
export function buildAgentSyncCreateRequest(
  input: AgentSyncCreateInput,
): AgentSyncRequestEnvelope {
  const referenceDate = safeReferenceDate(input.referenceDate);
  const timezoneOffsetMinutes = safeTimezoneOffset(input.timezoneOffsetMinutes);
  const body: AgentSyncCreateRequest = {
    schemaVersion: AGENT_SYNC_PROTOCOL_VERSION,
    command: 'bill.create-pending',
    callerId: safeIdentifier(input.callerId, 'callerId'),
    deviceId: safeIdentifier(input.deviceId, 'deviceId'),
    text: safeText(input.text),
    ...(referenceDate === undefined ? {} : { referenceDate }),
    ...(timezoneOffsetMinutes === undefined ? {} : { timezoneOffsetMinutes }),
  };
  return {
    body,
    headers: {
      'Idempotency-Key': safeIdentifier(input.idempotencyKey, 'idempotencyKey'),
      'X-QingJi-Payload-SHA256': sha256(JSON.stringify(body)),
    },
  };
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw new AgentSyncProtocolError(
      'AGENT-SYNC-INVALID-RECEIPT',
      `${field} must be a valid timestamp.`,
    );
  }
  return value;
}

/**
 * Parses the only server response shape exposed to agents. The strict key set
 * intentionally rejects accidental bill text, tokens, account data, or future
 * fields until a schema version is explicitly reviewed.
 */
export function parseAgentSyncOperationReceipt(
  value: unknown,
): AgentSyncOperationReceipt {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AgentSyncProtocolError(
      'AGENT-SYNC-INVALID-RECEIPT',
      'Operation receipt must be an object.',
    );
  }
  const receipt = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'schemaVersion',
    'operationId',
    'requestKey',
    'status',
    'transactionIds',
    'createdAt',
    'updatedAt',
    'completedAt',
    'errorCode',
  ]);
  if (Object.keys(receipt).some(key => !allowedKeys.has(key))) {
    throw new AgentSyncProtocolError(
      'AGENT-SYNC-RECEIPT-DATA-LEAK',
      'Operation receipt contains an unapproved field.',
    );
  }

  const status = receipt.status;
  const transactionIds = receipt.transactionIds;
  if (
    receipt.schemaVersion !== AGENT_SYNC_PROTOCOL_VERSION ||
    typeof status !== 'string' ||
    !AGENT_SYNC_OPERATION_STATUSES.includes(
      status as AgentSyncOperationStatus,
    ) ||
    typeof receipt.requestKey !== 'string' ||
    !SHA256_HEX.test(receipt.requestKey) ||
    !Array.isArray(transactionIds) ||
    transactionIds.length > 20 ||
    transactionIds.some(
      item => typeof item !== 'string' || !SAFE_IDENTIFIER.test(item),
    )
  ) {
    throw new AgentSyncProtocolError(
      'AGENT-SYNC-INVALID-RECEIPT',
      'Operation receipt has an invalid shape.',
    );
  }
  const operationId = safeIdentifier(
    String(receipt.operationId ?? ''),
    'operationId',
  );
  const terminal = !['QUEUED', 'CLAIMED'].includes(status);
  const completedAt =
    receipt.completedAt === undefined
      ? undefined
      : timestamp(receipt.completedAt, 'completedAt');
  const errorCode =
    receipt.errorCode === undefined
      ? undefined
      : safeIdentifier(String(receipt.errorCode), 'errorCode');
  if (
    terminal !== (completedAt !== undefined) ||
    (status === 'REJECTED') !== (errorCode !== undefined) ||
    ['COMMITTED', 'ALREADY_COMMITTED'].includes(status) !==
      transactionIds.length > 0 ||
    (!['COMMITTED', 'ALREADY_COMMITTED'].includes(status) &&
      transactionIds.length > 0)
  ) {
    throw new AgentSyncProtocolError(
      'AGENT-SYNC-INVALID-RECEIPT',
      'Operation receipt status fields are inconsistent.',
    );
  }

  return {
    schemaVersion: AGENT_SYNC_PROTOCOL_VERSION,
    operationId,
    requestKey: receipt.requestKey,
    status: status as AgentSyncOperationStatus,
    transactionIds: transactionIds as string[],
    createdAt: timestamp(receipt.createdAt, 'createdAt'),
    updatedAt: timestamp(receipt.updatedAt, 'updatedAt'),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}
