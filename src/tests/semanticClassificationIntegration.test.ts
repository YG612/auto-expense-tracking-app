import { parseTextTransactions } from '../classification/parseTextTransactions';
import type { Category, UserRule } from '../domain/entities';

const timestamp = '2026-08-11T00:00:00.000Z';
const referenceDate = new Date('2026-08-11T04:00:00.000Z');

const categories: readonly Category[] = [
  {
    id: 'category-entertainment',
    type: 'EXPENSE',
    systemKey: 'expense.entertainment',
    name: '娱乐',
    sortOrder: 10,
    isSystem: true,
    isHidden: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'category-entertainment-games',
    type: 'EXPENSE',
    parentId: 'category-entertainment',
    systemKey: 'expense.entertainment.games',
    name: '游戏',
    sortOrder: 11,
    isSystem: true,
    isHidden: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'category-education',
    type: 'EXPENSE',
    systemKey: 'expense.education',
    name: '学习',
    sortOrder: 20,
    isSystem: true,
    isHidden: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
] as const;

function parseOne(
  text: string,
  options: { userRules?: readonly UserRule[] } = {},
) {
  const result = parseTextTransactions(text, {
    referenceDate,
    timezoneOffsetMinutes: 480,
    categories,
    userRules: options.userRules,
  });
  expect(result.candidates).toHaveLength(1);
  const candidate = result.candidates[0];
  if (candidate === undefined) {
    throw new Error('Expected one semantic classification candidate.');
  }
  return candidate;
}

function userRule(overrides: Partial<UserRule>): UserRule {
  return {
    id: 'rule-net-cafe-personal-default',
    ruleType: 'KEYWORD',
    pattern: '网吧',
    priority: 1000,
    enabled: true,
    usageCount: 0,
    origin: 'USER_CREATED',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('semantic category integration', () => {
  it.each([
    '今天在网吧消费了10元，微信付的',
    '去网咖上网花了20元，微信付的',
    '电竞馆包夜花了30元，微信付的',
  ])('uses an entertainment venue concept for %s', text => {
    expect(parseOne(text)).toMatchObject({
      type: 'EXPENSE',
      categoryKey: 'expense.entertainment',
      subcategoryKey: 'expense.entertainment.games',
      suggestionSource: 'SEMANTIC_ONTOLOGY',
      missingFields: [],
    });
  });

  it.each([
    ['在网吧买水花了3元，微信付的', 'expense.food'],
    ['在网吧买瓶水花了3元，微信付的', 'expense.food'],
    ['在网吧买泡面花了5元，微信付的', 'expense.food'],
    ['在网吧买鼠标花了80元，微信付的', 'expense.shopping'],
    ['去网吧打车花了10元，微信付的', 'expense.transport'],
  ])(
    'lets an explicit item or activity override a venue default: %s',
    (text, expectedCategoryKey) => {
      expect(parseOne(text)).toMatchObject({
        type: 'EXPENSE',
        categoryKey: expectedCategoryKey,
      });
    },
  );

  it('does not fall back to the venue category for a repair relationship', () => {
    const candidate = parseOne('在网吧修电脑花100元，微信付的');
    expect(candidate.categoryKey).toBeUndefined();
    expect(candidate.categoryKey).not.toBe('expense.entertainment');
    expect(candidate.ambiguityReasons).toEqual(
      expect.arrayContaining([expect.stringContaining('非购买关系')]),
    );
  });

  it('blocks the old dining keyword fallback for a purchased membership card', () => {
    const candidate = parseOne('在餐厅买会员卡花100元，微信付的');
    expect(candidate.categoryKey).toBeUndefined();
    expect(candidate.categoryKey).not.toBe('expense.food');
    expect(candidate.ambiguityReasons).toEqual(
      expect.arrayContaining([expect.stringContaining('充值或储值')]),
    );
  });

  it('keeps a refund handling fee as an expense instead of a refund', () => {
    expect(parseOne('退款手续费花了2元，微信付的')).toMatchObject({
      type: 'EXPENSE',
      categoryKey: 'expense.financial_fees',
      subcategoryKey: 'expense.financial_fees.service_fee',
    });
  });

  it('lets a user rule override a venue-only default', () => {
    const candidate = parseOne('今天在网吧消费了10元，微信付的', {
      userRules: [
        userRule({
          categoryId: 'category-education',
          transactionType: 'EXPENSE',
        }),
      ],
    });

    expect(candidate).toMatchObject({
      categoryKey: 'expense.education',
      categoryIdHint: 'category-education',
      suggestionSource: 'USER_RULE',
    });
  });

  it('does not let a broad venue rule override an explicit purchased item', () => {
    const candidate = parseOne('在网吧买鼠标花了80元，微信付的', {
      userRules: [
        userRule({
          categoryId: 'category-entertainment',
          subcategoryId: 'category-entertainment-games',
          transactionType: 'EXPENSE',
        }),
      ],
    });

    expect(candidate).toMatchObject({
      categoryKey: 'expense.shopping',
      suggestionSource: 'SEMANTIC_ONTOLOGY',
    });
  });

  it.each(['网吧充值100元，微信付的', '交网吧押金100元，微信付的'])(
    'fails closed for stored-value or deposit semantics: %s',
    text => {
      const candidate = parseOne(text);
      expect(candidate.categoryKey).not.toBe('expense.entertainment');
      expect(
        candidate.ambiguityReasons.length > 0 ||
          candidate.missingFields.length > 0,
      ).toBe(true);
    },
  );

  it('keeps refund semantics above the venue ontology', () => {
    expect(parseOne('网吧退给我10元，微信收的')).toMatchObject({
      type: 'REFUND',
      categoryKey: 'income.refund',
    });
  });

  it.each([
    '没去网吧消费10元',
    '没有在网吧花10元',
    '本来想去网吧消费10元但没去',
  ])('does not turn a denied or cancelled event into spending: %s', text => {
    expect(
      parseTextTransactions(text, {
        referenceDate,
        timezoneOffsetMinutes: 480,
        categories,
      }).candidates,
    ).toEqual([]);
  });

  it('keeps buyer and seller roles separate', () => {
    expect(parseOne('我把二手显卡卖给网吧500元，微信收的')).toMatchObject({
      type: 'INCOME',
      categoryKey: 'income.secondhand_sale',
    });
    expect(parseOne('网吧卖给我一台二手显卡500元，微信付的')).toMatchObject({
      type: 'EXPENSE',
      categoryKey: 'expense.shopping',
      subcategoryKey: 'expense.shopping.electronics',
    });
  });

  it('classifies two settled events independently', () => {
    const result = parseTextTransactions(
      '网吧上网花了10元，然后买泡面花了5元，微信付的',
      {
        referenceDate,
        timezoneOffsetMinutes: 480,
        categories,
      },
    );

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map(candidate => candidate.categoryKey)).toEqual([
      'expense.entertainment',
      'expense.food',
    ]);
    expect(result.candidates.map(candidate => candidate.amountMinor)).toEqual([
      1000, 500,
    ]);
  });

  it.each([
    '嗯鲜花饼一块两元',
    '买月饼花了50元，微信付的',
    '买蛋糕花了100元，微信付的',
    '买绿豆糕花了15元，微信付的',
    '买青团花了8元，微信付的',
    '买麻薯花了12元，微信付的',
    '买曲奇花了20元，微信付的',
  ])('recognizes common pastry products as food: %s', text => {
    expect(parseOne(text)).toMatchObject({
      type: 'EXPENSE',
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.snacks',
      suggestionSource: 'SEMANTIC_ONTOLOGY',
    });
  });

  it.each([
    '买包子花了3元，微信付的',
    '买烧饼花了2元，微信付的',
    '买寿司花了20元，微信付的',
    '买汉堡花了20元，微信付的',
    '买螺蛳粉花了15元，微信付的',
  ])('recognizes common prepared foods as food: %s', text => {
    expect(parseOne(text)).toMatchObject({
      type: 'EXPENSE',
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.other',
      suggestionSource: 'SEMANTIC_ONTOLOGY',
    });
  });

  it('does not confuse flowers with flower cake', () => {
    expect(parseOne('买鲜花花了50元，微信付的').categoryKey).toBeUndefined();
  });

  it.each(['买鲜花饼代金券花50元，微信付的', '买蛋糕兑换券花30元，微信付的'])(
    'blocks voucher semantics instead of classifying the named food: %s',
    text => {
      const candidate = parseOne(text);
      expect(candidate.categoryKey).toBeUndefined();
      expect(candidate.missingFields).toContain('分类');
    },
  );
});
