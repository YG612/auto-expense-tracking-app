import type { DatabaseConnection } from '../../database';
import { createRepositories } from '../../database';
import type { Transaction } from '../../domain/entities';
import { openMigratedTestDatabase } from './testDatabase';

function confirmed(id: string, occurredAt: string): Transaction {
  return {
    id,
    revision: 1,
    type: 'EXPENSE',
    amountMinor: 1200,
    currency: 'CNY',
    occurredAt,
    categoryId: 'category-expense-food',
    subcategoryId: 'category-expense-food-lunch',
    accountId: 'account-wechat',
    source: 'TEXT',
    requiresReview: false,
    reviewReasonCodes: [],
    confirmationStatus: 'CONFIRMED',
    duplicateStatus: 'NONE',
    createdAt: occurredAt,
    updatedAt: occurredAt,
    syncStatus: 'LOCAL_ONLY',
  };
}

describe('ProductValueMetricsRepository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => database.close());

  it('measures value outcomes locally without retaining financial payloads', async () => {
    const repositories = createRepositories(database);
    await repositories.transactions.create(
      confirmed('metric-tx', '2026-08-13T10:00:00.000Z'),
    );
    await repositories.productValueMetrics.record({
      eventType: 'ENTRY_STARTED',
      sessionId: 'session-success',
      occurredAt: '2026-08-13T09:59:00.000Z',
    });
    await repositories.productValueMetrics.record({
      eventType: 'EDIT_OPEN',
      sessionId: 'session-success',
      occurredAt: '2026-08-13T09:59:30.000Z',
    });
    await repositories.productValueMetrics.record({
      eventType: 'CONFIRM_CLICK',
      sessionId: 'session-success',
      transactionId: 'metric-tx',
      occurredAt: '2026-08-13T10:00:00.000Z',
    });
    await repositories.productValueMetrics.record({
      eventType: 'ENTRY_STARTED',
      sessionId: 'session-abandoned',
      occurredAt: '2026-08-13T11:00:00.000Z',
    });

    await expect(
      repositories.productValueMetrics.summarize(
        undefined,
        new Date('2026-08-14T12:00:00.000Z'),
      ),
    ).resolves.toMatchObject({
      startedSessions: 2,
      successfulSessions: 1,
      firstEntrySuccessRate: 0.5,
      averageConfirmationOperations: 2,
      sevenDayActiveBookkeepingDays: 1,
      correctionRate: 0,
    });
    const columns = await database.execute<{ name: string }>(
      `SELECT name FROM pragma_table_info('product_value_events') ORDER BY cid`,
    );
    expect(columns.rows.map(row => row.name)).toEqual([
      'id',
      'event_type',
      'experience_version',
      'session_id',
      'transaction_id',
      'occurred_at',
    ]);
  });
});
