import type { Category, CategoryType, TransactionType } from '../entities';
import {
  getTransactionTypeOption,
  type TransactionTypeOption,
} from '../services/manualTransaction';

export const PRIMARY_TRANSACTION_TYPES = [
  'EXPENSE',
  'INCOME',
  'TRANSFER',
] as const satisfies readonly TransactionType[];

type AdditionalTransactionTypeGroup = {
  label: string;
  types: readonly TransactionType[];
};

export const ADDITIONAL_TRANSACTION_TYPE_GROUPS = [
  { label: '退款与报销', types: ['REFUND', 'REIMBURSEMENT'] },
  {
    label: '借还款',
    types: ['BORROW_IN', 'LEND_OUT', 'REPAYMENT_IN', 'REPAYMENT_OUT'],
  },
  { label: '账务调整', types: ['ADJUSTMENT'] },
] as const satisfies readonly AdditionalTransactionTypeGroup[];

/**
 * Version of the category taxonomy used only for presentation and reporting.
 *
 * This is deliberately independent from the persisted category schema: changing
 * a display group must never rewrite a transaction's categoryId or systemKey.
 */
export const BOOKKEEPING_PRESENTATION_TAXONOMY_VERSION = 1 as const;

export const EXPENSE_PRESENTATION_GROUPS = [
  {
    key: 'FOOD',
    label: '餐饮',
    canonicalSystemKey: 'expense.food',
  },
  {
    key: 'TRANSPORT',
    label: '出行',
    canonicalSystemKey: 'expense.transport',
  },
  {
    key: 'SHOPPING',
    label: '购物',
    canonicalSystemKey: 'expense.shopping',
  },
  {
    key: 'LIVING',
    label: '生活缴费/居家',
    canonicalSystemKey: 'expense.housing',
  },
  {
    key: 'ENTERTAINMENT',
    label: '休闲娱乐',
    canonicalSystemKey: 'expense.entertainment',
  },
  {
    key: 'HEALTHCARE',
    label: '医疗健康',
    canonicalSystemKey: 'expense.healthcare',
  },
  {
    key: 'EDUCATION',
    label: '学习办公',
    canonicalSystemKey: 'expense.education',
  },
  {
    key: 'OTHER',
    label: '其他',
    canonicalSystemKey: 'expense.other_expense',
  },
] as const;

export type ExpensePresentationGroup =
  (typeof EXPENSE_PRESENTATION_GROUPS)[number];

export type ExpensePresentationGroupKey = ExpensePresentationGroup['key'];

export type ExpenseCategoryPresentationRollup = {
  taxonomyVersion: typeof BOOKKEEPING_PRESENTATION_TAXONOMY_VERSION;
  group: ExpensePresentationGroup;
  /** The original persisted key, retained verbatim for traceability. */
  sourceSystemKey?: string;
  /** The top-level legacy key used to select the display group. */
  matchedTopLevelSystemKey?: string;
  /** True when an unknown or custom expense category safely falls back to Other. */
  isFallback: boolean;
};

const EXPENSE_PRESENTATION_GROUP_BY_KEY = new Map<
  ExpensePresentationGroupKey,
  ExpensePresentationGroup
>(EXPENSE_PRESENTATION_GROUPS.map(group => [group.key, group]));

/**
 * Mapping from every persisted v2 top-level expense key to the compact display
 * taxonomy. Legacy groups remain valid storage/reporting inputs.
 */
const EXPENSE_PRESENTATION_ROLLUP_BY_TOP_LEVEL_SYSTEM_KEY: Readonly<
  Record<string, ExpensePresentationGroupKey>
> = {
  'expense.food': 'FOOD',
  'expense.transport': 'TRANSPORT',
  'expense.travel': 'TRANSPORT',
  'expense.shopping': 'SHOPPING',
  'expense.housing': 'LIVING',
  'expense.communication': 'LIVING',
  'expense.pets': 'LIVING',
  'expense.entertainment': 'ENTERTAINMENT',
  'expense.healthcare': 'HEALTHCARE',
  'expense.education': 'EDUCATION',
  'expense.social': 'OTHER',
  'expense.financial_fees': 'OTHER',
  'expense.other_expense': 'OTHER',
};

function presentationGroup(
  key: ExpensePresentationGroupKey,
): ExpensePresentationGroup {
  const group = EXPENSE_PRESENTATION_GROUP_BY_KEY.get(key);
  if (group === undefined) {
    throw new Error(`Unknown expense presentation group: ${key}`);
  }
  return group;
}

function topLevelExpenseSystemKey(
  systemKey: string | undefined,
): string | undefined {
  if (systemKey === undefined) {
    return undefined;
  }

  const parts = systemKey.split('.');
  if (parts[0] !== 'expense' || parts[1] === undefined || parts[1] === '') {
    return undefined;
  }

  return `expense.${parts[1]}`;
}

/**
 * Rolls a persisted expense systemKey into one of eight presentation groups.
 * The returned sourceSystemKey is never normalized or replaced.
 */
export function rollupExpenseSystemKey(
  systemKey: string | undefined,
): ExpenseCategoryPresentationRollup {
  const matchedTopLevelSystemKey = topLevelExpenseSystemKey(systemKey);
  const mappedGroupKey =
    matchedTopLevelSystemKey === undefined
      ? undefined
      : EXPENSE_PRESENTATION_ROLLUP_BY_TOP_LEVEL_SYSTEM_KEY[
          matchedTopLevelSystemKey
        ];
  const group = presentationGroup(mappedGroupKey ?? 'OTHER');

  return {
    taxonomyVersion: BOOKKEEPING_PRESENTATION_TAXONOMY_VERSION,
    group,
    ...(systemKey === undefined ? {} : { sourceSystemKey: systemKey }),
    ...(matchedTopLevelSystemKey === undefined
      ? {}
      : { matchedTopLevelSystemKey }),
    isFallback: mappedGroupKey === undefined,
  };
}

/**
 * Category-aware wrapper that prevents income categories from being
 * accidentally included in expense rollups. Hidden historical categories are
 * still rollable because presentation visibility and ledger history differ.
 */
export function rollupExpenseCategory(
  category: Pick<Category, 'type' | 'systemKey'>,
): ExpenseCategoryPresentationRollup | undefined {
  if (category.type !== 'EXPENSE') {
    return undefined;
  }
  return rollupExpenseSystemKey(category.systemKey);
}

const QUICK_CATEGORY_SYSTEM_KEYS: Readonly<
  Record<CategoryType, readonly string[]>
> = {
  EXPENSE: [
    'expense.food',
    'expense.transport',
    'expense.shopping',
    'expense.housing',
    'expense.entertainment',
    'expense.healthcare',
    'expense.education',
    'expense.other_expense',
  ],
  INCOME: [
    'income.salary',
    'income.part_time',
    'income.allowance',
    'income.bonus',
    'income.scholarship',
    'income.investment',
    'income.gift_money',
    'income.other',
  ],
};

const PRIMARY_TRANSACTION_TYPE_SET = new Set<TransactionType>(
  PRIMARY_TRANSACTION_TYPES,
);

export type AdditionalTransactionTypeOption = TransactionTypeOption & {
  groupLabel: string;
};

export function primaryTransactionTypeOptions(): readonly TransactionTypeOption[] {
  return PRIMARY_TRANSACTION_TYPES.map(getTransactionTypeOption);
}

export function additionalTransactionTypeOptions(): readonly AdditionalTransactionTypeOption[] {
  return ADDITIONAL_TRANSACTION_TYPE_GROUPS.flatMap(group =>
    group.types.map(type => ({
      ...getTransactionTypeOption(type),
      groupLabel: group.label,
    })),
  );
}

export function isPrimaryTransactionType(type: TransactionType): boolean {
  return PRIMARY_TRANSACTION_TYPE_SET.has(type);
}

export function quickTopLevelCategories(
  categories: readonly Category[],
  type: CategoryType,
): readonly Category[] {
  const bySystemKey = new Map<string, Category>();
  for (const category of categories) {
    if (
      category.type === type &&
      category.parentId === undefined &&
      !category.isHidden &&
      category.systemKey !== undefined
    ) {
      bySystemKey.set(category.systemKey, category);
    }
  }

  return QUICK_CATEGORY_SYSTEM_KEYS[type]
    .map(systemKey => bySystemKey.get(systemKey))
    .filter((category): category is Category => category !== undefined)
    .slice(0, 8);
}

export function selectTopLevelCategory(category: Category): {
  categoryId: string;
  subcategoryId: undefined;
} {
  return { categoryId: category.id, subcategoryId: undefined };
}

function isGenericSubcategory(category: Category): boolean {
  return (
    category.systemKey?.endsWith('.other') === true ||
    category.systemKey?.endsWith('.unclassified') === true
  );
}

export function categorySelectionLabel(
  categories: readonly Category[],
  categoryId: string | undefined,
  subcategoryId: string | undefined,
  fallback: string,
): string {
  if (categoryId === undefined) {
    return fallback;
  }

  const category = categories.find(item => item.id === categoryId);
  if (category === undefined) {
    return fallback;
  }

  if (subcategoryId === undefined) {
    return category.name;
  }

  const subcategory = categories.find(item => item.id === subcategoryId);
  if (
    subcategory === undefined ||
    subcategory.parentId !== category.id ||
    isGenericSubcategory(subcategory)
  ) {
    return category.name;
  }

  return `${category.name} / ${subcategory.name}`;
}

export function hasAdditionalManualInformation(value: {
  merchantName: string;
  projectId?: string;
  tagIds: readonly string[];
  note: string;
}): boolean {
  return (
    value.merchantName.trim().length > 0 ||
    value.projectId !== undefined ||
    value.tagIds.length > 0 ||
    value.note.trim().length > 0
  );
}
