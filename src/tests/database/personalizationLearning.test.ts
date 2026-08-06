import type {
  ClassificationFeedback,
  Merchant,
  Tag,
  Transaction,
  UserRule,
} from '../../domain/entities';
import { parseTextTransactions } from '../../classification/parseTextTransactions';
import { createRepositories, type DatabaseConnection } from '../../database';
import { openMigratedTestDatabase } from './testDatabase';

const baseTime = '2026-08-05T08:00:00.000Z';
const foodCategoryId = 'category-expense-food';
const breakfastCategoryId = 'category-expense-food-breakfast';
const lunchCategoryId = 'category-expense-food-lunch';

function timeAt(sequence: number): string {
  return `2026-08-05T08:${String(sequence).padStart(2, '0')}:00.000Z`;
}

function transaction(
  id: string,
  sequence: number,
  confirmationStatus: Transaction['confirmationStatus'] = 'CONFIRMED',
): Transaction {
  const timestamp = timeAt(sequence);
  return {
    id,
    type: 'EXPENSE',
    amountMinor: 1200,
    currency: 'CNY',
    occurredAt: timestamp,
    categoryId: foodCategoryId,
    subcategoryId: breakfastCategoryId,
    accountId: 'account-wechat',
    merchantRawName: '一鸣',
    source: 'TEXT',
    originalText: `一鸣消费${sequence}元`,
    confirmationStatus,
    duplicateStatus: 'NONE',
    createdAt: timestamp,
    updatedAt: timestamp,
    syncStatus: 'LOCAL_ONLY',
  };
}

function feedback(
  id: string,
  transactionId: string,
  sequence: number,
  correctedSubcategoryId = breakfastCategoryId,
): ClassificationFeedback {
  return {
    id,
    transactionId,
    originalType: 'EXPENSE',
    correctedType: 'EXPENSE',
    originalCategoryId: 'category-expense-shopping',
    correctedCategoryId: foodCategoryId,
    originalSubcategoryId: 'category-expense-shopping-daily_supplies',
    correctedSubcategoryId,
    sourceText: `一鸣消费${sequence}元`,
    merchantRawName: '一鸣',
    createdAt: timeAt(sequence),
  };
}

function learnedRule(
  id: string,
  correctedSubcategoryId = breakfastCategoryId,
): UserRule {
  return {
    id,
    ruleType: 'MERCHANT',
    origin: 'LEARNED_MERCHANT',
    pattern: '一鸣',
    transactionType: 'EXPENSE',
    categoryId: foodCategoryId,
    subcategoryId: correctedSubcategoryId,
    priority: 100,
    enabled: true,
    usageCount: 0,
    createdAt: baseTime,
    updatedAt: baseTime,
  };
}

describe('personalization learning repositories', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('manages merchant aliases/defaults and learned-rule lifecycle', async () => {
    const repositories = createRepositories(database);
    const merchant: Merchant = {
      id: 'merchant-yiming',
      canonicalName: '一鸣真鲜奶吧',
      normalizedName: '一鸣真鲜奶吧',
      aliases: ['一鸣', '一鸣奶吧'],
      createdAt: baseTime,
      updatedAt: baseTime,
    };
    const lowPriorityRule: UserRule = {
      ...learnedRule('rule-low'),
      origin: 'USER_CREATED',
      pattern: '早餐',
      ruleType: 'KEYWORD',
      priority: 10,
    };
    const learned = learnedRule('rule-learned');

    await repositories.merchants.create(merchant);
    await repositories.userRules.create(lowPriorityRule);
    await repositories.userRules.create(learned);

    await expect(
      repositories.merchants.findByNameOrAlias('  一鸣  '),
    ).resolves.toEqual(merchant);
    await expect(
      repositories.merchants.updateDefaults(
        merchant.id,
        {
          categoryId: foodCategoryId,
          subcategoryId: breakfastCategoryId,
        },
        timeAt(1),
      ),
    ).resolves.toBe(true);
    await expect(repositories.userRules.listEnabled()).resolves.toEqual([
      learned,
      lowPriorityRule,
    ]);
    await expect(
      repositories.userRules.list({ origins: ['LEARNED_MERCHANT'] }),
    ).resolves.toEqual([learned]);

    await repositories.userRules.setPriority(learned.id, 5, timeAt(2));
    await expect(
      repositories.userRules.isLearnedMerchantSuppressed(learned.pattern),
    ).resolves.toBe(true);
    await repositories.userRules.setEnabled(learned.id, false, timeAt(3));
    await repositories.userRules.recordUsage(learned.id, timeAt(4));

    await expect(repositories.userRules.findById(learned.id)).resolves.toEqual({
      ...learned,
      origin: 'USER_CREATED',
      priority: 5,
      enabled: false,
      usageCount: 1,
      lastUsedAt: timeAt(4),
      updatedAt: timeAt(4),
    });
    await expect(repositories.userRules.listEnabled()).resolves.toEqual([
      lowPriorityRule,
    ]);

    const editedRule = {
      ...learned,
      pattern: '一鸣真鲜奶吧',
      updatedAt: timeAt(5),
    };
    await repositories.userRules.update(editedRule);
    await expect(repositories.userRules.findById(learned.id)).resolves.toEqual({
      ...editedRule,
      origin: 'USER_CREATED',
    });
    await expect(repositories.userRules.remove(learned.id)).resolves.toBe(true);
    await expect(repositories.merchants.remove(merchant.id)).resolves.toBe(
      true,
    );
  });

  it('preserves learned origin on toggle and suppresses the old pattern on edit', async () => {
    const repositories = createRepositories(database);
    const toggleOnlyRule = {
      ...learnedRule('rule-toggle-only'),
      pattern: '仅启停商户',
    };
    const editedRule = {
      ...learnedRule('rule-edit'),
      pattern: '编辑前商户',
    };

    await repositories.userRules.create(toggleOnlyRule);
    await repositories.userRules.setEnabled(
      toggleOnlyRule.id,
      false,
      timeAt(1),
    );
    await expect(
      repositories.userRules.findById(toggleOnlyRule.id),
    ).resolves.toMatchObject({
      origin: 'LEARNED_MERCHANT',
      enabled: false,
    });
    await repositories.userRules.remove(toggleOnlyRule.id, timeAt(2));
    await expect(
      repositories.userRules.isLearnedMerchantSuppressed(
        toggleOnlyRule.pattern,
      ),
    ).resolves.toBe(true);

    await repositories.userRules.create(editedRule);
    await repositories.userRules.update({
      ...editedRule,
      pattern: '编辑后商户',
      updatedAt: timeAt(3),
    });
    await expect(
      repositories.userRules.findById(editedRule.id),
    ).resolves.toMatchObject({
      origin: 'USER_CREATED',
      pattern: '编辑后商户',
    });
    await expect(
      repositories.userRules.isLearnedMerchantSuppressed(editedRule.pattern),
    ).resolves.toBe(true);
    await expect(
      repositories.userRules.isLearnedMerchantSuppressed('编辑后商户'),
    ).resolves.toBe(false);
  });

  it('pauses feedback collection without disabling existing rules', async () => {
    const repositories = createRepositories(database);
    const rule: UserRule = {
      ...learnedRule('rule-user-created'),
      origin: 'USER_CREATED',
    };

    await repositories.userRules.create(rule);
    await repositories.personalizationSettings.setLearningEnabled(
      false,
      timeAt(2),
    );

    await expect(repositories.personalizationSettings.get()).resolves.toEqual({
      learningEnabled: false,
      updatedAt: timeAt(2),
    });
    await expect(
      repositories.classificationFeedback.saveCorrectedTransactionWithTags({
        transaction: transaction('paused-tx', 1),
        tagIds: [],
        feedback: feedback('paused-feedback', 'paused-tx', 3),
        correctionOptions: {
          learnedMerchantRule: learnedRule('paused-candidate'),
        },
      }),
    ).resolves.toEqual({
      recorded: false,
      promotionStatus: 'LEARNING_PAUSED',
      streakCount: 0,
    });
    await expect(
      repositories.classificationFeedback.listAll(),
    ).resolves.toEqual([]);
    await expect(
      repositories.transactions.findById('paused-tx'),
    ).resolves.toBeDefined();
    await expect(repositories.userRules.listEnabled()).resolves.toEqual([rule]);
  });

  it('atomically saves a corrected transaction, tags and feedback', async () => {
    const repositories = createRepositories(database);
    const tag: Tag = {
      id: 'tag-breakfast',
      name: '早餐打卡',
      createdAt: baseTime,
      updatedAt: baseTime,
    };
    const savedTransaction = transaction('atomic-tx', 1);
    const savedFeedback = feedback('atomic-feedback', savedTransaction.id, 2);

    await repositories.tags.create(tag);
    await expect(
      repositories.classificationFeedback.saveCorrectedTransactionWithTags({
        transaction: savedTransaction,
        tagIds: [tag.id, tag.id],
        feedback: savedFeedback,
      }),
    ).resolves.toEqual({
      recorded: true,
      promotionStatus: 'NOT_REQUESTED',
      streakCount: 0,
    });
    await expect(
      repositories.transactions.findById(savedTransaction.id),
    ).resolves.toEqual(savedTransaction);
    await expect(
      repositories.transactionTags.listForTransaction(savedTransaction.id),
    ).resolves.toEqual([tag]);
    await expect(
      repositories.classificationFeedback.findById(savedFeedback.id),
    ).resolves.toEqual({
      ...savedFeedback,
      learningStatus: 'PENDING',
    });

    const failedTransaction = transaction('atomic-failed-tx', 3);
    await expect(
      repositories.classificationFeedback.saveCorrectedTransactionWithTags({
        transaction: failedTransaction,
        tagIds: ['missing-tag'],
        feedback: feedback('atomic-failed-feedback', failedTransaction.id, 4),
      }),
    ).rejects.toThrow();
    await expect(
      repositories.transactions.findById(failedTransaction.id),
    ).resolves.toBeUndefined();
    await expect(
      repositories.classificationFeedback.findById('atomic-failed-feedback'),
    ).resolves.toBeUndefined();

    await expect(
      repositories.classificationFeedback.saveCorrectedTransactionWithTags({
        transaction: {
          ...transaction('merged-tx', 5),
          duplicateStatus: 'MERGED',
        },
        tagIds: [],
        feedback: feedback('merged-feedback', 'merged-tx', 5),
      }),
    ).rejects.toThrow('MERGED');
    await expect(
      repositories.transactions.findById('merged-tx'),
    ).resolves.toBeUndefined();
  });

  it('promotes three eligible corrections and applies the rule to the fourth input', async () => {
    const repositories = createRepositories(database);
    const breakfastRule = learnedRule('rule-breakfast');

    await repositories.transactions.create(transaction('tx-1', 1));
    await repositories.transactions.create(transaction('tx-2', 2));
    await repositories.transactions.create(
      transaction('tx-pending', 3, 'PENDING'),
    );
    await repositories.transactions.create(transaction('tx-deleted', 4));
    await repositories.transactions.create({
      ...transaction('tx-manual', 5),
      source: 'MANUAL',
    });
    await repositories.transactions.create({
      ...transaction('tx-merged', 5),
      duplicateStatus: 'MERGED',
    });
    await repositories.transactions.softDelete('tx-deleted', timeAt(5));

    await expect(
      repositories.classificationFeedback.recordCorrection(
        feedback('feedback-1a', 'tx-1', 6),
        { learnedMerchantRule: breakfastRule },
      ),
    ).resolves.toMatchObject({
      promotionStatus: 'INSUFFICIENT_STREAK',
      streakCount: 1,
    });
    await expect(
      repositories.classificationFeedback.recordCorrection(
        feedback('feedback-1b', 'tx-1', 7),
        { learnedMerchantRule: breakfastRule },
      ),
    ).resolves.toMatchObject({
      promotionStatus: 'INSUFFICIENT_STREAK',
      streakCount: 1,
    });
    await expect(
      repositories.classificationFeedback.recordCorrection(
        feedback('feedback-2', 'tx-2', 8),
        { learnedMerchantRule: breakfastRule },
      ),
    ).resolves.toMatchObject({
      promotionStatus: 'INSUFFICIENT_STREAK',
      streakCount: 2,
    });
    await expect(
      repositories.classificationFeedback.recordCorrection(
        feedback('feedback-pending', 'tx-pending', 9),
        { learnedMerchantRule: breakfastRule },
      ),
    ).resolves.toMatchObject({
      recorded: false,
      promotionStatus: 'INELIGIBLE_TRANSACTION',
    });
    await expect(
      repositories.classificationFeedback.recordCorrection(
        feedback('feedback-deleted', 'tx-deleted', 10),
        { learnedMerchantRule: breakfastRule },
      ),
    ).resolves.toMatchObject({
      recorded: false,
      promotionStatus: 'INELIGIBLE_TRANSACTION',
    });
    await expect(
      repositories.classificationFeedback.recordCorrection(
        feedback('feedback-manual', 'tx-manual', 10),
        { learnedMerchantRule: breakfastRule },
      ),
    ).resolves.toMatchObject({
      recorded: false,
      promotionStatus: 'INELIGIBLE_TRANSACTION',
    });
    await expect(
      repositories.classificationFeedback.recordCorrection(
        feedback('feedback-merged', 'tx-merged', 10),
        { learnedMerchantRule: breakfastRule },
      ),
    ).resolves.toMatchObject({
      recorded: false,
      promotionStatus: 'INELIGIBLE_TRANSACTION',
    });

    for (let sequence = 11; sequence <= 14; sequence += 1) {
      await repositories.transactions.create(
        transaction(`tx-${sequence}`, sequence),
      );
    }

    await expect(
      repositories.classificationFeedback.recordCorrection(
        feedback('feedback-lunch', 'tx-11', 11, lunchCategoryId),
        {
          learnedMerchantRule: learnedRule('rule-lunch', lunchCategoryId),
        },
      ),
    ).resolves.toMatchObject({ streakCount: 1 });
    await expect(
      repositories.classificationFeedback.recordCorrection(
        feedback('feedback-12', 'tx-12', 12),
        { learnedMerchantRule: breakfastRule },
      ),
    ).resolves.toMatchObject({ streakCount: 1 });
    await expect(
      repositories.classificationFeedback.recordCorrection(
        feedback('feedback-13', 'tx-13', 13),
        { learnedMerchantRule: breakfastRule },
      ),
    ).resolves.toMatchObject({ streakCount: 2 });
    await expect(
      repositories.classificationFeedback.recordCorrection(
        feedback('feedback-14', 'tx-14', 14),
        { learnedMerchantRule: breakfastRule, processedAt: timeAt(15) },
      ),
    ).resolves.toEqual({
      recorded: true,
      promotionStatus: 'PROMOTED',
      streakCount: 3,
      promotedRuleId: breakfastRule.id,
    });

    await expect(
      repositories.userRules.findById(breakfastRule.id),
    ).resolves.toEqual(breakfastRule);
    const promoted =
      await repositories.classificationFeedback.listForMerchant('一鸣');
    expect(
      promoted
        .filter(item => item.learningStatus === 'PROMOTED')
        .map(item => item.transactionId),
    ).toEqual(['tx-14', 'tx-13', 'tx-12']);
    expect(promoted.some(item => item.id === 'feedback-pending')).toBe(false);
    expect(promoted.some(item => item.id === 'feedback-deleted')).toBe(false);

    const [categories, accounts, enabledRules] = await Promise.all([
      repositories.categories.listVisible(),
      repositories.accounts.listVisibleByUsage(),
      repositories.userRules.listEnabled(),
    ]);
    const fourthCandidate = parseTextTransactions('一鸣12元。', {
      referenceDate: new Date('2026-08-05T09:00:00.000Z'),
      recentAccountKey: 'WECHAT',
      categories,
      accounts,
      userRules: enabledRules,
      merchants: [],
    }).candidates[0];

    expect(fourthCandidate).toMatchObject({
      suggestionSource: 'LEARNED_MERCHANT',
      matchedRuleId: breakfastRule.id,
      categoryIdHint: foodCategoryId,
      subcategoryIdHint: breakfastCategoryId,
    });
  });

  it('suppresses a deleted learned merchant rule from being recreated', async () => {
    const repositories = createRepositories(database);
    const initialRule = learnedRule('rule-initial');

    for (let sequence = 1; sequence <= 3; sequence += 1) {
      const transactionId = `initial-tx-${sequence}`;
      await repositories.transactions.create(
        transaction(transactionId, sequence),
      );
      await repositories.classificationFeedback.recordCorrection(
        feedback(`initial-feedback-${sequence}`, transactionId, sequence),
        { learnedMerchantRule: initialRule },
      );
    }

    await expect(
      repositories.userRules.remove(initialRule.id, timeAt(4)),
    ).resolves.toBe(true);
    await expect(
      repositories.userRules.isLearnedMerchantSuppressed(initialRule.pattern),
    ).resolves.toBe(true);

    const replacement = learnedRule('rule-replacement');
    let finalResult;

    for (let sequence = 5; sequence <= 7; sequence += 1) {
      const transactionId = `replacement-tx-${sequence}`;
      await repositories.transactions.create(
        transaction(transactionId, sequence),
      );
      finalResult = await repositories.classificationFeedback.recordCorrection(
        feedback(`replacement-feedback-${sequence}`, transactionId, sequence),
        { learnedMerchantRule: replacement },
      );
    }

    expect(finalResult).toEqual({
      recorded: true,
      promotionStatus: 'SUPPRESSED',
      streakCount: 3,
    });
    await expect(
      repositories.userRules.findById(replacement.id),
    ).resolves.toBeUndefined();
    await expect(
      repositories.userRules.listLearnedSuppressions(),
    ).resolves.toEqual([
      {
        ruleType: 'MERCHANT',
        pattern: '一鸣',
        suppressedAt: timeAt(4),
      },
    ]);
  });
});
