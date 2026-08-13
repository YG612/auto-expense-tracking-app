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
        { id: built.transaction.id, revision: built.transaction.revision },
        '2026-08-04T07:22:00.000Z',
      ),
    ).resolves.toMatchObject({ status: 'APPLIED' });
    await expect(repositories.transactions.countPending()).resolves.toBe(0);
    await expect(
      repositories.transactions.confirmPending(
        { id: built.transaction.id, revision: built.transaction.revision },
        '2026-08-04T07:23:00.000Z',
      ),
    ).resolves.toEqual({ status: 'CONFLICT' });
  });

  it('persists ordinary income with an income category', async () => {
    const repositories = createRepositories(database);
    const [categories, accounts, projects, tags] = await Promise.all([
      repositories.categories.listVisible(),
      repositories.accounts.listVisible(),
      repositories.projects.listActive(),
      repositories.tags.listAll(),
    ]);
    const candidate = parseTextTransactions('工资8000元，微信收的。', {
      referenceDate: new Date('2026-08-08T08:00:00.000Z'),
      timezoneOffsetMinutes: 480,
      categories,
      accounts,
    }).candidates[0];
    if (candidate === undefined) {
      throw new Error('Expected one income candidate.');
    }

    const built = buildTextTransaction(
      candidate,
      { categories, accounts, projects, tags },
      'transaction-text-salary',
      '2026-08-08T08:01:00.000Z',
      'CONFIRMED',
    );
    expect(built.transaction).toMatchObject({
      type: 'INCOME',
      amountMinor: 800_000,
      categoryId: 'category-income-salary',
      accountId: 'account-wechat',
      confirmationStatus: 'CONFIRMED',
    });

    await repositories.transactions.saveWithTags(
      built.transaction,
      built.tagIds,
    );
    await expect(
      repositories.transactions.listSummaries({
        type: 'INCOME',
        confirmationStatus: 'CONFIRMED',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: built.transaction.id,
        categoryType: 'INCOME',
        categoryName: '工资',
      }),
    ]);
  });

  it('ignores an incompatible historical category instead of mixing directions', async () => {
    const repositories = createRepositories(database);
    const [categories, accounts] = await Promise.all([
      repositories.categories.listVisible(),
      repositories.accounts.listVisible(),
    ]);
    const candidate = parseTextTransactions('收入100元，微信收的。', {
      referenceDate: new Date('2026-08-08T08:00:00.000Z'),
      timezoneOffsetMinutes: 480,
      categories,
      accounts,
      userRules: [
        {
          id: 'rule-stale-expense',
          ruleType: 'KEYWORD',
          pattern: '收入',
          transactionType: 'EXPENSE',
          categoryId: 'category-expense-food',
          subcategoryId: 'category-expense-food-other',
          priority: 1000,
          enabled: true,
          usageCount: 0,
          createdAt: '2026-08-08T00:00:00.000Z',
          updatedAt: '2026-08-08T00:00:00.000Z',
        },
      ],
    }).candidates[0];

    expect(candidate).toMatchObject({
      type: 'INCOME',
      categoryKey: 'income.other',
      categoryIdHint: undefined,
      subcategoryIdHint: undefined,
      ambiguityReasons: [],
      advisoryReasons: expect.arrayContaining([
        '历史分类与当前交易类型不一致，已安全忽略',
      ]),
    });
  });

  it('refuses to persist an income transaction with an expense category', async () => {
    const repositories = createRepositories(database);
    const [categories, accounts, projects, tags] = await Promise.all([
      repositories.categories.listVisible(),
      repositories.accounts.listVisible(),
      repositories.projects.listActive(),
      repositories.tags.listAll(),
    ]);
    const candidate = parseTextTransactions('午饭25元，微信付的。', {
      referenceDate: new Date('2026-08-08T08:00:00.000Z'),
      timezoneOffsetMinutes: 480,
      categories,
      accounts,
    }).candidates[0];
    if (candidate === undefined) {
      throw new Error('Expected one expense candidate.');
    }

    expect(() =>
      buildTextTransaction(
        { ...candidate, type: 'INCOME' },
        { categories, accounts, projects, tags },
        'transaction-invalid-income',
        '2026-08-08T08:01:00.000Z',
        'CONFIRMED',
      ),
    ).toThrow('交易类型与分类方向不一致');
  });

  it('batch-confirms only selected pending records', async () => {
    const repositories = createRepositories(database);
    const [categories, accounts, projects, tags] = await Promise.all([
      repositories.categories.listVisible(),
      repositories.accounts.listVisible(),
      repositories.projects.listActive(),
      repositories.tags.listAll(),
    ]);
    const candidates = parseTextTransactions(
      '午饭25元微信付，打车18元微信付，水果32元微信付。',
      {
        referenceDate: new Date('2026-08-04T07:20:00.000Z'),
        timezoneOffsetMinutes: 480,
        recentAccountKey: 'WECHAT',
        categories,
        accounts,
      },
    ).candidates;

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
        [
          { id: 'transaction-text-0', revision: 1 },
          { id: 'transaction-text-2', revision: 1 },
        ],
        '2026-08-04T07:22:00.000Z',
      ),
    ).resolves.toMatchObject({
      confirmedIds: ['transaction-text-0', 'transaction-text-2'],
      conflictedIds: [],
    });
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
