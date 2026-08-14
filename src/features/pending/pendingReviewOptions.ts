import { recognizeCategory } from '../../classification/rules/localRules';
import type { TransactionSummary } from '../../database';
import type { Account, Category } from '../../domain/entities';
import { categoryTypeForTransactionType } from '../../domain/services/transactionSemantics';
import type { SelectionOption } from '../manual-bookkeeping/components/SelectionModal';

export type PendingReviewChoice = SelectionOption & {
  selected: boolean;
  recommendation?: 'MOST_LIKELY' | 'ALTERNATIVE';
};

type RankedPendingOptions = {
  all: SelectionOption[];
  quick: PendingReviewChoice[];
};

function uniqueIds(ids: readonly (string | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== undefined))];
}

function moveRecommendedFirst(
  options: readonly SelectionOption[],
  recommendedIds: readonly (string | undefined)[],
): SelectionOption[] {
  const byId = new Map(options.map(option => [option.id, option]));
  const recommended = uniqueIds(recommendedIds)
    .map(id => byId.get(id))
    .filter((option): option is SelectionOption => option !== undefined);
  const recommendedSet = new Set(recommended.map(option => option.id));
  return [
    ...recommended,
    ...options.filter(option => !recommendedSet.has(option.id)),
  ];
}

function quickChoices(
  all: readonly SelectionOption[],
  selectedId: string | undefined,
  recommendationIds: readonly (string | undefined)[],
): PendingReviewChoice[] {
  const firstRecommendationId = uniqueIds(recommendationIds)[0];
  const recommendationSet = new Set(uniqueIds(recommendationIds));

  return all.slice(0, 3).map(option => ({
    ...option,
    selected: option.id === selectedId,
    recommendation:
      option.id === firstRecommendationId
        ? 'MOST_LIKELY'
        : recommendationSet.has(option.id)
          ? 'ALTERNATIVE'
          : undefined,
  }));
}

function categoryOption(
  category: Category,
  categoryById: ReadonlyMap<string, Category>,
): SelectionOption {
  const parent =
    category.parentId === undefined
      ? undefined
      : categoryById.get(category.parentId);
  return {
    id: category.id,
    label: category.name,
    detail: parent?.name,
    icon: category.icon ?? parent?.icon,
  };
}

function categoryIdForSystemKeys(
  categories: readonly Category[],
  categoryKey: string | undefined,
  subcategoryKey: string | undefined,
): string | undefined {
  const key = subcategoryKey ?? categoryKey;
  return key === undefined
    ? undefined
    : categories.find(category => category.systemKey === key)?.id;
}

export function pendingCategoryOptions(
  transaction: TransactionSummary,
  categories: readonly Category[],
): RankedPendingOptions {
  const categoryType = categoryTypeForTransactionType(transaction.type);
  if (categoryType === undefined) {
    return { all: [], quick: [] };
  }

  const visible = categories.filter(category => category.type === categoryType);
  const categoryById = new Map(
    visible.map(category => [category.id, category]),
  );
  const parentIds = new Set(
    visible.flatMap(category =>
      category.parentId === undefined ? [] : [category.parentId],
    ),
  );
  const selectedId = transaction.subcategoryId ?? transaction.categoryId;
  const selectable = visible.filter(
    category =>
      category.parentId !== undefined ||
      !parentIds.has(category.id) ||
      category.id === selectedId,
  );
  const recognition = recognizeCategory(
    [transaction.merchantName, transaction.originalText, transaction.note]
      .filter(Boolean)
      .join(' '),
    transaction.type,
  );
  const recognizedId = categoryIdForSystemKeys(
    visible,
    recognition.categoryKey,
    recognition.subcategoryKey,
  );
  const alternativeIds = recognition.alternatives.map(alternative =>
    categoryIdForSystemKeys(
      visible,
      alternative.categoryKey,
      alternative.subcategoryKey,
    ),
  );
  const recommendationIds = uniqueIds([
    selectedId,
    recognizedId,
    ...alternativeIds,
  ]);
  const all = moveRecommendedFirst(
    selectable.map(category => categoryOption(category, categoryById)),
    recommendationIds,
  );

  return {
    all,
    quick: quickChoices(all, selectedId, recommendationIds),
  };
}

function sourceAccountType(
  transaction: TransactionSummary,
): Account['type'] | undefined {
  if (transaction.source === 'WECHAT_IMPORT') return 'WECHAT';
  if (transaction.source === 'ALIPAY_IMPORT') return 'ALIPAY';
  const sourceText = `${transaction.originalText ?? ''} ${transaction.note ?? ''}`;
  if (/支付宝/u.test(sourceText)) return 'ALIPAY';
  if (/微信|零钱通/u.test(sourceText)) return 'WECHAT';
  return undefined;
}

export function pendingAccountOptions(
  transaction: TransactionSummary,
  accounts: readonly Account[],
): RankedPendingOptions {
  const sourceType = sourceAccountType(transaction);
  const sourceId = accounts.find(account => account.type === sourceType)?.id;
  const recommendationIds = uniqueIds([transaction.accountId, sourceId]);
  const all = moveRecommendedFirst(
    accounts.map(account => ({
      id: account.id,
      label: account.name,
      icon: account.icon,
    })),
    recommendationIds,
  );

  return {
    all,
    quick: quickChoices(all, transaction.accountId, recommendationIds),
  };
}
