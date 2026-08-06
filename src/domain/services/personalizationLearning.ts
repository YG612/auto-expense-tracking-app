import type {
  ClassificationFeedback,
  Transaction,
  UserRule,
} from '../entities';

export type CorrectionLearningPlan = {
  feedback: ClassificationFeedback;
  learnedMerchantRule?: UserRule;
};

const BROAD_MERCHANTS = new Set([
  '淘宝',
  '天猫',
  '京东',
  '拼多多',
  '美团',
  '饿了么',
  '便利店',
]);

function normalizedMerchant(value: string | undefined): string | undefined {
  const normalized = value?.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}

function hasClassificationChange(
  original: Transaction,
  corrected: Transaction,
): boolean {
  return (
    original.type !== corrected.type ||
    original.categoryId !== corrected.categoryId ||
    original.subcategoryId !== corrected.subcategoryId ||
    original.accountId !== corrected.accountId
  );
}

function hasCategoryChange(
  original: Transaction,
  corrected: Transaction,
): boolean {
  return (
    original.categoryId !== corrected.categoryId ||
    original.subcategoryId !== corrected.subcategoryId
  );
}

function isPersonalRecipientText(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return (
    /个人收款码|个人码/u.test(value) ||
    /(?:支付给|付款给|转给|给)\s*[\p{Script=Han}]{2,4}(?=\s*\d|\s*[元块]|[，。,.]|$)/u.test(
      value,
    )
  );
}

export function isReliableMerchantForLearning(
  merchantRawName: string | undefined,
  sourceText: string | undefined,
): boolean {
  const merchant = normalizedMerchant(merchantRawName);
  return (
    merchant !== undefined &&
    merchant.length >= 2 &&
    !BROAD_MERCHANTS.has(merchant.toLocaleLowerCase('zh-CN')) &&
    !isPersonalRecipientText(sourceText)
  );
}

export function buildCorrectionLearningPlan(
  original: Transaction,
  corrected: Transaction,
  createdAt: string,
  feedbackId: string,
  learnedRuleId: string,
): CorrectionLearningPlan | undefined {
  if (
    (original.source !== 'TEXT' && original.source !== 'VOICE') ||
    corrected.confirmationStatus !== 'CONFIRMED' ||
    corrected.deletedAt !== undefined ||
    corrected.duplicateStatus === 'MERGED' ||
    !hasClassificationChange(original, corrected)
  ) {
    return undefined;
  }

  const merchantRawName = normalizedMerchant(
    corrected.merchantRawName ?? original.merchantRawName,
  );
  const feedback: ClassificationFeedback = {
    id: feedbackId,
    transactionId: corrected.id,
    originalType: original.type,
    correctedType: corrected.type,
    originalCategoryId: original.categoryId,
    correctedCategoryId: corrected.categoryId,
    originalSubcategoryId: original.subcategoryId,
    correctedSubcategoryId: corrected.subcategoryId,
    originalAccountId: original.accountId,
    correctedAccountId: corrected.accountId,
    sourceText: original.originalText,
    merchantRawName,
    learningStatus: 'PENDING',
    createdAt,
  };

  if (
    !hasCategoryChange(original, corrected) ||
    corrected.categoryId === undefined ||
    (corrected.type !== 'EXPENSE' && corrected.type !== 'INCOME') ||
    !isReliableMerchantForLearning(merchantRawName, original.originalText)
  ) {
    return { feedback };
  }

  return {
    feedback,
    learnedMerchantRule: {
      id: learnedRuleId,
      ruleType: 'MERCHANT',
      origin: 'LEARNED_MERCHANT',
      pattern: merchantRawName!,
      transactionType: corrected.type,
      categoryId: corrected.categoryId,
      subcategoryId: corrected.subcategoryId,
      priority: 600,
      enabled: true,
      usageCount: 0,
      createdAt,
      updatedAt: createdAt,
    },
  };
}
