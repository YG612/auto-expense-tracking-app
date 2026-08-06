import { parseTextTransactions } from '../classification/parseTextTransactions';
import type { Account, Category, Merchant, UserRule } from '../domain/entities';

const timestamp = '2026-08-05T00:00:00.000Z';
const referenceDate = new Date('2026-08-05T04:00:00.000Z');

const categories: readonly Category[] = [
  {
    id: 'category-food',
    type: 'EXPENSE',
    systemKey: 'expense.food',
    name: '餐饮',
    sortOrder: 10,
    isSystem: true,
    isHidden: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'category-food-breakfast',
    type: 'EXPENSE',
    parentId: 'category-food',
    systemKey: 'expense.food.breakfast',
    name: '早餐',
    sortOrder: 11,
    isSystem: true,
    isHidden: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'category-food-lunch',
    type: 'EXPENSE',
    parentId: 'category-food',
    systemKey: 'expense.food.lunch',
    name: '午餐',
    sortOrder: 12,
    isSystem: true,
    isHidden: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'category-food-dinner',
    type: 'EXPENSE',
    parentId: 'category-food',
    systemKey: 'expense.food.dinner',
    name: '晚餐',
    sortOrder: 13,
    isSystem: true,
    isHidden: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
] as const;

const accounts: readonly Account[] = [
  {
    id: 'account-wechat',
    name: '微信',
    type: 'WECHAT',
    currency: 'CNY',
    includeInNetWorth: true,
    sortOrder: 10,
    isHidden: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'account-alipay',
    name: '支付宝',
    type: 'ALIPAY',
    currency: 'CNY',
    includeInNetWorth: true,
    sortOrder: 20,
    isHidden: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
] as const;

const yiMing: Merchant = {
  id: 'merchant-yiming',
  canonicalName: '一鸣',
  normalizedName: '一鸣',
  aliases: ['一鸣真鲜奶吧'],
  createdAt: timestamp,
  updatedAt: timestamp,
};

function rule(
  overrides: Pick<UserRule, 'id' | 'ruleType' | 'pattern'> & Partial<UserRule>,
): UserRule {
  return {
    priority: 1000,
    enabled: true,
    usageCount: 0,
    origin: 'USER_CREATED',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

const learnedYiMingBreakfast = rule({
  id: 'rule-learned-yiming-breakfast',
  ruleType: 'MERCHANT',
  origin: 'LEARNED_MERCHANT',
  pattern: '一鸣',
  categoryId: 'category-food',
  subcategoryId: 'category-food-breakfast',
  priority: 700,
});

function parseOne(
  text: string,
  options: {
    userRules?: readonly UserRule[];
    merchants?: readonly Merchant[];
  } = {},
) {
  const result = parseTextTransactions(text, {
    referenceDate,
    timezoneOffsetMinutes: 480,
    categories,
    accounts,
    userRules: options.userRules,
    merchants: options.merchants,
  });
  expect(result.candidates).toHaveLength(1);
  const candidate = result.candidates[0];
  if (candidate === undefined) {
    throw new Error('Expected one personalized classification candidate.');
  }
  return candidate;
}

describe('stage 7 personalized classification precedence', () => {
  it('prioritizes a user-created keyword rule over a learned merchant rule', () => {
    const customKeyword = rule({
      id: 'rule-custom-member-day',
      ruleType: 'KEYWORD',
      pattern: '会员日',
      categoryId: 'category-food',
      subcategoryId: 'category-food-lunch',
      priority: 1000,
    });

    const candidate = parseOne('一鸣会员日12元', {
      userRules: [learnedYiMingBreakfast, customKeyword],
      merchants: [yiMing],
    });

    expect(candidate).toMatchObject({
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.lunch',
      suggestionSource: 'USER_RULE',
      matchedRuleId: customKeyword.id,
      matchedRuleType: 'KEYWORD',
    });
  });

  it('keeps the current explicit category above a learned merchant rule', () => {
    const candidate = parseOne('一鸣晚餐20元', {
      userRules: [learnedYiMingBreakfast],
      merchants: [yiMing],
    });

    expect(candidate).toMatchObject({
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.dinner',
      suggestionSource: 'EXPLICIT_TEXT',
    });
  });

  it('keeps an explicit special transaction type above a conflicting rule', () => {
    const conflictingRule = rule({
      ...learnedYiMingBreakfast,
      id: 'rule-conflicting-expense',
      transactionType: 'EXPENSE',
    });

    const candidate = parseOne('一鸣退款20元到账', {
      userRules: [conflictingRule],
      merchants: [yiMing],
    });

    expect(candidate).toMatchObject({
      type: 'REFUND',
      categoryKey: 'income.refund',
      suggestionSource: 'EXPLICIT_TEXT',
    });
  });

  it('keeps an explicitly stated account above the account stored in a rule', () => {
    const ruleWithAccount = rule({
      ...learnedYiMingBreakfast,
      id: 'rule-yiming-with-wechat',
      accountId: 'account-wechat',
    });

    const candidate = parseOne('一鸣12元，支付宝', {
      userRules: [ruleWithAccount],
      merchants: [yiMing],
    });

    expect(candidate).toMatchObject({
      accountKey: 'ALIPAY',
      accountIdHint: 'account-alipay',
      subcategoryKey: 'expense.food.breakfast',
      suggestionSource: 'LEARNED_MERCHANT',
      matchedRuleId: ruleWithAccount.id,
    });
  });

  it('does not let an exact 一鸣 merchant rule match 一鸣惊人书店', () => {
    const candidate = parseOne('一鸣惊人书店12元', {
      userRules: [learnedYiMingBreakfast],
      merchants: [yiMing],
    });

    expect(candidate.merchantRawName).toBe('一鸣惊人书店');
    expect(candidate.matchedRuleId).toBeUndefined();
    expect(candidate.subcategoryKey).not.toBe('expense.food.breakfast');
  });

  it('resolves a merchant alias to its canonical name before rule matching', () => {
    const candidate = parseOne('一鸣真鲜奶吧12元', {
      userRules: [learnedYiMingBreakfast],
      merchants: [yiMing],
    });

    expect(candidate).toMatchObject({
      merchantRawName: '一鸣真鲜奶吧',
      subcategoryKey: 'expense.food.breakfast',
      suggestionSource: 'LEARNED_MERCHANT',
      matchedRuleId: learnedYiMingBreakfast.id,
    });
  });

  it('resolves equal-priority conflicts deterministically regardless of input order', () => {
    const alphabeticallyFirst = rule({
      id: 'rule-a-member',
      ruleType: 'KEYWORD',
      pattern: '会员',
      categoryId: 'category-food',
      subcategoryId: 'category-food-breakfast',
    });
    const alphabeticallyLast = rule({
      id: 'rule-z-sale',
      ruleType: 'KEYWORD',
      pattern: '特价',
      categoryId: 'category-food',
      subcategoryId: 'category-food-dinner',
    });

    const forward = parseOne('会员特价12元', {
      userRules: [alphabeticallyFirst, alphabeticallyLast],
    });
    const reverse = parseOne('会员特价12元', {
      userRules: [alphabeticallyLast, alphabeticallyFirst],
    });

    expect(forward.matchedRuleId).toBe(alphabeticallyFirst.id);
    expect(reverse.matchedRuleId).toBe(alphabeticallyFirst.id);
    expect(reverse).toMatchObject({
      categoryKey: forward.categoryKey,
      subcategoryKey: forward.subcategoryKey,
      suggestionSource: forward.suggestionSource,
      matchedRuleId: forward.matchedRuleId,
    });
  });

  it('returns identical personalized candidates for TEXT and VOICE transcripts', () => {
    const context = {
      referenceDate,
      timezoneOffsetMinutes: 480,
      categories,
      accounts,
      userRules: [learnedYiMingBreakfast],
      merchants: [yiMing],
    } as const;
    const transcript = '一鸣真鲜奶吧12元';

    const textCandidate = parseTextTransactions(transcript, context)
      .candidates[0];
    const voiceCandidate = parseTextTransactions(transcript, context)
      .candidates[0];

    expect(textCandidate).toBeDefined();
    expect(voiceCandidate).toEqual(textCandidate);
    expect(voiceCandidate).toMatchObject({
      suggestionSource: 'LEARNED_MERCHANT',
      matchedRuleId: learnedYiMingBreakfast.id,
    });
  });
});
