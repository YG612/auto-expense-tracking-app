import type {
  Account,
  Budget,
  Category,
  ClassificationFeedback,
  ImportRecord,
  Merchant,
  Project,
  Tag,
  Transaction,
  UserRule,
} from '../../domain/entities';
import { createRepositories, type DatabaseConnection } from '../../database';
import { openMigratedTestDatabase } from './testDatabase';

const createdAt = '2026-07-20T08:00:00.000Z';

describe('database repositories', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('round-trips every documented entity through SQLite', async () => {
    const repositories = createRepositories(database);
    const category: Category = {
      id: 'category-food',
      type: 'EXPENSE',
      systemKey: 'test.expense.food',
      name: '测试餐饮',
      sortOrder: 10,
      isSystem: true,
      isHidden: false,
      createdAt,
      updatedAt: createdAt,
    };
    const subcategory: Category = {
      ...category,
      id: 'subcategory-lunch',
      parentId: category.id,
      systemKey: 'test.expense.food.lunch',
      name: '测试午餐',
      sortOrder: 20,
    };
    const account: Account = {
      id: 'account-test-wallet',
      name: '测试钱包',
      type: 'OTHER',
      currency: 'CNY',
      includeInNetWorth: true,
      openingBalanceMinor: 100_00,
      currentBalanceMinor: 75_00,
      sortOrder: 1,
      isHidden: false,
      createdAt,
      updatedAt: createdAt,
    };
    const project: Project = {
      id: 'project-shanghai',
      name: '上海旅行',
      budgetMinor: 5000_00,
      currency: 'CNY',
      isArchived: false,
      createdAt,
      updatedAt: createdAt,
    };
    const merchant: Merchant = {
      id: 'merchant-cafe',
      canonicalName: '示例餐厅',
      normalizedName: '示例餐厅',
      aliases: ['示例餐厅上海店'],
      defaultCategoryId: category.id,
      defaultSubcategoryId: subcategory.id,
      createdAt,
      updatedAt: createdAt,
    };
    const tag: Tag = {
      id: 'tag-friends',
      name: '朋友',
      createdAt,
      updatedAt: createdAt,
    };
    const transaction: Transaction = {
      id: 'transaction-lunch',
      type: 'EXPENSE',
      amountMinor: 2500,
      currency: 'CNY',
      occurredAt: '2026-07-20T12:00:00.000+08:00',
      categoryId: category.id,
      subcategoryId: subcategory.id,
      accountId: account.id,
      merchantId: merchant.id,
      merchantRawName: '示例餐厅上海店',
      projectId: project.id,
      note: '和朋友午饭',
      source: 'TEXT',
      originalText: '午饭花了25元',
      confidence: 1,
      confirmationStatus: 'CONFIRMED',
      duplicateStatus: 'NONE',
      fingerprint: 'manual-lunch-2500',
      createdAt,
      updatedAt: createdAt,
      syncStatus: 'LOCAL_ONLY',
    };
    const rule: UserRule = {
      id: 'rule-cafe',
      ruleType: 'MERCHANT',
      origin: 'USER_CREATED',
      pattern: '示例餐厅',
      transactionType: 'EXPENSE',
      categoryId: category.id,
      subcategoryId: subcategory.id,
      accountId: account.id,
      priority: 100,
      enabled: true,
      usageCount: 3,
      createdAt,
      updatedAt: createdAt,
    };
    const feedback: ClassificationFeedback = {
      id: 'feedback-lunch',
      transactionId: transaction.id,
      originalType: 'EXPENSE',
      correctedType: 'EXPENSE',
      originalCategoryId: category.id,
      correctedCategoryId: category.id,
      correctedSubcategoryId: subcategory.id,
      sourceText: '午饭花了25元',
      merchantRawName: '示例餐厅上海店',
      learningStatus: 'PENDING',
      createdAt,
    };
    const budget: Budget = {
      id: 'budget-food-july',
      periodType: 'MONTHLY',
      year: 2026,
      month: 7,
      categoryId: category.id,
      limitMinor: 1500_00,
      currency: 'CNY',
      createdAt,
      updatedAt: createdAt,
    };
    const importRecord: ImportRecord = {
      id: 'import-record-1',
      source: 'CSV',
      fileName: 'example.csv',
      rawContentHash: 'sha256-example',
      parsedCount: 10,
      importedCount: 8,
      duplicateCount: 1,
      failedCount: 1,
      createdAt,
    };

    await repositories.categories.create(category);
    await repositories.categories.create(subcategory);
    await repositories.accounts.create(account);
    await repositories.projects.create(project);
    await repositories.merchants.create(merchant);
    await repositories.tags.create(tag);
    await repositories.transactions.create(transaction);
    await repositories.transactionTags.replaceTags(transaction.id, [
      tag.id,
      tag.id,
    ]);
    await repositories.userRules.create(rule);
    await repositories.classificationFeedback.create(feedback);
    await repositories.budgets.create(budget);
    await repositories.importRecords.create(importRecord);

    await expect(
      repositories.categories.findById(category.id),
    ).resolves.toEqual(category);
    await expect(repositories.accounts.findById(account.id)).resolves.toEqual(
      account,
    );
    await expect(repositories.projects.findById(project.id)).resolves.toEqual(
      project,
    );
    await expect(repositories.merchants.findById(merchant.id)).resolves.toEqual(
      merchant,
    );
    await expect(repositories.tags.findById(tag.id)).resolves.toEqual(tag);
    await expect(
      repositories.transactions.findById(transaction.id),
    ).resolves.toEqual(transaction);
    await expect(
      repositories.transactionTags.listForTransaction(transaction.id),
    ).resolves.toEqual([tag]);
    await expect(repositories.userRules.findById(rule.id)).resolves.toEqual(
      rule,
    );
    await expect(
      repositories.classificationFeedback.findById(feedback.id),
    ).resolves.toEqual(feedback);
    await expect(repositories.budgets.findById(budget.id)).resolves.toEqual(
      budget,
    );
    await expect(
      repositories.importRecords.findById(importRecord.id),
    ).resolves.toEqual(importRecord);
  });

  it('stores money as integer minor units and soft-deletes by default', async () => {
    const repositories = createRepositories(database);
    const transaction: Transaction = {
      id: 'transaction-breakfast',
      type: 'EXPENSE',
      amountMinor: 1250,
      currency: 'CNY',
      occurredAt: '2026-07-20T08:30:00.000+08:00',
      source: 'TEXT',
      originalText: '今天早上买早餐12块5',
      confirmationStatus: 'CONFIRMED',
      duplicateStatus: 'NONE',
      createdAt,
      updatedAt: createdAt,
      syncStatus: 'LOCAL_ONLY',
    };

    await repositories.transactions.create(transaction);

    const rawAmount = await database.execute<{ amount_minor: number }>(
      'SELECT amount_minor FROM transactions WHERE id = ?',
      [transaction.id],
    );
    expect(rawAmount.rows[0]?.amount_minor).toBe(1250);

    const deletedAt = '2026-07-20T09:00:00.000Z';
    await expect(
      repositories.transactions.softDelete(transaction.id, deletedAt),
    ).resolves.toBe(true);
    await expect(
      repositories.transactions.findById(transaction.id),
    ).resolves.toBeUndefined();
    await expect(repositories.transactions.listAll()).resolves.toEqual([]);
    await expect(
      repositories.transactions.findById(transaction.id, {
        includeDeleted: true,
      }),
    ).resolves.toMatchObject({ id: transaction.id, deletedAt });

    const restoredAt = '2026-07-20T09:05:00.000Z';
    await expect(
      repositories.transactions.restore(transaction.id, restoredAt),
    ).resolves.toBe(true);
    await expect(
      repositories.transactions.findById(transaction.id),
    ).resolves.toMatchObject({
      id: transaction.id,
      amountMinor: 1250,
      deletedAt: undefined,
      updatedAt: restoredAt,
    });
  });

  it('enforces foreign keys and money constraints', async () => {
    const repositories = createRepositories(database);
    const invalidAmount: Transaction = {
      id: 'transaction-invalid-amount',
      type: 'EXPENSE',
      amountMinor: -1,
      currency: 'CNY',
      occurredAt: createdAt,
      source: 'MANUAL',
      confirmationStatus: 'CONFIRMED',
      duplicateStatus: 'NONE',
      createdAt,
      updatedAt: createdAt,
      syncStatus: 'LOCAL_ONLY',
    };

    await expect(
      repositories.transactions.create(invalidAmount),
    ).rejects.toThrow();
    await expect(
      repositories.transactions.create({
        ...invalidAmount,
        id: 'transaction-invalid-account',
        amountMinor: 1,
        accountId: 'missing-account',
      }),
    ).rejects.toThrow();
    await expect(repositories.transactions.listAll()).resolves.toEqual([]);
  });

  it('loads analytics metadata, related refund categories and pending counts', async () => {
    const repositories = createRepositories(database);
    const original: Transaction = {
      id: 'analytics-original-expense',
      type: 'EXPENSE',
      amountMinor: 5000,
      currency: 'CNY',
      occurredAt: '2026-08-04T04:00:00.000Z',
      categoryId: 'category-expense-food',
      subcategoryId: 'category-expense-food-lunch',
      accountId: 'account-wechat',
      source: 'MANUAL',
      confirmationStatus: 'CONFIRMED',
      duplicateStatus: 'NONE',
      createdAt,
      updatedAt: createdAt,
      syncStatus: 'LOCAL_ONLY',
    };
    const refund: Transaction = {
      ...original,
      id: 'analytics-related-refund',
      type: 'REFUND',
      amountMinor: 2000,
      categoryId: 'category-income-refund',
      subcategoryId: undefined,
      relatedTransactionId: original.id,
      occurredAt: '2026-08-05T04:00:00.000Z',
    };
    const pending: Transaction = {
      ...original,
      id: 'analytics-pending',
      confirmationStatus: 'PENDING',
      occurredAt: '2026-08-06T04:00:00.000Z',
    };

    await repositories.transactions.create(original);
    await repositories.transactions.create(refund);
    await repositories.transactions.create(pending);

    await expect(repositories.transactions.countPending()).resolves.toBe(1);

    const foodRows = await repositories.transactions.listSummaries({
      categoryId: 'category-expense-food',
      confirmationStatus: 'CONFIRMED',
      duplicateStatus: 'NONE',
    });

    expect(foodRows.map(row => row.id)).toEqual([refund.id, original.id]);
    expect(foodRows[0]).toMatchObject({
      categoryName: '退款',
      categoryType: 'INCOME',
      relatedCategoryId: 'category-expense-food',
      relatedCategoryName: '餐饮',
    });
    await expect(
      repositories.transactions.listSummaries({ limit: 1 }),
    ).resolves.toHaveLength(1);
  });
});
