import {
  applyExistingUserRules,
  applyMerchantDictionary,
  isCategorySuggestionCompatible,
  recognizeCategory,
} from '../classification/rules/localRules';
import { resolveSemanticCategory } from '../classification/semantic';
import type { Account, Category, Merchant, UserRule } from '../domain/entities';
import type {
  NormalizedImportCandidateV1,
  StatementImportPreview,
} from './types';

export type StatementClassificationReferences = {
  categories: readonly Category[];
  accounts: readonly Account[];
  userRules: readonly UserRule[];
  merchants: readonly Merchant[];
};

type CategorySuggestion = {
  categoryKey?: string;
  subcategoryKey?: string;
  categoryIdHint?: string;
  subcategoryIdHint?: string;
};

function resolveSuggestion(
  suggestion: CategorySuggestion,
  categories: readonly Category[],
): Pick<NormalizedImportCandidateV1, 'categoryIdHint' | 'subcategoryIdHint'> {
  const hintedCategory = categories.find(
    category => category.id === suggestion.categoryIdHint,
  );
  const hintedSubcategory = categories.find(
    category => category.id === suggestion.subcategoryIdHint,
  );
  const keyedCategory = categories.find(
    category => category.systemKey === suggestion.categoryKey,
  );
  const keyedSubcategory = categories.find(
    category => category.systemKey === suggestion.subcategoryKey,
  );
  const subcategory = hintedSubcategory ?? keyedSubcategory;
  const category =
    hintedCategory ??
    keyedCategory ??
    (subcategory?.parentId === undefined
      ? undefined
      : categories.find(item => item.id === subcategory.parentId));
  return {
    categoryIdHint: category?.id,
    subcategoryIdHint: subcategory?.id,
  };
}

function classifyCandidate(
  candidate: NormalizedImportCandidateV1,
  references: StatementClassificationReferences,
): NormalizedImportCandidateV1 {
  const comparableAccountName = candidate.accountHint
    ?.normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replaceAll(/[\s\p{P}\p{S}]/gu, '');
  const explicitAccount = references.accounts.find(
    account =>
      comparableAccountName !== undefined &&
      account.name
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('zh-CN')
        .replaceAll(/[\s\p{P}\p{S}]/gu, '') === comparableAccountName,
  );
  const sourceAccountType =
    candidate.source === 'WECHAT'
      ? 'WECHAT'
      : candidate.source === 'ALIPAY'
        ? 'ALIPAY'
        : undefined;
  const sourceAccount = references.accounts.find(
    account => account.type === sourceAccountType,
  );
  const candidateWithAccount: NormalizedImportCandidateV1 = {
    ...candidate,
    accountIdHint:
      candidate.accountIdHint ?? explicitAccount?.id ?? sourceAccount?.id,
  };
  const merchant = candidate.merchantRawName?.trim();
  if (merchant === undefined || merchant.length === 0) {
    return candidateWithAccount;
  }

  const accountRule = applyExistingUserRules(
    merchant,
    merchant,
    references.userRules.filter(rule => rule.accountId !== undefined),
    references.categories,
    references.accounts,
  );
  const candidateWithUserAccount: NormalizedImportCandidateV1 = {
    ...candidateWithAccount,
    accountIdHint:
      candidate.accountIdHint ??
      explicitAccount?.id ??
      accountRule.accountIdHint ??
      sourceAccount?.id,
  };
  const categoryRule = applyExistingUserRules(
    merchant,
    merchant,
    references.userRules.filter(
      rule => rule.categoryId !== undefined || rule.subcategoryId !== undefined,
    ),
    references.categories,
    references.accounts,
  );
  if (
    isCategorySuggestionCompatible(
      categoryRule,
      candidate.type,
      references.categories,
    )
  ) {
    return {
      ...candidateWithUserAccount,
      ...resolveSuggestion(categoryRule, references.categories),
      classificationSource: categoryRule.learnedFromCorrections
        ? 'LEARNED_MERCHANT'
        : 'USER_RULE',
    };
  }

  const dictionary = applyMerchantDictionary(
    merchant,
    references.merchants,
    references.categories,
  );
  if (
    isCategorySuggestionCompatible(
      dictionary,
      candidate.type,
      references.categories,
    )
  ) {
    return {
      ...candidateWithUserAccount,
      ...resolveSuggestion(dictionary, references.categories),
      merchantIdHint: dictionary.merchantIdHint,
      classificationSource: 'MERCHANT_DICTIONARY',
    };
  }

  const keyword = recognizeCategory(merchant, candidate.type);
  const semantic =
    candidate.type === 'EXPENSE'
      ? resolveSemanticCategory(merchant, { transactionType: 'EXPENSE' })
      : undefined;
  const merchantNameSuggestion =
    semantic?.status === 'RESOLVED'
      ? semantic
      : keyword.explicit
        ? keyword
        : undefined;
  if (
    merchantNameSuggestion !== undefined &&
    isCategorySuggestionCompatible(
      merchantNameSuggestion,
      candidate.type,
      references.categories,
    )
  ) {
    return {
      ...candidateWithUserAccount,
      ...resolveSuggestion(merchantNameSuggestion, references.categories),
      classificationSource: 'MERCHANT_NAME',
    };
  }

  return candidateWithUserAccount;
}

export function classifyStatementPreview(
  preview: StatementImportPreview,
  references: StatementClassificationReferences,
): StatementImportPreview {
  return {
    ...preview,
    candidates: preview.candidates.map(candidate =>
      classifyCandidate(candidate, references),
    ),
  };
}
