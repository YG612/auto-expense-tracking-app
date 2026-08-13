import type { TransactionType } from '../../domain/entities';
import type { AmountEvidence } from '../parsers/amountParser';
import type { AccountResolutionSource } from '../types';

export type ConfidenceEvidence = {
  hasAmount: boolean;
  amountEvidence: AmountEvidence;
  hasType: boolean;
  hasCategory: boolean;
  hasSubcategory: boolean;
  accountResolutionSource: AccountResolutionSource;
  hasTargetAccount: boolean;
  explicitDateOrTime: boolean;
  hasMerchant: boolean;
  hasProjectOrTags: boolean;
  explicitTransactionCue: boolean;
  type?: TransactionType;
  risks: readonly (
    | 'PERSONAL_RECIPIENT'
    | 'RECHARGE'
    | 'SPECIAL_TYPE'
    | 'BROAD_MERCHANT'
    | 'COLLOQUIAL_AMOUNT'
    | 'MULTIPLE_AMOUNTS'
    | 'AMBIGUOUS_AMOUNT'
    | 'EVENT_AMBIGUITY'
    | 'MISSING_AMOUNT'
    | 'MISSING_CATEGORY'
  )[];
};

function capForRisk(risk: ConfidenceEvidence['risks'][number]): number {
  switch (risk) {
    case 'PERSONAL_RECIPIENT':
    case 'MULTIPLE_AMOUNTS':
    case 'AMBIGUOUS_AMOUNT':
    case 'EVENT_AMBIGUITY':
    case 'MISSING_AMOUNT':
    case 'MISSING_CATEGORY':
      return 0.64;
    case 'RECHARGE':
      return 0.62;
    case 'SPECIAL_TYPE':
    case 'COLLOQUIAL_AMOUNT':
      return 0.89;
    case 'BROAD_MERCHANT':
      return 0.79;
  }
}

export function calculateConfidence(evidence: ConfidenceEvidence): number {
  const flatCategoryIsComplete =
    evidence.hasCategory &&
    (evidence.type === 'INCOME' ||
      evidence.type === 'REFUND' ||
      evidence.type === 'REIMBURSEMENT');
  let score = 0;
  score +=
    evidence.amountEvidence === 'EXPLICIT_CURRENCY'
      ? 0.3
      : evidence.amountEvidence === 'STRONG_CUE_BARE'
        ? 0.27
        : evidence.amountEvidence === 'CONTEXTUAL_BARE'
          ? 0.23
          : evidence.amountEvidence === 'AMBIGUOUS'
            ? 0.12
            : 0;
  score += evidence.hasType ? 0.2 : 0;
  score += evidence.hasCategory ? 0.15 : 0;
  // Income, refund and reimbursement categories are intentionally flat in
  // the taxonomy. They must not lose the entire subcategory score merely for
  // following that schema.
  score += evidence.hasSubcategory || flatCategoryIsComplete ? 0.12 : 0;
  score +=
    evidence.accountResolutionSource === 'EXPLICIT_TEXT' ||
    evidence.accountResolutionSource === 'USER_RULE'
      ? 0.1
      : evidence.accountResolutionSource === 'RECENT_FALLBACK'
        ? 0.05
        : 0;
  score += evidence.hasTargetAccount ? 0.08 : 0;
  score += evidence.explicitDateOrTime ? 0.05 : 0.03;
  score += evidence.hasMerchant ? 0.02 : 0;
  score += evidence.hasProjectOrTags ? 0.01 : 0;
  score += evidence.explicitTransactionCue ? 0.04 : 0;

  let cap = 1;
  for (const risk of evidence.risks) {
    cap = Math.min(cap, capForRisk(risk));
  }
  // A recent-account fallback is useful, but the user still needs to review
  // which account was selected. Keep it below the HIGH/direct threshold
  // without turning the suggestion into a blocking ambiguity.
  if (evidence.accountResolutionSource === 'RECENT_FALLBACK') {
    cap = Math.min(cap, 0.89);
  }

  return Math.max(0, Math.min(cap, Math.min(1, Number(score.toFixed(2)))));
}
