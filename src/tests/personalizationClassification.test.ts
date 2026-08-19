import { parseTextTransactions } from '../classification/parseTextTransactions';
import type { Account, Category, Merchant, UserRule } from '../domain/entities';
import { confirmationIntentFor } from '../domain/services/reviewDisposition';

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
  {
    id: 'category-transport',
    type: 'EXPENSE',
    systemKey: 'expense.transport',
    name: '交通',
    sortOrder: 20,
    isSystem: true,
    isHidden: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'category-transport-bus',
    type: 'EXPENSE',
    parentId: 'category-transport',
    systemKey: 'expense.transport.bus',
    name: '公交',
    sortOrder: 21,
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
    recentAccountKey?: Account['type'];
    accounts?: readonly Account[];
  } = {},
) {
  const result = parseTextTransactions(text, {
    referenceDate,
    timezoneOffsetMinutes: 480,
    categories,
    accounts: options.accounts ?? accounts,
    userRules: options.userRules,
    merchants: options.merchants,
    recentAccountKey: options.recentAccountKey,
  });
  expect(result.candidates).toHaveLength(1);
  const candidate = result.candidates[0];
  if (candidate === undefined) {
    throw new Error('Expected one personalized classification candidate.');
  }
  return candidate;
}

describe('stage 7 personalized classification precedence', () => {
  it('uses one keyword rule for the exact transport category and WeChat account without a fallback warning', () => {
    const commuteRule = rule({
      id: 'rule-commute-by-bus',
      ruleType: 'KEYWORD',
      pattern: '坐车',
      transactionType: 'EXPENSE',
      categoryId: 'category-transport',
      subcategoryId: 'category-transport-bus',
      accountId: 'account-wechat',
    });

    const candidate = parseOne('我坐车来回花了4块钱', {
      userRules: [commuteRule],
    });

    expect(candidate).toMatchObject({
      type: 'EXPENSE',
      amountMinor: 400,
      categoryKey: 'expense.transport',
      subcategoryKey: 'expense.transport.bus',
      categoryIdHint: 'category-transport',
      subcategoryIdHint: 'category-transport-bus',
      accountKey: 'WECHAT',
      accountIdHint: 'account-wechat',
      accountResolutionSource: 'USER_RULE',
      suggestionSource: 'USER_RULE',
      matchedRuleId: commuteRule.id,
      missingFields: [],
      advisoryReasons: [],
    });
    expect(candidate.ambiguityReasons).not.toContain(
      '未明确支付账户，暂用最近账户',
    );
    expect(candidate.confidenceLevel).toBe('HIGH');
    expect(confirmationIntentFor(candidate)).toBe('DIRECT_CONFIRM');
  });

  it('keeps a recent-account fallback advisory and allows one reviewed confirmation', () => {
    const categoryOnlyRule = rule({
      id: 'rule-commute-category-only',
      ruleType: 'KEYWORD',
      pattern: '坐车',
      transactionType: 'EXPENSE',
      categoryId: 'category-transport',
      subcategoryId: 'category-transport-bus',
    });

    const candidate = parseOne('我坐车来回花了4块钱', {
      userRules: [categoryOnlyRule],
      recentAccountKey: 'WECHAT',
    });

    expect(candidate).toMatchObject({
      accountKey: 'WECHAT',
      accountIdHint: 'account-wechat',
      accountResolutionSource: 'RECENT_FALLBACK',
      advisoryReasons: ['账户按最近使用填为微信'],
      ambiguityReasons: [],
      confidenceLevel: 'MEDIUM',
    });
    expect(confirmationIntentFor(candidate)).toBe('USER_REVIEWED_CONFIRM');
  });

  it('lets an explicitly spoken account override the account in the matching rule', () => {
    const commuteRule = rule({
      id: 'rule-commute-with-wechat',
      ruleType: 'KEYWORD',
      pattern: '坐车',
      transactionType: 'EXPENSE',
      categoryId: 'category-transport',
      subcategoryId: 'category-transport-bus',
      accountId: 'account-wechat',
    });

    const candidate = parseOne('我坐车来回花了4块钱，支付宝付的', {
      userRules: [commuteRule],
    });

    expect(candidate).toMatchObject({
      accountKey: 'ALIPAY',
      accountIdHint: 'account-alipay',
      accountResolutionSource: 'EXPLICIT_TEXT',
      advisoryReasons: [],
    });
    expect(candidate.ambiguityReasons).toEqual([]);
  });

  it('fails closed when a rule refers to an account that is no longer available', () => {
    const staleAccountRule = rule({
      id: 'rule-commute-with-stale-account',
      ruleType: 'KEYWORD',
      pattern: '坐车',
      transactionType: 'EXPENSE',
      categoryId: 'category-transport',
      subcategoryId: 'category-transport-bus',
      accountId: 'account-deleted',
    });

    const candidate = parseOne('我坐车来回花了4块钱', {
      userRules: [staleAccountRule],
    });

    expect(candidate).toMatchObject({
      accountResolutionSource: 'MISSING',
      accountKey: undefined,
      accountIdHint: undefined,
      advisoryReasons: [],
    });
    expect(candidate.missingFields).toContain('账户');
    expect(confirmationIntentFor(candidate)).toBeUndefined();
  });

  it('does not materialize an unavailable recent account from its type alone', () => {
    const candidate = parseOne('坐车花了4块钱', {
      accounts: [accounts[1]!],
      recentAccountKey: 'WECHAT',
    });

    expect(candidate).toMatchObject({
      accountResolutionSource: 'MISSING',
      accountKey: undefined,
      accountIdHint: undefined,
      advisoryReasons: [],
    });
    expect(candidate.missingFields).toContain('账户');
    expect(confirmationIntentFor(candidate)).toBeUndefined();
  });

  it('keeps safely ignored incompatible history as advisory instead of blocking confirmation', () => {
    const conflictingHistory = rule({
      id: 'rule-salary-conflicting-expense',
      ruleType: 'KEYWORD',
      pattern: '工资',
      transactionType: 'EXPENSE',
      categoryId: 'category-food',
      subcategoryId: 'category-food-lunch',
    });

    const candidate = parseOne('工资到账4000元，微信', {
      userRules: [conflictingHistory],
    });

    expect(candidate).toMatchObject({
      type: 'INCOME',
      categoryKey: 'income.salary',
      accountResolutionSource: 'EXPLICIT_TEXT',
      advisoryReasons: ['历史分类与当前交易类型不一致，已安全忽略'],
      ambiguityReasons: [],
    });
    expect(confirmationIntentFor(candidate)).toBeDefined();
  });

  it('recognizes generic ride wording as transport while allowing a personal rule to refine it', () => {
    const generic = parseOne('坐车花了4块钱');
    expect(generic).toMatchObject({
      categoryKey: 'expense.transport',
      subcategoryKey: undefined,
      suggestionSource: 'COMMON_KEYWORD',
    });

    const commuteRule = rule({
      id: 'rule-refine-generic-ride',
      ruleType: 'KEYWORD',
      pattern: '坐车',
      transactionType: 'EXPENSE',
      categoryId: 'category-transport',
      subcategoryId: 'category-transport-bus',
    });
    const personalized = parseOne('坐车花了4块钱', {
      userRules: [commuteRule],
    });
    expect(personalized).toMatchObject({
      categoryKey: 'expense.transport',
      subcategoryKey: 'expense.transport.bus',
      suggestionSource: 'USER_RULE',
      matchedRuleId: commuteRule.id,
    });
  });

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

  it('does not let a merchant rule turn a route destination into a merchant', () => {
    const shanghaiMerchantRule = rule({
      id: 'rule-merchant-shanghai',
      ruleType: 'MERCHANT',
      pattern: '上海',
      accountId: 'account-wechat',
    });

    const candidate = parseOne('说今天从武汉到上海买的动车票花了270', {
      userRules: [shanghaiMerchantRule],
    });

    expect(candidate).toMatchObject({
      merchantRawName: undefined,
      matchedRuleId: undefined,
      accountKey: undefined,
      categoryKey: 'expense.transport',
      subcategoryKey: 'expense.transport.train',
    });
  });

  it('keeps keyword rules on raw route text without creating a merchant', () => {
    const shanghaiKeywordRule = rule({
      id: 'rule-keyword-shanghai',
      ruleType: 'KEYWORD',
      pattern: '上海',
      accountId: 'account-alipay',
    });

    const candidate = parseOne('说今天从武汉到上海买的动车票花了270', {
      userRules: [shanghaiKeywordRule],
    });

    expect(candidate).toMatchObject({
      merchantRawName: undefined,
      matchedRuleId: 'rule-keyword-shanghai',
      accountKey: 'ALIPAY',
      accountResolutionSource: 'USER_RULE',
    });
  });

  it('uses an exact custom merchant identity hint for terse receipt text', () => {
    const guMingRule = rule({
      id: 'rule-merchant-guming',
      ruleType: 'MERCHANT',
      pattern: '古茗',
      categoryId: 'category-food',
      subcategoryId: 'category-food-breakfast',
    });

    expect(
      parseOne('古茗18元', {
        userRules: [guMingRule],
      }),
    ).toMatchObject({
      merchantRawName: '古茗',
      matchedRuleId: 'rule-merchant-guming',
      type: 'EXPENSE',
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.breakfast',
    });
  });

  it.each([
    ['支付宝', '支付宝支付18元'],
    ['微信', '微信付款18元'],
    ['动车票', '动车票270元'],
  ])(
    'does not let a %s merchant rule turn a channel or product into a merchant',
    (pattern, text) => {
      const unsafeMerchantRule = rule({
        id: `rule-merchant-${pattern}`,
        ruleType: 'MERCHANT',
        pattern,
        accountId: 'account-wechat',
      });

      const candidate = parseOne(text, { userRules: [unsafeMerchantRule] });

      expect(candidate.merchantRawName).toBeUndefined();
      expect(candidate.matchedRuleId).toBeUndefined();
    },
  );

  it('normalizes full-width merchant rules before identity and exact-rule matching', () => {
    const fullWidthMerchantRule = rule({
      id: 'rule-merchant-full-width-starbucks',
      ruleType: 'MERCHANT',
      pattern: 'ＳＴＡＲＢＵＣＫＳ',
      categoryId: 'category-food',
      subcategoryId: 'category-food-breakfast',
    });

    expect(
      parseOne('Starbucks30元', { userRules: [fullWidthMerchantRule] }),
    ).toMatchObject({
      merchantRawName: 'starbucks',
      matchedRuleId: fullWidthMerchantRule.id,
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.breakfast',
    });
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
