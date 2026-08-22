import type { DatabaseConnection } from '../../database';
import { createRepositories } from '../../database';
import { parseStatementCsv } from '../../importers/statementCsv';
import { openMigratedTestDatabase } from './testDatabase';

function preview(reference = 'wx-import-1', merchant = '示例商户') {
  return parseStatementCsv({
    fileName: '微信账单.csv',
    content: [
      '微信支付账单',
      '交易时间,交易对方,收/支,金额(元),当前状态,交易单号,备注',
      `2026-08-13T12:00:00.000Z,${merchant},支出,12.30,支付成功,${reference},午餐`,
    ].join('\n'),
  });
}

describe('StatementImportRepository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => database.close());

  it('atomically imports pending rows, detects repeats, and can undo the batch', async () => {
    const repositories = createRepositories(database);
    const initialReview = await repositories.statementImport.analyze(preview());
    expect(initialReview.rows[0]?.duplicateKind).toBe('NONE');

    const committed = await repositories.statementImport.commit(
      initialReview,
      '2026-08-13T13:00:00.000Z',
    );
    expect(committed.transactionIds).toHaveLength(1);
    const transaction = await repositories.transactions.findById(
      committed.transactionIds[0]!,
    );
    expect(transaction).toMatchObject({
      source: 'WECHAT_IMPORT',
      sourceReferenceId: 'wx-import-1',
      confirmationStatus: 'PENDING',
      duplicateStatus: 'NONE',
      importRecordId: committed.importRecord.id,
      requiresReview: true,
      reviewReasonCodes: ['MISSING_FIELDS'],
    });
    expect(committed.importRecord).toMatchObject({
      parsedCount: 1,
      importedCount: 1,
      duplicateCount: 0,
      failedCount: 0,
    });

    const repeated = await repositories.statementImport.analyze(preview());
    expect(repeated.rows[0]).toMatchObject({
      duplicateKind: 'DEFINITE',
      existingTransactionId: transaction?.id,
    });
    const similar = await repositories.statementImport.analyze(
      preview('different-provider-id'),
    );
    expect(similar.rows[0]?.duplicateKind).toBe('POSSIBLE');

    await expect(
      repositories.statementImport.undo(
        committed.importRecord.id,
        '2026-08-13T14:00:00.000Z',
      ),
    ).resolves.toBe(1);
    await expect(
      repositories.transactions.findById(committed.transactionIds[0]!),
    ).resolves.toBeUndefined();
    await expect(
      repositories.statementImport.undo(
        committed.importRecord.id,
        '2026-08-13T14:01:00.000Z',
      ),
    ).resolves.toBe(0);
  });

  it('rolls back the audit record when one transaction is invalid', async () => {
    const repositories = createRepositories(database);
    const review = await repositories.statementImport.analyze(preview());
    const invalidReview = {
      ...review,
      rows: [
        {
          ...review.rows[0]!,
          candidate: { ...review.rows[0]!.candidate, amountMinor: 0 },
        },
      ],
    };

    await expect(
      repositories.statementImport.commit(
        invalidReview,
        '2026-08-13T13:00:00.000Z',
      ),
    ).rejects.toThrow();
    await expect(repositories.importRecords.listAll()).resolves.toEqual([]);
    await expect(repositories.transactions.listAll()).resolves.toEqual([]);
  });

  it('preclassifies official bill rows from an enabled merchant rule', async () => {
    const repositories = createRepositories(database);
    await repositories.userRules.create({
      id: 'rule-import-merchant',
      ruleType: 'MERCHANT',
      origin: 'USER_CREATED',
      pattern: '示例商户',
      transactionType: 'EXPENSE',
      categoryId: 'category-expense-food',
      subcategoryId: 'category-expense-food-lunch',
      accountId: 'account-wechat',
      priority: 100,
      enabled: true,
      usageCount: 0,
      createdAt: '2026-08-13T11:00:00.000Z',
      updatedAt: '2026-08-13T11:00:00.000Z',
    });

    const review = await repositories.statementImport.analyze(
      preview('wx-classified'),
    );
    expect(review.rows[0]?.candidate).toMatchObject({
      categoryIdHint: 'category-expense-food',
      subcategoryIdHint: 'category-expense-food-lunch',
      accountIdHint: 'account-wechat',
      classificationSource: 'USER_RULE',
    });
    const committed = await repositories.statementImport.commit(
      review,
      '2026-08-13T13:00:00.000Z',
    );
    await expect(
      repositories.transactions.findById(committed.transactionIds[0]!),
    ).resolves.toMatchObject({
      categoryId: 'category-expense-food',
      subcategoryId: 'category-expense-food-lunch',
      accountId: 'account-wechat',
      confirmationStatus: 'PENDING',
      requiresReview: false,
      reviewReasonCodes: [],
    });
  });

  it('uses the recognized provider account and classifies public transport merchants', async () => {
    const repositories = createRepositories(database);
    const review = await repositories.statementImport.analyze(
      preview('wx-public-transport', '某市公共交通有限公司'),
    );

    expect(review.rows[0]?.candidate).toMatchObject({
      source: 'WECHAT',
      accountIdHint: 'account-wechat',
      categoryIdHint: 'category-expense-transport',
      classificationSource: 'MERCHANT_NAME',
    });
    const committed = await repositories.statementImport.commit(
      review,
      '2026-08-13T13:00:00.000Z',
    );
    await expect(
      repositories.transactions.findById(committed.transactionIds[0]!),
    ).resolves.toMatchObject({
      accountId: 'account-wechat',
      categoryId: 'category-expense-transport',
      confirmationStatus: 'PENDING',
      requiresReview: false,
      reviewReasonCodes: [],
    });
  });

  it('keeps an unknown provider status under mandatory review', async () => {
    const repositories = createRepositories(database);
    const unknownStatusPreview = parseStatementCsv({
      fileName: '微信账单.csv',
      content: [
        '微信支付账单',
        '交易时间,交易对方,收/支,金额(元),交易单号,备注',
        '2026-08-13T12:00:00.000Z,某市公共交通有限公司,支出,2.00,wx-unknown-status,公交',
      ].join('\n'),
    });
    const review =
      await repositories.statementImport.analyze(unknownStatusPreview);
    expect(review.rows[0]?.candidate).toMatchObject({
      accountIdHint: 'account-wechat',
      categoryIdHint: 'category-expense-transport',
      settlementState: 'UNKNOWN',
    });

    const committed = await repositories.statementImport.commit(
      review,
      '2026-08-13T13:00:00.000Z',
    );
    await expect(
      repositories.transactions.findById(committed.transactionIds[0]!),
    ).resolves.toMatchObject({
      requiresReview: true,
      reviewReasonCodes: ['AMBIGUOUS'],
      confirmationStatus: 'PENDING',
    });
  });

  it('persists refunds, transfers and fees as distinct pending semantics', async () => {
    const repositories = createRepositories(database);
    const semanticPreview = parseStatementCsv({
      fileName: '支付宝账单.csv',
      content: [
        '支付宝账单',
        '交易时间,交易对方,收/支,金额(元),当前状态,交易单号,备注',
        '2026-08-13 09:00,早餐店,退款,12.00,退款成功,refund-semantic,退款',
        '2026-08-13 09:01,老王,转出,100.00,交易成功,transfer-semantic,转账',
        '2026-08-13 09:02,支付平台,退款,2.00,交易成功,fee-semantic,退款手续费',
      ].join('\n'),
    });
    const review = await repositories.statementImport.analyze(semanticPreview);
    const committed = await repositories.statementImport.commit(
      review,
      '2026-08-13T13:00:00.000Z',
    );
    const transactions = await Promise.all(
      committed.transactionIds.map(id =>
        repositories.transactions.findById(id),
      ),
    );

    expect(transactions.map(transaction => transaction?.type)).toEqual([
      'REFUND',
      'TRANSFER',
      'EXPENSE',
    ]);
    expect(
      transactions.every(
        transaction =>
          transaction?.confirmationStatus === 'PENDING' &&
          transaction.requiresReview === true,
      ),
    ).toBe(true);
  });

  it('applies an account-only rule before the provider account and still classifies the merchant', async () => {
    const repositories = createRepositories(database);
    await repositories.userRules.create({
      id: 'rule-import-account-only',
      ruleType: 'MERCHANT',
      origin: 'USER_CREATED',
      pattern: '某市公共交通有限公司',
      accountId: 'account-alipay',
      priority: 100,
      enabled: true,
      usageCount: 0,
      createdAt: '2026-08-13T11:00:00.000Z',
      updatedAt: '2026-08-13T11:00:00.000Z',
    });

    const review = await repositories.statementImport.analyze(
      preview('wx-account-rule', '某市公共交通有限公司'),
    );

    expect(review.rows[0]?.candidate).toMatchObject({
      accountIdHint: 'account-alipay',
      categoryIdHint: 'category-expense-transport',
      classificationSource: 'MERCHANT_NAME',
    });
  });

  it('rolls back every notification batch when a later batch fails and imports once on retry', async () => {
    const repositories = createRepositories(database);
    const first = await repositories.statementImport.analyze(
      preview('wx-atomic-first', '早餐店'),
    );
    const second = await repositories.statementImport.analyze(
      preview('wx-atomic-second', '公交集团'),
    );
    const invalidSecond = {
      ...second,
      rows: second.rows.map(row => ({
        ...row,
        candidate: { ...row.candidate, amountMinor: 0 },
      })),
    };

    await expect(
      repositories.statementImport.commitMany(
        [first, invalidSecond],
        '2026-08-13T13:00:00.000Z',
      ),
    ).rejects.toThrow();
    await expect(repositories.importRecords.listAll()).resolves.toEqual([]);
    await expect(repositories.transactions.listAll()).resolves.toEqual([]);

    const committed = await repositories.statementImport.commitMany(
      [first, second],
      '2026-08-13T13:01:00.000Z',
    );
    expect(committed.results).toHaveLength(2);
    expect(committed.transactionIds).toHaveLength(2);

    const retryReviews = await Promise.all([
      repositories.statementImport.analyze(
        preview('wx-atomic-first', '早餐店'),
      ),
      repositories.statementImport.analyze(
        preview('wx-atomic-second', '公交集团'),
      ),
    ]);
    await expect(
      repositories.statementImport.commitMany(
        retryReviews,
        '2026-08-13T13:02:00.000Z',
      ),
    ).resolves.toMatchObject({ transactionIds: [] });
    await expect(repositories.transactions.listAll()).resolves.toHaveLength(2);
  });
});
