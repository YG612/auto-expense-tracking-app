import type { Transaction } from '../domain/entities';
import {
  buildCorrectionLearningPlan,
  isReliableMerchantForLearning,
} from '../domain/services/personalizationLearning';

const original: Transaction = {
  id: 'transaction-1',
  type: 'EXPENSE',
  amountMinor: 1200,
  currency: 'CNY',
  occurredAt: '2026-08-05T08:00:00.000Z',
  categoryId: 'category-expense-food',
  subcategoryId: 'category-expense-food-other',
  accountId: 'account-wechat',
  merchantRawName: '一鸣',
  source: 'TEXT',
  originalText: '一鸣12元',
  confirmationStatus: 'PENDING',
  duplicateStatus: 'NONE',
  createdAt: '2026-08-05T08:00:00.000Z',
  updatedAt: '2026-08-05T08:00:00.000Z',
  syncStatus: 'LOCAL_ONLY',
};

const corrected: Transaction = {
  ...original,
  subcategoryId: 'category-expense-food-breakfast',
  confirmationStatus: 'CONFIRMED',
  updatedAt: '2026-08-05T08:01:00.000Z',
};

describe('personalization correction planning', () => {
  it('creates merchant learning only for an actual confirmed text correction', () => {
    expect(
      buildCorrectionLearningPlan(
        original,
        corrected,
        corrected.updatedAt,
        'feedback-1',
        'rule-1',
      ),
    ).toEqual({
      feedback: expect.objectContaining({
        id: 'feedback-1',
        transactionId: original.id,
        originalSubcategoryId: 'category-expense-food-other',
        correctedSubcategoryId: 'category-expense-food-breakfast',
        merchantRawName: '一鸣',
        sourceText: '一鸣12元',
      }),
      learnedMerchantRule: expect.objectContaining({
        id: 'rule-1',
        origin: 'LEARNED_MERCHANT',
        ruleType: 'MERCHANT',
        pattern: '一鸣',
        categoryId: 'category-expense-food',
        subcategoryId: 'category-expense-food-breakfast',
        usageCount: 0,
      }),
    });
    expect(
      buildCorrectionLearningPlan(
        original,
        corrected,
        corrected.updatedAt,
        'feedback-1',
        'rule-1',
      )?.learnedMerchantRule?.accountId,
    ).toBeUndefined();
  });

  it('does not learn from manual entry, unchanged, pending or merged records', () => {
    const values: Array<[Transaction, Transaction]> = [
      [{ ...original, source: 'MANUAL' }, corrected],
      [original, { ...original, confirmationStatus: 'CONFIRMED' }],
      [original, { ...corrected, confirmationStatus: 'PENDING' }],
      [original, { ...corrected, duplicateStatus: 'MERGED' }],
    ];

    for (const [before, after] of values) {
      expect(
        buildCorrectionLearningPlan(
          before,
          after,
          after.updatedAt,
          'feedback',
          'rule',
        ),
      ).toBeUndefined();
    }
  });

  it('records account-only feedback without auto-learning an account rule', () => {
    const plan = buildCorrectionLearningPlan(
      original,
      {
        ...original,
        accountId: 'account-alipay',
        confirmationStatus: 'CONFIRMED',
      },
      corrected.updatedAt,
      'feedback-account',
      'unused-rule',
    );

    expect(plan?.feedback.correctedAccountId).toBe('account-alipay');
    expect(plan?.learnedMerchantRule).toBeUndefined();
  });

  it('records but does not promote personal recipients or broad merchants', () => {
    const personal = buildCorrectionLearningPlan(
      { ...original, merchantRawName: '张三', originalText: '支付给张三12元' },
      { ...corrected, merchantRawName: '张三' },
      corrected.updatedAt,
      'feedback-personal',
      'rule-personal',
    );
    const broad = buildCorrectionLearningPlan(
      { ...original, merchantRawName: '淘宝', originalText: '淘宝12元' },
      { ...corrected, merchantRawName: '淘宝' },
      corrected.updatedAt,
      'feedback-broad',
      'rule-broad',
    );

    expect(personal?.feedback).toBeDefined();
    expect(personal?.learnedMerchantRule).toBeUndefined();
    expect(broad?.feedback).toBeDefined();
    expect(broad?.learnedMerchantRule).toBeUndefined();
  });

  it('accepts voice final text but rejects unreliable merchant names', () => {
    const voice = buildCorrectionLearningPlan(
      { ...original, source: 'VOICE' },
      { ...corrected, source: 'VOICE' },
      corrected.updatedAt,
      'feedback-voice',
      'rule-voice',
    );

    expect(voice?.learnedMerchantRule?.pattern).toBe('一鸣');
    expect(isReliableMerchantForLearning('A', 'A12元')).toBe(false);
    expect(isReliableMerchantForLearning(undefined, '早餐12元')).toBe(false);
  });
});
