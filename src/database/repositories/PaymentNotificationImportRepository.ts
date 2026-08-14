import type { Transaction } from '../../domain/entities';
import { sha256 } from '../../utils/sha256';
import type { DatabaseConnection } from '../types';
import {
  canonicalUtcTimestamp,
  createValidatedTransactionWithTags,
} from './transactionWriteIntegrity';

export type PaymentNotificationCommitItem = {
  notificationKey: string;
  transaction: Transaction;
  tagIds: readonly string[];
};

export type PaymentNotificationCommitResult = {
  transactionIds: readonly string[];
  duplicateBatch: boolean;
};

export class PaymentNotificationImportRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async commitMany(
    items: readonly PaymentNotificationCommitItem[],
    committedAt: string,
  ): Promise<PaymentNotificationCommitResult> {
    if (items.length === 0) {
      return { transactionIds: [], duplicateBatch: false };
    }
    if (items.length > 100) throw new Error('支付通知批次过大。');
    const references = items.map(item => item.transaction.sourceReferenceId);
    if (
      references.some(reference => reference === undefined) ||
      new Set(references).size !== references.length
    ) {
      throw new Error('支付通知来源标识无效或重复。');
    }
    const canonicalCommittedAt = canonicalUtcTimestamp(
      committedAt,
      'committedAt',
    );
    const batchHash = sha256([...references].sort().join('|'));

    return this.database.transaction(async executor => {
      const existingBatch = await executor.execute(
        'SELECT id FROM payment_notification_imports WHERE batch_hash = ?',
        [batchHash],
      );
      if (existingBatch.rows[0] !== undefined) {
        return { transactionIds: [], duplicateBatch: true };
      }

      const transactionIds: string[] = [];
      for (const item of items) {
        const sourceReferenceId = item.transaction.sourceReferenceId!;
        const existing = await executor.execute(
          'SELECT id FROM transactions WHERE source_reference_id = ?',
          [sourceReferenceId],
        );
        if (existing.rows[0] !== undefined) continue;
        await createValidatedTransactionWithTags(
          executor,
          item.transaction,
          item.tagIds,
        );
        transactionIds.push(item.transaction.id);
      }
      await executor.execute(
        `INSERT INTO payment_notification_imports (
          id, batch_hash, candidate_count, imported_count, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          `payment-notification-${batchHash.slice(0, 32)}`,
          batchHash,
          items.length,
          transactionIds.length,
          canonicalCommittedAt,
        ],
      );
      return { transactionIds, duplicateBatch: false };
    });
  }
}
