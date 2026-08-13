import type { TransactionReviewReasonCode, TransactionType } from '../entities';
import { AppError } from '../errors/AppError';

export type ReviewDisposition =
  'DIRECT_CONFIRM' | 'REVIEW_CONFIRM' | 'EDIT_OR_PENDING' | 'EDIT_ONLY';

export type RecognizedConfirmationIntent =
  'DIRECT_CONFIRM' | 'USER_REVIEWED_CONFIRM';

export type ReviewReasonCode = TransactionReviewReasonCode;

export class ReviewRequiredError extends AppError {
  constructor(reasonCodes: readonly ReviewReasonCode[]) {
    super(
      'SMART-ENTRY-REVIEW-REQUIRED',
      '识别结果存在不确定项，请检查并编辑后再确认。',
      {
        category: 'VALIDATION',
        retryable: true,
        cause: [...reasonCodes],
      },
    );
    this.name = 'ReviewRequiredError';
  }
}

/**
 * The smallest recognition contract needed to decide how a candidate may be
 * handled. Keeping this structural avoids coupling the domain layer back to
 * the classification implementation.
 */
export type ReviewCandidate = {
  type?: TransactionType;
  amountMinor?: number;
  currency?: string;
  occurredAt?: string;
  categoryKey?: string;
  categoryIdHint?: string;
  accountKey?: string;
  accountIdHint?: string;
  accountResolutionSource?:
    'EXPLICIT_TEXT' | 'USER_RULE' | 'RECENT_FALLBACK' | 'MISSING';
  targetAccountKey?: string;
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  missingFields: readonly unknown[];
  ambiguityReasons: readonly unknown[];
  /**
   * Complete-but-inferred values that the user can safely accept with one
   * explicit confirmation. Advisories never override structural or semantic
   * blockers; they only prevent the candidate from being treated as a direct
   * confirmation.
   */
  advisoryReasons?: readonly unknown[];
  categoryAlternatives: readonly unknown[];
};

const REVIEW_CONFIRMABLE_TYPES = new Set<TransactionType>([
  'EXPENSE',
  'INCOME',
]);

function isPositiveMinorAmount(value: number | undefined): boolean {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}

function isValidOccurredAt(value: string | undefined): boolean {
  return value !== undefined && !Number.isNaN(Date.parse(value));
}

function hasAccount(candidate: ReviewCandidate): boolean {
  if (candidate.accountResolutionSource === 'MISSING') {
    return false;
  }
  return (
    candidate.accountKey !== undefined || candidate.accountIdHint !== undefined
  );
}

function hasCategory(candidate: ReviewCandidate): boolean {
  return (
    candidate.categoryKey !== undefined ||
    candidate.categoryIdHint !== undefined
  );
}

function hasStructuralGap(candidate: ReviewCandidate): boolean {
  if (
    candidate.type === undefined ||
    !isPositiveMinorAmount(candidate.amountMinor) ||
    candidate.currency === undefined ||
    !isValidOccurredAt(candidate.occurredAt) ||
    !hasAccount(candidate)
  ) {
    return true;
  }
  return (
    REVIEW_CONFIRMABLE_TYPES.has(candidate.type) && !hasCategory(candidate)
  );
}

function hasProtectedTransactionSemantics(candidate: ReviewCandidate): boolean {
  return (
    candidate.type !== undefined &&
    !REVIEW_CONFIRMABLE_TYPES.has(candidate.type)
  );
}

function hasUnsupportedCurrency(candidate: ReviewCandidate): boolean {
  return candidate.currency !== undefined && candidate.currency !== 'CNY';
}

function hasCriticalRisk(candidate: ReviewCandidate): boolean {
  return (
    candidate.confidenceLevel === 'LOW' ||
    candidate.ambiguityReasons.length > 0 ||
    hasProtectedTransactionSemantics(candidate) ||
    hasUnsupportedCurrency(candidate)
  );
}

function hasAdvisory(candidate: ReviewCandidate): boolean {
  return (
    candidate.accountResolutionSource === 'RECENT_FALLBACK' ||
    (candidate.advisoryReasons?.length ?? 0) > 0
  );
}

export function reviewReasonCodes(
  candidate: ReviewCandidate,
): ReviewReasonCode[] {
  const reasons: ReviewReasonCode[] = [];
  if (candidate.missingFields.length > 0 || hasStructuralGap(candidate)) {
    reasons.push('MISSING_FIELDS');
  }
  if (candidate.confidenceLevel !== 'HIGH') {
    reasons.push('CONFIDENCE_NOT_HIGH');
  }
  if (
    candidate.ambiguityReasons.length > 0 ||
    hasAdvisory(candidate) ||
    hasProtectedTransactionSemantics(candidate) ||
    hasUnsupportedCurrency(candidate)
  ) {
    reasons.push('AMBIGUOUS');
  }
  if (candidate.categoryAlternatives.length > 0) {
    reasons.push('CATEGORY_ALTERNATIVES');
  }
  return reasons;
}

export function reviewDisposition(
  candidate: ReviewCandidate,
): ReviewDisposition {
  if (candidate.missingFields.length > 0 || hasStructuralGap(candidate)) {
    return 'EDIT_ONLY';
  }
  if (hasCriticalRisk(candidate)) {
    return 'EDIT_OR_PENDING';
  }
  if (
    candidate.confidenceLevel === 'HIGH' &&
    !hasAdvisory(candidate) &&
    candidate.categoryAlternatives.length === 0
  ) {
    return 'DIRECT_CONFIRM';
  }
  return 'REVIEW_CONFIRM';
}

/**
 * Resolves the only confirmation intent the current candidate may accept.
 * Persistence calls this same function, so a forged UI action cannot turn a
 * critical recognition risk into a confirmed ledger write.
 */
export function confirmationIntentFor(
  candidate: ReviewCandidate,
): RecognizedConfirmationIntent | undefined {
  const disposition = reviewDisposition(candidate);
  if (disposition === 'DIRECT_CONFIRM') {
    return 'DIRECT_CONFIRM';
  }
  if (disposition === 'REVIEW_CONFIRM') {
    return 'USER_REVIEWED_CONFIRM';
  }
  return undefined;
}

export function canConfirmWithIntent(
  candidate: ReviewCandidate,
  intent: RecognizedConfirmationIntent,
): boolean {
  const requiredIntent = confirmationIntentFor(candidate);
  return (
    requiredIntent === intent ||
    (requiredIntent === 'DIRECT_CONFIRM' && intent === 'USER_REVIEWED_CONFIRM')
  );
}
