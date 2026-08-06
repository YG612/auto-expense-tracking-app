import type { TransactionType } from '../../domain/entities';

export type ConfidenceEvidence = {
  hasAmount: boolean;
  hasType: boolean;
  hasCategory: boolean;
  hasSubcategory: boolean;
  accountEvidence: 'EXPLICIT' | 'INFERRED' | 'MISSING';
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
    | 'MISSING_CATEGORY'
  )[];
};

function capForRisk(risk: ConfidenceEvidence['risks'][number]): number {
  switch (risk) {
    case 'PERSONAL_RECIPIENT':
    case 'MULTIPLE_AMOUNTS':
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
  let score = 0;
  score += evidence.hasAmount ? 0.3 : 0;
  score += evidence.hasType ? 0.2 : 0;
  score += evidence.hasCategory ? 0.15 : 0;
  score += evidence.hasSubcategory ? 0.12 : 0;
  score +=
    evidence.accountEvidence === 'EXPLICIT'
      ? 0.1
      : evidence.accountEvidence === 'INFERRED'
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

  return Math.max(0, Math.min(cap, Math.min(1, Number(score.toFixed(2)))));
}
