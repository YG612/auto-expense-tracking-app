import type { Transaction } from '../../domain/entities';
import { AppError } from '../../domain/errors/AppError';
import type { SqlExecutor, SqlRow } from '../types';
import { transactionDefinition } from './entityDefinitions';
import { createValidatedTransactionWithTags } from './transactionWriteIntegrity';

const HASH_SEEDS = [
  0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1,
  0xd3a2646c, 0xfd7046c5,
] as const;

function normalized(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}

function fnv1a32(value: string, seed: number): string {
  /* eslint-disable no-bitwise -- FNV-1a is defined in terms of unsigned 32-bit bitwise operations. */
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hash ^= code & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= code >>> 8;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  /* eslint-enable no-bitwise */
  return hash.toString(16).padStart(8, '0');
}

/**
 * Stable 256-bit local payload digest. It is an idempotency binding rather
 * than an authentication primitive; the version prefix permits replacement
 * without reinterpreting old receipts.
 */
export function recognizedPayloadHash(
  transaction: Transaction,
  tagIds: readonly string[],
): string {
  const canonical = JSON.stringify({
    schema: 1,
    type: transaction.type,
    amountMinor: transaction.amountMinor,
    currency: transaction.currency.trim().toUpperCase(),
    occurredAt: transaction.occurredAt,
    categoryId: normalized(transaction.categoryId),
    subcategoryId: normalized(transaction.subcategoryId),
    accountId: normalized(transaction.accountId),
    targetAccountId: normalized(transaction.targetAccountId),
    merchantId: normalized(transaction.merchantId),
    merchantRawName: normalized(transaction.merchantRawName),
    projectId: normalized(transaction.projectId),
    note: normalized(transaction.note),
    source: transaction.source,
    sourceReferenceId: normalized(transaction.sourceReferenceId),
    originalText: normalized(transaction.originalText),
    confidence: transaction.confidence ?? null,
    requiresReview: transaction.requiresReview ?? false,
    reviewReasonCodes: [...(transaction.reviewReasonCodes ?? [])].sort(),
    confirmationStatus: transaction.confirmationStatus,
    duplicateStatus: transaction.duplicateStatus,
    relatedTransactionId: normalized(transaction.relatedTransactionId),
    fingerprint: normalized(transaction.fingerprint),
    tags: [...new Set(tagIds.map(item => item.trim()).filter(Boolean))].sort(),
  });
  return `fnv1a-256-v1:${HASH_SEEDS.map(seed => fnv1a32(canonical, seed)).join('')}`;
}

export type RecognizedOperationReceipt = {
  source: 'VOICE';
  sourceReferenceId: string;
  payloadHash: string;
  transactionId: string;
  confirmationStatus: 'CONFIRMED' | 'PENDING';
  state: 'COMMITTED';
  committedAt: string;
};

export type RecognizedOperationOutcome =
  | { status: 'COMMITTED'; transaction: Transaction }
  | { status: 'ALREADY_COMMITTED'; transaction: Transaction }
  | { status: 'CONSUMED_DELETED'; transaction?: Transaction };

export class RecognizedPayloadMismatchError extends AppError {
  constructor() {
    super(
      'VOICE-ORIGIN-PAYLOAD-MISMATCH',
      '该条语音结果已用于另一笔内容，不能重复写入。',
      { category: 'CONFLICT', retryable: false },
    );
    this.name = 'RecognizedPayloadMismatchError';
  }
}

export class RecognizedOperationConsumedError extends AppError {
  constructor() {
    super(
      'VOICE-ORIGIN-CONSUMED-DELETED',
      '该条语音结果对应的账目已删除，不能再次写入。',
      { category: 'CONFLICT', retryable: false },
    );
    this.name = 'RecognizedOperationConsumedError';
  }
}

type ReceiptRow = SqlRow & {
  source: 'VOICE';
  source_reference_id: string;
  payload_hash: string;
  transaction_id: string;
  confirmation_status: 'CONFIRMED' | 'PENDING';
  state: 'COMMITTED';
  committed_at: string;
};

function receiptFromRow(row: ReceiptRow): RecognizedOperationReceipt {
  return {
    source: row.source,
    sourceReferenceId: row.source_reference_id,
    payloadHash: row.payload_hash,
    transactionId: row.transaction_id,
    confirmationStatus: row.confirmation_status,
    state: row.state,
    committedAt: row.committed_at,
  };
}

export async function readRecognizedOperationReceipt(
  executor: SqlExecutor,
  sourceReferenceId: string,
): Promise<RecognizedOperationReceipt | undefined> {
  const result = await executor.execute<ReceiptRow>(
    `SELECT source, source_reference_id, payload_hash, transaction_id,
            confirmation_status, state, committed_at
       FROM recognized_operation_receipts
      WHERE source = 'VOICE' AND source_reference_id = ?`,
    [sourceReferenceId],
  );
  return result.rows[0] === undefined
    ? undefined
    : receiptFromRow(result.rows[0]);
}

async function readTransactionIncludingDeleted(
  executor: SqlExecutor,
  id: string,
): Promise<Transaction | undefined> {
  const result = await executor.execute(
    `SELECT ${transactionDefinition.columns.join(', ')}
       FROM transactions
      WHERE id = ?`,
    [id],
  );
  return result.rows[0] === undefined
    ? undefined
    : transactionDefinition.fromRow(result.rows[0]);
}

async function readTransactionByOriginIncludingDeleted(
  executor: SqlExecutor,
  sourceReferenceId: string,
): Promise<Transaction | undefined> {
  const result = await executor.execute(
    `SELECT ${transactionDefinition.columns.join(', ')}
       FROM transactions
      WHERE source = 'VOICE' AND source_reference_id = ?`,
    [sourceReferenceId],
  );
  return result.rows[0] === undefined
    ? undefined
    : transactionDefinition.fromRow(result.rows[0]);
}

async function readTagIds(
  executor: SqlExecutor,
  transactionId: string,
): Promise<string[]> {
  const result = await executor.execute<{ tag_id: string }>(
    `SELECT tag_id FROM transaction_tags
      WHERE transaction_id = ? ORDER BY tag_id ASC`,
    [transactionId],
  );
  return result.rows.map(row => row.tag_id);
}

async function outcomeForReceipt(
  executor: SqlExecutor,
  receipt: RecognizedOperationReceipt,
  payloadHash: string,
): Promise<RecognizedOperationOutcome> {
  const transaction = await readTransactionIncludingDeleted(
    executor,
    receipt.transactionId,
  );
  if (transaction === undefined || transaction.deletedAt !== undefined) {
    return { status: 'CONSUMED_DELETED', transaction };
  }
  if (receipt.payloadHash !== payloadHash) {
    throw new RecognizedPayloadMismatchError();
  }
  return { status: 'ALREADY_COMMITTED', transaction };
}

export async function reconcileRecognizedOperationInTransaction(
  executor: SqlExecutor,
  sourceReferenceId: string,
  payloadHash: string,
): Promise<RecognizedOperationOutcome | undefined> {
  const receipt = await readRecognizedOperationReceipt(
    executor,
    sourceReferenceId,
  );
  return receipt === undefined
    ? undefined
    : outcomeForReceipt(executor, receipt, payloadHash);
}

/**
 * Consumes a voice origin and creates its ledger row in one SQLite
 * transaction. Callers must wrap this helper in DatabaseConnection.transaction.
 */
export async function saveRecognizedOperationInTransaction(
  executor: SqlExecutor,
  transaction: Transaction,
  tagIds: readonly string[],
): Promise<RecognizedOperationOutcome> {
  if (transaction.source !== 'VOICE') {
    throw new Error(
      'Durable recognized-operation receipts require VOICE source.',
    );
  }
  const sourceReferenceId = transaction.sourceReferenceId?.trim();
  if (sourceReferenceId === undefined || sourceReferenceId.length === 0) {
    throw new Error('VOICE transaction requires a stable sourceReferenceId.');
  }
  if (
    transaction.confirmationStatus !== 'CONFIRMED' &&
    transaction.confirmationStatus !== 'PENDING'
  ) {
    throw new Error(
      'VOICE receipt requires a persistable confirmation status.',
    );
  }

  const payloadHash = recognizedPayloadHash(transaction, tagIds);
  const reconciled = await reconcileRecognizedOperationInTransaction(
    executor,
    sourceReferenceId,
    payloadHash,
  );
  if (reconciled !== undefined) {
    return reconciled;
  }

  // Defensive recovery for a transaction written by an older build or a
  // partially rolled-out repository API. The source lookup includes deleted
  // rows; an origin can never become reusable by moving its row to trash.
  const unreceipted = await readTransactionByOriginIncludingDeleted(
    executor,
    sourceReferenceId,
  );
  if (unreceipted !== undefined) {
    const storedHash = recognizedPayloadHash(
      unreceipted,
      await readTagIds(executor, unreceipted.id),
    );
    if (storedHash !== payloadHash) {
      throw new RecognizedPayloadMismatchError();
    }
    await executor.execute(
      `INSERT INTO recognized_operation_receipts (
         source, source_reference_id, payload_hash, transaction_id,
         confirmation_status, state, committed_at
       ) VALUES ('VOICE', ?, ?, ?, ?, 'COMMITTED', ?)`,
      [
        sourceReferenceId,
        payloadHash,
        unreceipted.id,
        unreceipted.confirmationStatus,
        unreceipted.updatedAt,
      ],
    );
    return unreceipted.deletedAt === undefined
      ? { status: 'ALREADY_COMMITTED', transaction: unreceipted }
      : { status: 'CONSUMED_DELETED', transaction: unreceipted };
  }

  const persisted = await createValidatedTransactionWithTags(
    executor,
    transaction,
    tagIds,
  );
  await executor.execute(
    `INSERT INTO recognized_operation_receipts (
       source, source_reference_id, payload_hash, transaction_id,
       confirmation_status, state, committed_at
     ) VALUES ('VOICE', ?, ?, ?, ?, 'COMMITTED', ?)`,
    [
      sourceReferenceId,
      payloadHash,
      persisted.id,
      persisted.confirmationStatus,
      persisted.updatedAt,
    ],
  );
  return { status: 'COMMITTED', transaction: persisted };
}
