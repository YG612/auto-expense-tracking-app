import { parseTextTransactions } from '../classification/parseTextTransactions';
import { createRepositories, type DatabaseConnection } from '../database';
import {
  buildTextTransaction,
  canDirectlyConfirmTextTransaction,
} from '../domain/services/textTransaction';
import { openMigratedTestDatabase } from './database/testDatabase';

describe('stage 5 text candidate persistence', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('persists TEXT metadata as pending and confirms it atomically', async () => {
    const repositories = createRepositories(database);
    const [categories, accounts, projects, tags] = await Promise.all([
      repositories.categories.listVisible(),
      repositories.accounts.listVisible(),
      repositories.projects.listActive(),
      repositories.tags.listAll(),
    ]);
    const candidate = parseTextTransactions('午饭花了25元，微信付的。', {
      referenceDate: new Date('2026-08-04T07:20:00.000Z'),
      timezoneOffsetMinutes: 480,
      categories,
      accounts,
    }).candidates[0];
    if (candidate === undefined) {
      throw new Error('Expected one candidate.');
    }

    const built = buildTextTransaction(
      candidate,
      { categories, accounts, projects, tags },
      'transaction-text-lunch',
      '2026-08-04T07:21:00.000Z',
      'PENDING',
    );
    expect(built.transaction).toMatchObject({
      source: 'TEXT',
      originalText: '午饭花了25元，微信付的。',
      amountMinor: 2500,
      categoryId: 'category-expense-food',
      subcategoryId: 'category-expense-food-lunch',
      accountId: 'account-wechat',
      confirmationStatus: 'PENDING',
    });
    expect(canDirectlyConfirmTextTransaction(built.transaction)).toBe(true);

    await repositories.transactions.saveWithTags(
      built.transaction,
      built.tagIds,
    );
    await expect(repositories.transactions.countPending()).resolves.toBe(1);
    await expect(
      repositories.transactions.listSummaries({
        confirmationStatus: 'PENDING',
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: 'transaction-text-lunch' }),
    ]);
    await expect(
      repositories.transactions.listSummaries({
        confirmationStatus: 'CONFIRMED',
      }),
    ).resolves.toEqual([]);

    await expect(
      repositories.transactions.confirmPending(
        built.transaction.id,
        '2026-08-04T07:22:00.000Z',
      ),
    ).resolves.toBe(true);
    await expect(repositories.transactions.countPending()).resolves.toBe(0);
    await expect(
      repositories.transactions.confirmPending(
        built.transaction.id,
        '2026-08-04T07:23:00.000Z',
      ),
    ).resolves.toBe(false);
  });

  it('batch-confirms only selected pending records', async () => {
    const repositories = createRepositories(database);
    const [categories, accounts, projects, tags] = await Promise.all([
      repositories.categories.listVisible(),
      repositories.accounts.listVisible(),
      repositories.projects.listActive(),
      repositories.tags.listAll(),
    ]);
    const candidates = parseTextTransactions('午饭25，打车18，水果32。', {
      referenceDate: new Date('2026-08-04T07:20:00.000Z'),
      timezoneOffsetMinutes: 480,
      recentAccountKey: 'WECHAT',
      categories,
      accounts,
    }).candidates;

    for (const [index, candidate] of candidates.entries()) {
      const built = buildTextTransaction(
        candidate,
        { categories, accounts, projects, tags },
        `transaction-text-${index}`,
        '2026-08-04T07:21:00.000Z',
        'PENDING',
      );
      await repositories.transactions.saveWithTags(
        built.transaction,
        built.tagIds,
      );
    }

    await expect(repositories.transactions.countPending()).resolves.toBe(3);
    await expect(
      repositories.transactions.confirmPendingBatch(
        ['transaction-text-0', 'transaction-text-2'],
        '2026-08-04T07:22:00.000Z',
      ),
    ).resolves.toBe(2);
    await expect(repositories.transactions.countPending()).resolves.toBe(1);
    await expect(
      repositories.transactions.listSummaries({
        confirmationStatus: 'CONFIRMED',
      }),
    ).resolves.toHaveLength(2);
  });

  it('stores ambiguous recharge without inventing a category', async () => {
    const repositories = createRepositories(database);
    const [categories, accounts, projects, tags] = await Promise.all([
      repositories.categories.listVisible(),
      repositories.accounts.listVisible(),
      repositories.projects.listActive(),
      repositories.tags.listAll(),
    ]);
    const candidate = parseTextTransactions('充值50元。', {
      referenceDate: new Date('2026-08-04T07:20:00.000Z'),
      timezoneOffsetMinutes: 480,
      categories,
      accounts,
    }).candidates[0];
    if (candidate === undefined) {
      throw new Error('Expected one candidate.');
    }
    const built = buildTextTransaction(
      candidate,
      { categories, accounts, projects, tags },
      'transaction-text-recharge',
      '2026-08-04T07:21:00.000Z',
      'PENDING',
    );
    expect(built.transaction).toMatchObject({
      categoryId: undefined,
      subcategoryId: undefined,
      confirmationStatus: 'PENDING',
    });
    expect(canDirectlyConfirmTextTransaction(built.transaction)).toBe(false);
  });
});
