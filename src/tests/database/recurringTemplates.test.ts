import type { DatabaseConnection } from '../../database';
import { createRepositories } from '../../database';
import type { RecurringTemplate } from '../../domain/entities';
import { openMigratedTestDatabase } from './testDatabase';

function template(
  id: string,
  overrides: Partial<RecurringTemplate> = {},
): RecurringTemplate {
  return {
    id,
    name: '固定午餐',
    type: 'EXPENSE',
    amountMinor: 2500,
    currency: 'CNY',
    categoryId: 'category-expense-food-lunch',
    accountId: 'account-wechat',
    cadence: 'WEEKLY',
    nextOccurrenceAt: '2026-08-01T12:00:00.000Z',
    enabled: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('RecurringTemplateRepository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });
  afterEach(() => database.close());

  it('materializes due occurrences idempotently as confirmable drafts by default', async () => {
    const repositories = createRepositories(database);
    await repositories.recurringTemplates.create(template('weekly-draft'));

    await expect(
      repositories.recurringTemplates.materializeDue(
        '2026-08-15T12:00:00.000Z',
      ),
    ).resolves.toBe(3);
    await expect(
      repositories.recurringTemplates.materializeDue(
        '2026-08-15T12:00:00.000Z',
      ),
    ).resolves.toBe(0);
    const transactions = await repositories.transactions.list({
      confirmationStatus: 'PENDING',
    });
    expect(transactions).toHaveLength(3);
    expect(transactions[0]).toMatchObject({
      categoryId: 'category-expense-food',
      subcategoryId: 'category-expense-food-lunch',
      accountId: 'account-wechat',
      confirmationStatus: 'PENDING',
      requiresReview: false,
      reviewReasonCodes: [],
    });
    expect(new Set(transactions.map(item => item.sourceReferenceId)).size).toBe(
      3,
    );
  });

  it('keeps monthly occurrences pending and respects disabling', async () => {
    const repositories = createRepositories(database);
    await repositories.recurringTemplates.create(
      template('monthly-draft', {
        cadence: 'MONTHLY',
        nextOccurrenceAt: '2026-07-31T12:00:00.000Z',
      }),
    );
    await expect(
      repositories.recurringTemplates.materializeDue(
        '2026-08-31T12:00:00.000Z',
      ),
    ).resolves.toBe(2);
    const pending = await repositories.transactions.list({
      confirmationStatus: 'PENDING',
    });
    expect(pending).toHaveLength(2);

    await repositories.recurringTemplates.setEnabled(
      'monthly-draft',
      false,
      '2026-09-01T00:00:00.000Z',
    );
    await expect(
      repositories.recurringTemplates.materializeDue(
        '2026-10-31T12:00:00.000Z',
      ),
    ).resolves.toBe(0);
  });

  it('revalidates hidden accounts and categories before materializing', async () => {
    const repositories = createRepositories(database);
    await repositories.recurringTemplates.create(template('visibility-check'));

    await database.execute(
      "UPDATE accounts SET is_hidden = 1 WHERE id = 'account-wechat'",
    );
    await expect(
      repositories.recurringTemplates.materializeDue(
        '2026-08-01T12:00:00.000Z',
      ),
    ).rejects.toThrow('周期账户不可用');

    await database.execute(
      "UPDATE accounts SET is_hidden = 0 WHERE id = 'account-wechat'",
    );
    await database.execute(
      "UPDATE categories SET is_hidden = 1 WHERE id = 'category-expense-food-lunch'",
    );
    await expect(
      repositories.recurringTemplates.materializeDue(
        '2026-08-01T12:00:00.000Z',
      ),
    ).rejects.toThrow('Recurring category is missing');

    const count = await database.execute<{ count: number }>(
      "SELECT COUNT(*) AS count FROM transactions WHERE source_reference_id LIKE 'recurring:%'",
    );
    expect(count.rows[0]?.count).toBe(0);
  });

  it('preserves 28/29/30/31 anchors across short months', async () => {
    const repositories = createRepositories(database);
    for (const day of [28, 29, 30, 31]) {
      await repositories.recurringTemplates.create(
        template(`monthly-${day}`, {
          cadence: 'MONTHLY',
          nextOccurrenceAt: `2027-01-${day}T12:00:00.000Z`,
        }),
      );
    }

    await expect(
      repositories.recurringTemplates.materializeDue(
        '2027-03-31T12:00:00.000Z',
      ),
    ).resolves.toBe(12);

    const occurrences = await database.execute<{
      source_reference_id: string;
      occurred_at: string;
    }>(
      `SELECT source_reference_id, occurred_at
       FROM transactions
       WHERE source_reference_id LIKE 'recurring:monthly-%'
       ORDER BY source_reference_id ASC`,
    );
    const byTemplate = (id: string) =>
      occurrences.rows
        .filter(row => row.source_reference_id.startsWith(`recurring:${id}:`))
        .map(row => row.occurred_at.slice(0, 10));

    expect(byTemplate('monthly-28')).toEqual([
      '2027-01-28',
      '2027-02-28',
      '2027-03-28',
    ]);
    expect(byTemplate('monthly-29')).toEqual([
      '2027-01-29',
      '2027-02-28',
      '2027-03-29',
    ]);
    expect(byTemplate('monthly-30')).toEqual([
      '2027-01-30',
      '2027-02-28',
      '2027-03-30',
    ]);
    expect(byTemplate('monthly-31')).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
  });

  it('uses February 29 for a month-end template in a leap year', async () => {
    const repositories = createRepositories(database);
    await repositories.recurringTemplates.create(
      template('leap-month-end', {
        cadence: 'MONTHLY',
        nextOccurrenceAt: '2028-01-31T12:00:00.000Z',
      }),
    );

    await repositories.recurringTemplates.materializeDue(
      '2028-03-31T12:00:00.000Z',
    );
    const transactions = await database.execute<{ occurred_at: string }>(
      `SELECT occurred_at FROM transactions
       WHERE source_reference_id LIKE 'recurring:leap-month-end:%'
       ORDER BY occurred_at ASC`,
    );
    expect(transactions.rows.map(row => row.occurred_at.slice(0, 10))).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ]);
  });

  it('keeps a March 30 anchor after passing through April month-end', async () => {
    const repositories = createRepositories(database);
    await repositories.recurringTemplates.create(
      template('march-thirty', {
        cadence: 'MONTHLY',
        nextOccurrenceAt: '2027-03-30T12:00:00.000Z',
      }),
    );

    await repositories.recurringTemplates.materializeDue(
      '2027-05-30T12:00:00.000Z',
    );
    const transactions = await database.execute<{ occurred_at: string }>(
      `SELECT occurred_at FROM transactions
       WHERE source_reference_id LIKE 'recurring:march-thirty:%'
       ORDER BY occurred_at ASC`,
    );
    expect(transactions.rows.map(row => row.occurred_at.slice(0, 10))).toEqual([
      '2027-03-30',
      '2027-04-30',
      '2027-05-30',
    ]);
  });
});
