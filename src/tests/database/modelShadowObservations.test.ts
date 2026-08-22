import { createRepositories } from '../../database';
import type { Transaction } from '../../domain/entities';
import { openMigratedTestDatabase } from './testDatabase';

const now = '2026-08-17T12:00:00.000Z';

describe('model shadow observations', () => {
  it('records privacy-minimal, idempotent outcomes and cascades with the ledger row', async () => {
    const database = await openMigratedTestDatabase();
    const repositories = createRepositories(database);
    const transaction: Transaction = {
      id: 'shadow-transaction',
      revision: 1,
      type: 'EXPENSE',
      amountMinor: 2500,
      currency: 'CNY',
      occurredAt: now,
      categoryId: 'category-expense-food',
      accountId: 'account-wechat',
      source: 'TEXT',
      originalText: 'private text stays in the ledger only',
      confirmationStatus: 'CONFIRMED',
      duplicateStatus: 'NONE',
      requiresReview: false,
      reviewReasonCodes: [],
      createdAt: now,
      updatedAt: now,
      syncStatus: 'LOCAL_ONLY',
    };

    try {
      await repositories.transactions.create(transaction);
      const observation = {
        id: `model-shadow-${transaction.id}`,
        transactionId: transaction.id,
        modelId: 'qingji-bill-category-fasttext',
        modelVersion: '3.0.0-shadow',
        taxonomyVersion: 3,
        predictedCategoryKey: 'expense.food',
        finalCategoryKey: 'expense.food',
        matched: true,
        calibratedConfidence: 0.995,
        latencyMs: 1.25,
        createdAt: now,
      };
      await expect(
        repositories.shadowObservations.record(observation),
      ).resolves.toBe(true);
      await expect(
        repositories.shadowObservations.record(observation),
      ).resolves.toBe(false);
      await expect(
        repositories.shadowObservations.listForModel(observation.modelVersion),
      ).resolves.toEqual([observation]);
      await expect(
        repositories.shadowObservations.summary(observation.modelVersion),
      ).resolves.toEqual({
        modelVersion: observation.modelVersion,
        observationCount: 1,
        matchedCount: 1,
        firstObservedAt: now,
        lastObservedAt: now,
      });
      await expect(
        repositories.shadowObservations.latestSummary(),
      ).resolves.toEqual({
        modelVersion: observation.modelVersion,
        observationCount: 1,
        matchedCount: 1,
        firstObservedAt: now,
        lastObservedAt: now,
      });
      const exported = await repositories.shadowObservations.exportJsonl(
        observation.modelVersion,
      );
      expect(exported).toContain('"autoCommitted":false');
      expect(exported).not.toContain('private text');
      expect(exported).not.toContain('amountMinor');
      expect(exported).not.toContain('accountId');

      await database.execute('DELETE FROM transactions WHERE id = ?', [
        transaction.id,
      ]);
      await expect(
        repositories.shadowObservations.listForModel(observation.modelVersion),
      ).resolves.toEqual([]);
    } finally {
      database.close();
    }
  });
});
