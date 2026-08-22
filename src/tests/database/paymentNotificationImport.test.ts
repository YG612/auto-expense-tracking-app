import { createRepositories, type DatabaseConnection } from '../../database';
import type { Transaction } from '../../domain/entities';
import { openMigratedTestDatabase } from './testDatabase';

const now = '2026-08-14T08:00:00.000Z';

function pendingTransaction(
  id: string,
  sourceReferenceId: string,
): Transaction {
  return {
    id,
    revision: 1,
    type: 'EXPENSE',
    amountMinor: 200,
    currency: 'CNY',
    occurredAt: now,
    source: 'WECHAT_IMPORT',
    sourceReferenceId,
    confirmationStatus: 'PENDING',
    duplicateStatus: 'NONE',
    requiresReview: true,
    reviewReasonCodes: ['MISSING_FIELDS'],
    createdAt: now,
    updatedAt: now,
    syncStatus: 'LOCAL_ONLY',
  };
}

describe('payment notification import repository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => database.close());

  it('keeps experimental capture and OCR disabled until the user opts in', async () => {
    const repositories = createRepositories(database);
    await expect(
      repositories.experimentalFeatures.get(),
    ).resolves.toMatchObject({
      paymentNotificationsEnabled: false,
      imageOcrEnabled: false,
    });
  });

  it('rolls back the whole batch on failure and deduplicates a successful retry', async () => {
    const repositories = createRepositories(database);
    const first = pendingTransaction('notification-1', 'notification:one');
    const second = pendingTransaction('notification-2', 'notification:two');

    await expect(
      repositories.paymentNotificationImports.commitMany(
        [
          { notificationKey: 'one', transaction: first, tagIds: [] },
          {
            notificationKey: 'two',
            transaction: { ...second, accountId: 'missing-account' },
            tagIds: [],
          },
        ],
        now,
      ),
    ).rejects.toThrow();

    const afterFailure = await database.execute<{ count: number }>(
      `SELECT COUNT(*) AS count FROM transactions
       WHERE source_reference_id LIKE 'notification:%'`,
    );
    const auditAfterFailure = await database.execute<{ count: number }>(
      'SELECT COUNT(*) AS count FROM payment_notification_imports',
    );
    expect(afterFailure.rows[0]?.count).toBe(0);
    expect(auditAfterFailure.rows[0]?.count).toBe(0);

    await expect(
      repositories.paymentNotificationImports.commitMany(
        [
          { notificationKey: 'one', transaction: first, tagIds: [] },
          { notificationKey: 'two', transaction: second, tagIds: [] },
        ],
        now,
      ),
    ).resolves.toEqual({
      transactionIds: ['notification-1', 'notification-2'],
      duplicateBatch: false,
    });
    await expect(
      repositories.paymentNotificationImports.commitMany(
        [
          { notificationKey: 'one', transaction: first, tagIds: [] },
          { notificationKey: 'two', transaction: second, tagIds: [] },
        ],
        now,
      ),
    ).resolves.toEqual({ transactionIds: [], duplicateBatch: true });

    const afterRetry = await database.execute<{ count: number }>(
      `SELECT COUNT(*) AS count FROM transactions
       WHERE source_reference_id LIKE 'notification:%'`,
    );
    expect(afterRetry.rows[0]?.count).toBe(2);
  });
});
