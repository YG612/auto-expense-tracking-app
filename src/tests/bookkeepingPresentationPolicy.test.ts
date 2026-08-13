import { TRANSACTION_TYPES, type Category } from '../domain/entities';
import {
  BOOKKEEPING_PRESENTATION_TAXONOMY_VERSION,
  EXPENSE_PRESENTATION_GROUPS,
  additionalTransactionTypeOptions,
  categorySelectionLabel,
  hasAdditionalManualInformation,
  primaryTransactionTypeOptions,
  quickTopLevelCategories,
  rollupExpenseCategory,
  rollupExpenseSystemKey,
  selectTopLevelCategory,
} from '../domain/policies/bookkeepingPresentationPolicy';

const createdAt = '2026-08-10T00:00:00.000Z';

function category(
  id: string,
  type: Category['type'],
  systemKey: string,
  name: string,
  parentId?: string,
): Category {
  return {
    id,
    type,
    parentId,
    systemKey,
    name,
    sortOrder: 0,
    isSystem: true,
    isHidden: false,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('bookkeeping presentation policy', () => {
  it('presents every ledger transaction type exactly once across primary and more', () => {
    const primary = primaryTransactionTypeOptions().map(option => option.value);
    const additional = additionalTransactionTypeOptions().map(
      option => option.value,
    );
    const presented = [...primary, ...additional];

    expect(primary).toEqual(['EXPENSE', 'INCOME', 'TRANSFER']);
    expect(new Set(presented).size).toBe(TRANSACTION_TYPES.length);
    expect([...presented].sort()).toEqual([...TRANSACTION_TYPES].sort());
  });

  it('keeps the quick category surface to eight ordered top-level choices', () => {
    const categories = [
      category(
        'expense-child',
        'EXPENSE',
        'expense.food.lunch',
        '午餐',
        'food',
      ),
      category('custom', 'EXPENSE', 'expense.custom', '自定义'),
      category('other', 'EXPENSE', 'expense.other_expense', '其他支出'),
      category('education', 'EXPENSE', 'expense.education', '学习'),
      category('healthcare', 'EXPENSE', 'expense.healthcare', '医疗健康'),
      category('entertainment', 'EXPENSE', 'expense.entertainment', '娱乐'),
      category('housing', 'EXPENSE', 'expense.housing', '居住'),
      category('transport', 'EXPENSE', 'expense.transport', '交通'),
      category('shopping', 'EXPENSE', 'expense.shopping', '购物'),
      category('food', 'EXPENSE', 'expense.food', '餐饮'),
    ];

    expect(
      quickTopLevelCategories(categories, 'EXPENSE').map(item => item.id),
    ).toEqual([
      'food',
      'transport',
      'shopping',
      'housing',
      'entertainment',
      'healthcare',
      'education',
      'other',
    ]);
  });

  it('publishes exactly eight stable, versioned expense presentation groups', () => {
    expect(BOOKKEEPING_PRESENTATION_TAXONOMY_VERSION).toBe(1);
    expect(
      EXPENSE_PRESENTATION_GROUPS.map(group => [group.key, group.label]),
    ).toEqual([
      ['FOOD', '餐饮'],
      ['TRANSPORT', '出行'],
      ['SHOPPING', '购物'],
      ['LIVING', '生活缴费/居家'],
      ['ENTERTAINMENT', '休闲娱乐'],
      ['HEALTHCARE', '医疗健康'],
      ['EDUCATION', '学习办公'],
      ['OTHER', '其他'],
    ]);
  });

  it.each([
    ['expense.food.lunch', 'FOOD'],
    ['expense.transport.bus', 'TRANSPORT'],
    ['expense.travel.hotel', 'TRANSPORT'],
    ['expense.shopping.electronics', 'SHOPPING'],
    ['expense.housing.electricity', 'LIVING'],
    ['expense.communication.phone_bill', 'LIVING'],
    ['expense.pets.services', 'LIVING'],
    ['expense.entertainment.games', 'ENTERTAINMENT'],
    ['expense.healthcare.medicine', 'HEALTHCARE'],
    ['expense.education.books', 'EDUCATION'],
    ['expense.social.red_packet', 'OTHER'],
    ['expense.financial_fees.service_fee', 'OTHER'],
    ['expense.other_expense.unclassified', 'OTHER'],
  ] as const)(
    'rolls legacy key %s into the %s display group without rewriting it',
    (systemKey, expectedGroupKey) => {
      const rollup = rollupExpenseSystemKey(systemKey);

      expect(rollup).toMatchObject({
        taxonomyVersion: 1,
        sourceSystemKey: systemKey,
        isFallback: false,
        group: { key: expectedGroupKey },
      });
    },
  );

  it.each([undefined, 'expense.custom', 'expense', 'income.salary'])(
    'safely falls back unknown or custom key %s to Other',
    systemKey => {
      const rollup = rollupExpenseSystemKey(systemKey);

      expect(rollup.group.key).toBe('OTHER');
      expect(rollup.isFallback).toBe(true);
      expect(rollup.sourceSystemKey).toBe(systemKey);
    },
  );

  it('keeps hidden historical expense keys rollable and ignores income categories', () => {
    const hiddenLegacyCategory = {
      ...category('legacy-travel', 'EXPENSE', 'expense.travel.hotel', '酒店'),
      isHidden: true,
    };
    const original = { ...hiddenLegacyCategory };

    expect(rollupExpenseCategory(hiddenLegacyCategory)).toMatchObject({
      sourceSystemKey: 'expense.travel.hotel',
      group: { key: 'TRANSPORT' },
      isFallback: false,
    });
    expect(hiddenLegacyCategory).toEqual(original);
    expect(
      rollupExpenseCategory(
        category('salary', 'INCOME', 'income.salary', '工资'),
      ),
    ).toBeUndefined();
  });

  it('uses the compact income order without leaking expense or child categories', () => {
    const keys = [
      'income.other',
      'income.gift_money',
      'income.investment',
      'income.scholarship',
      'income.bonus',
      'income.allowance',
      'income.part_time',
      'income.salary',
    ];
    const categories = keys.map(key =>
      category(key, 'INCOME', key, key.replace('income.', '')),
    );
    categories.push(
      category('expense', 'EXPENSE', 'expense.food', '餐饮'),
      category(
        'income-child',
        'INCOME',
        'income.salary.other',
        '子分类',
        'income.salary',
      ),
    );

    expect(
      quickTopLevelCategories(categories, 'INCOME').map(item => item.systemKey),
    ).toEqual([
      'income.salary',
      'income.part_time',
      'income.allowance',
      'income.bonus',
      'income.scholarship',
      'income.investment',
      'income.gift_money',
      'income.other',
    ]);
  });

  it('writes a quick top-level category directly without inventing a child', () => {
    expect(
      selectTopLevelCategory(
        category('food', 'EXPENSE', 'expense.food', '餐饮'),
      ),
    ).toEqual({ categoryId: 'food', subcategoryId: undefined });
  });

  it('never exposes a hidden category through the quick presentation helper', () => {
    const hiddenFood = {
      ...category('food', 'EXPENSE', 'expense.food', '餐饮'),
      isHidden: true,
    };

    expect(quickTopLevelCategories([hiddenFood], 'EXPENSE')).toEqual([]);
  });

  it('can label an explicitly hydrated hidden category without making it quick-selectable', () => {
    const hiddenLegacyCategory = {
      ...category('legacy', 'EXPENSE', 'expense.legacy', '旧分类'),
      isHidden: true,
    };

    expect(
      categorySelectionLabel(
        [hiddenLegacyCategory],
        hiddenLegacyCategory.id,
        undefined,
        '选择分类',
      ),
    ).toBe('旧分类');
    expect(quickTopLevelCategories([hiddenLegacyCategory], 'EXPENSE')).toEqual(
      [],
    );
  });

  it('hides generic child names but preserves a meaningful existing child', () => {
    const categories = [
      category('food', 'EXPENSE', 'expense.food', '餐饮'),
      category(
        'food-other',
        'EXPENSE',
        'expense.food.other',
        '其他餐饮',
        'food',
      ),
      category('food-lunch', 'EXPENSE', 'expense.food.lunch', '午餐', 'food'),
    ];

    expect(
      categorySelectionLabel(categories, 'food', 'food-other', '选择分类'),
    ).toBe('餐饮');
    expect(
      categorySelectionLabel(categories, 'food', 'food-lunch', '选择分类'),
    ).toBe('餐饮 / 午餐');
  });

  it('expands optional information only when it already contains user data', () => {
    expect(
      hasAdditionalManualInformation({
        merchantName: '',
        tagIds: [],
        note: '',
      }),
    ).toBe(false);
    expect(
      hasAdditionalManualInformation({
        merchantName: '沙县小吃',
        tagIds: [],
        note: '',
      }),
    ).toBe(true);
  });
});
