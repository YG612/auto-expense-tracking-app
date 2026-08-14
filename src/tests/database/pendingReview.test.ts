import type { Transaction } from '../../domain/entities';
import { createRepositories, type DatabaseConnection } from '../../database';
import { openMigratedTestDatabase } from './testDatabase';

const createdAt = '2026-08-08T04:00:00.000Z';
const updatedAt = '2026-08-08T05:00:00.000Z';

function pendingTransaction(
  id: string,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    revision: 1,
    type: 'EXPENSE',
    amountMinor: 2500,
    currency: 'CNY',
    occurredAt: createdAt,
    source: 'TEXT',
    originalText: '公共交通有限公司 25 元',
    confidence: 0.62,
    requiresReview: true,
    reviewReasonCodes: ['MISSING_FIELDS'],
    confirmationStatus: 'PENDING',
    duplicateStatus: 'NONE',
    createdAt,
    updatedAt: createdAt,
    syncStatus: 'LOCAL_ONLY',
    ...overrides,
  };
}

describe('pending inline review repository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('fills account and subcategory without confirming the transaction', async () => {
    const repositories = createRepositories(database);
    await repositories.transactions.create(pendingTransaction('pending-fill'));

    const categoryResult = await repositories.transactions.reviewPendingBatch(
      [{ id: 'pending-fill', revision: 1 }],
      { categoryId: 'category-expense-transport-bus' },
      updatedAt,
    );
    expect(categoryResult).toMatchObject({
      appliedIds: ['pending-fill'],
      conflictedIds: [],
      invalidStateIds: [],
      missingIds: [],
    });

    const accountResult = await repositories.transactions.reviewPendingBatch(
      [{ id: 'pending-fill', revision: 2 }],
      { accountId: 'account-alipay' },
      '2026-08-08T06:00:00.000Z',
    );
    expect(accountResult.appliedIds).toEqual(['pending-fill']);
    await expect(
      repositories.transactions.findById('pending-fill'),
    ).resolves.toMatchObject({
      revision: 3,
      categoryId: 'category-expense-transport',
      subcategoryId: 'category-expense-transport-bus',
      accountId: 'account-alipay',
      confirmationStatus: 'PENDING',
      requiresReview: false,
      reviewReasonCodes: [],
    });
  });

  it('only clears risks resolved by the selected field', async () => {
    const repositories = createRepositories(database);
    await repositories.transactions.create(
      pendingTransaction('pending-risk', {
        reviewReasonCodes: [
          'MISSING_FIELDS',
          'CONFIDENCE_NOT_HIGH',
          'CATEGORY_ALTERNATIVES',
        ],
      }),
    );

    await repositories.transactions.reviewPendingBatch(
      [{ id: 'pending-risk', revision: 1 }],
      { categoryId: 'category-expense-transport-bus' },
      updatedAt,
    );

    await expect(
      repositories.transactions.findById('pending-risk'),
    ).resolves.toMatchObject({
      requiresReview: true,
      reviewReasonCodes: ['MISSING_FIELDS', 'CONFIDENCE_NOT_HIGH'],
    });
  });

  it('reports stale, non-pending, missing, and incompatible rows separately', async () => {
    const repositories = createRepositories(database);
    await repositories.transactions.create(pendingTransaction('pending-stale'));
    await repositories.transactions.create(
      pendingTransaction('already-confirmed', {
        categoryId: 'category-expense-food',
        accountId: 'account-cash',
        confidence: 1,
        requiresReview: false,
        reviewReasonCodes: [],
        confirmationStatus: 'CONFIRMED',
      }),
    );

    const result = await repositories.transactions.reviewPendingBatch(
      [
        { id: 'pending-stale', revision: 0 },
        { id: 'already-confirmed', revision: 1 },
        { id: 'does-not-exist', revision: 1 },
      ],
      { accountId: 'account-alipay' },
      updatedAt,
    );
    expect(result).toEqual({
      appliedIds: [],
      conflictedIds: ['pending-stale'],
      invalidStateIds: ['already-confirmed'],
      missingIds: ['does-not-exist'],
    });

    const incompatible = await repositories.transactions.reviewPendingBatch(
      [{ id: 'pending-stale', revision: 1 }],
      { categoryId: 'category-income-salary' },
      updatedAt,
    );
    expect(incompatible.invalidStateIds).toEqual(['pending-stale']);
  });

  it('rejects hidden choices before changing any selected row', async () => {
    const repositories = createRepositories(database);
    await repositories.transactions.create(pendingTransaction('pending-a'));
    await repositories.transactions.create(pendingTransaction('pending-b'));
    await database.execute('UPDATE accounts SET is_hidden = 1 WHERE id = ?', [
      'account-alipay',
    ]);

    await expect(
      repositories.transactions.reviewPendingBatch(
        [
          { id: 'pending-a', revision: 1 },
          { id: 'pending-b', revision: 1 },
        ],
        { accountId: 'account-alipay' },
        updatedAt,
      ),
    ).rejects.toMatchObject({
      code: 'LEDGER-WRITE-INVALID',
      reason: 'Selected account is unavailable.',
    });
    const pendingA = await repositories.transactions.findById('pending-a');
    const pendingB = await repositories.transactions.findById('pending-b');
    expect(pendingA?.revision).toBe(1);
    expect(pendingA?.accountId).toBeUndefined();
    expect(pendingB?.revision).toBe(1);
    expect(pendingB?.accountId).toBeUndefined();
  });

  it('soft-deletes only pending rows in one batch', async () => {
    const repositories = createRepositories(database);
    await repositories.transactions.create(
      pendingTransaction('pending-delete'),
    );
    await repositories.transactions.create(
      pendingTransaction('confirmed-keep', {
        categoryId: 'category-expense-food',
        accountId: 'account-cash',
        confidence: 1,
        requiresReview: false,
        reviewReasonCodes: [],
        confirmationStatus: 'CONFIRMED',
      }),
    );

    const result = await repositories.transactions.softDeletePendingBatch(
      [
        { id: 'pending-delete', revision: 1 },
        { id: 'confirmed-keep', revision: 1 },
      ],
      updatedAt,
    );
    expect(result).toEqual({
      appliedIds: ['pending-delete'],
      conflictedIds: [],
      invalidStateIds: ['confirmed-keep'],
      missingIds: [],
    });
    await expect(
      repositories.transactions.findById('pending-delete'),
    ).resolves.toBeUndefined();
    await expect(
      repositories.transactions.findById('confirmed-keep'),
    ).resolves.toBeDefined();
  });
});
