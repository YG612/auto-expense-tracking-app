import type { Transaction } from '../../domain/entities';
import { AppError } from '../../domain/errors/AppError';
import type { DatabaseConnection, SqlExecutor, SqlRow } from '../types';
import { transactionDefinition } from './entityDefinitions';
import {
  canonicalUtcTimestamp,
  createValidatedTransactionWithTags,
} from './transactionWriteIntegrity';

const AGENT_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/u;
const MAX_AGENT_TRANSACTION_COUNT = 20;

export type AgentPendingCommitItem = {
  transaction: Transaction;
  tagIds: readonly string[];
};

export type AgentOperationReceipt = {
  callerId: string;
  idempotencyKey: string;
  operation: 'CREATE_PENDING_BILL';
  payloadHash: string;
  state: 'COMMITTED';
  transactionIds: readonly string[];
  committedAt: string;
};

export type AgentOperationOutcome =
  | { status: 'COMMITTED'; transactions: readonly Transaction[] }
  | { status: 'ALREADY_COMMITTED'; transactions: readonly Transaction[] }
  | { status: 'CONSUMED_DELETED'; transactions: readonly Transaction[] };

export class AgentOperationPayloadMismatchError extends AppError {
  constructor() {
    super(
      'AGENT-IDEMPOTENCY-PAYLOAD-MISMATCH',
      '该代理幂等键已用于另一份账单内容，不能重复写入。',
      { category: 'CONFLICT', retryable: false },
    );
    this.name = 'AgentOperationPayloadMismatchError';
  }
}

type ReceiptRow = SqlRow & {
  caller_id: string;
  idempotency_key: string;
  operation: 'CREATE_PENDING_BILL';
  payload_hash: string;
  state: 'IN_PROGRESS' | 'COMMITTED';
  transaction_ids_json: string;
  committed_at: string;
};

function validatedIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!AGENT_IDENTIFIER.test(normalized)) {
    throw new Error(`${field} 必须是 1 到 128 位安全标识符。`);
  }
  return normalized;
}

function transactionIdsFromJson(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Agent operation receipt transaction IDs are corrupt.');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > MAX_AGENT_TRANSACTION_COUNT ||
    !parsed.every(
      item => typeof item === 'string' && item.length > 0 && item.length <= 128,
    ) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error('Agent operation receipt transaction IDs are invalid.');
  }
  return parsed;
}

function receiptFromRow(row: ReceiptRow): AgentOperationReceipt {
  if (row.state !== 'COMMITTED') {
    throw new Error('Agent operation receipt is not committed.');
  }
  return {
    callerId: row.caller_id,
    idempotencyKey: row.idempotency_key,
    operation: row.operation,
    payloadHash: row.payload_hash,
    state: row.state,
    transactionIds: transactionIdsFromJson(row.transaction_ids_json),
    committedAt: row.committed_at,
  };
}

async function readReceipt(
  executor: SqlExecutor,
  callerId: string,
  idempotencyKey: string,
): Promise<AgentOperationReceipt | undefined> {
  const result = await executor.execute<ReceiptRow>(
    `SELECT caller_id, idempotency_key, operation, payload_hash, state,
            transaction_ids_json, committed_at
       FROM agent_operation_receipts
      WHERE caller_id = ? AND idempotency_key = ?`,
    [callerId, idempotencyKey],
  );
  return result.rows[0] === undefined
    ? undefined
    : receiptFromRow(result.rows[0]);
}

async function readTransactions(
  executor: SqlExecutor,
  transactionIds: readonly string[],
): Promise<Transaction[]> {
  const transactions: Transaction[] = [];
  for (const id of transactionIds) {
    const result = await executor.execute(
      `SELECT ${transactionDefinition.columns.join(', ')}
         FROM transactions
        WHERE id = ?`,
      [id],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(
        'Agent operation receipt references a missing transaction.',
      );
    }
    transactions.push(transactionDefinition.fromRow(row));
  }
  return transactions;
}

async function outcomeForReceipt(
  executor: SqlExecutor,
  receipt: AgentOperationReceipt,
  payloadHash: string,
): Promise<AgentOperationOutcome> {
  if (receipt.payloadHash !== payloadHash) {
    throw new AgentOperationPayloadMismatchError();
  }
  const transactions = await readTransactions(executor, receipt.transactionIds);
  return transactions.some(transaction => transaction.deletedAt !== undefined)
    ? { status: 'CONSUMED_DELETED', transactions }
    : { status: 'ALREADY_COMMITTED', transactions };
}

function validateItems(items: readonly AgentPendingCommitItem[]): void {
  if (items.length === 0 || items.length > MAX_AGENT_TRANSACTION_COUNT) {
    throw new Error(
      `代理记账每次必须包含 1 到 ${MAX_AGENT_TRANSACTION_COUNT} 笔候选。`,
    );
  }
  const sourceReferences = new Set<string>();
  for (const item of items) {
    if (
      item.transaction.source !== 'TEXT' ||
      item.transaction.confirmationStatus !== 'PENDING'
    ) {
      throw new Error('代理只能以 TEXT 来源创建 PENDING 交易。');
    }
    const sourceReferenceId = item.transaction.sourceReferenceId?.trim();
    if (
      sourceReferenceId === undefined ||
      !sourceReferenceId.startsWith('agent:') ||
      sourceReferences.has(sourceReferenceId)
    ) {
      throw new Error('代理交易来源标识缺失或重复。');
    }
    sourceReferences.add(sourceReferenceId);
  }
}

export class AgentOperationRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async reconcile(
    callerId: string,
    idempotencyKey: string,
    payloadHash: string,
  ): Promise<AgentOperationOutcome | undefined> {
    const caller = validatedIdentifier(callerId, 'callerId');
    const key = validatedIdentifier(idempotencyKey, 'idempotencyKey');
    return this.database.transaction(async executor => {
      const receipt = await readReceipt(executor, caller, key);
      return receipt === undefined
        ? undefined
        : outcomeForReceipt(executor, receipt, payloadHash);
    });
  }

  async commitPending(
    callerId: string,
    idempotencyKey: string,
    payloadHash: string,
    items: readonly AgentPendingCommitItem[],
    committedAt: string,
  ): Promise<AgentOperationOutcome> {
    const caller = validatedIdentifier(callerId, 'callerId');
    const key = validatedIdentifier(idempotencyKey, 'idempotencyKey');
    if (!/^sha256-v1:[a-f0-9]{64}$/u.test(payloadHash)) {
      throw new Error('payloadHash 格式无效。');
    }
    validateItems(items);
    const canonicalCommittedAt = canonicalUtcTimestamp(
      committedAt,
      'committedAt',
    );

    return this.database.transaction(async executor => {
      const existing = await readReceipt(executor, caller, key);
      if (existing !== undefined) {
        return outcomeForReceipt(executor, existing, payloadHash);
      }

      const reservation = await executor.execute(
        `INSERT INTO agent_operation_receipts (
           caller_id, idempotency_key, operation, payload_hash, state,
           transaction_ids_json, committed_at
         ) VALUES (?, ?, 'CREATE_PENDING_BILL', ?, 'IN_PROGRESS', '[]', ?)
         ON CONFLICT(caller_id, idempotency_key) DO NOTHING`,
        [caller, key, payloadHash, canonicalCommittedAt],
      );
      if (reservation.rowsAffected !== 1) {
        const raced = await readReceipt(executor, caller, key);
        if (raced === undefined) {
          throw new Error('Agent operation reservation conflicted.');
        }
        return outcomeForReceipt(executor, raced, payloadHash);
      }

      const transactions: Transaction[] = [];
      for (const item of items) {
        transactions.push(
          await createValidatedTransactionWithTags(
            executor,
            item.transaction,
            item.tagIds,
          ),
        );
      }
      const transactionIds = transactions.map(transaction => transaction.id);
      const committed = await executor.execute(
        `UPDATE agent_operation_receipts
            SET state = 'COMMITTED', transaction_ids_json = ?
          WHERE caller_id = ? AND idempotency_key = ? AND state = 'IN_PROGRESS'`,
        [JSON.stringify(transactionIds), caller, key],
      );
      if (committed.rowsAffected !== 1) {
        throw new Error('Agent operation receipt could not be committed.');
      }
      return { status: 'COMMITTED', transactions };
    });
  }
}
