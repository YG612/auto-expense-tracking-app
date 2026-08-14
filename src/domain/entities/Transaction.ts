export const TRANSACTION_TYPES = [
  'EXPENSE',
  'INCOME',
  'TRANSFER',
  'REFUND',
  'BORROW_IN',
  'LEND_OUT',
  'REPAYMENT_IN',
  'REPAYMENT_OUT',
  'REIMBURSEMENT',
  'ADJUSTMENT',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_SOURCES = [
  'MANUAL',
  'TEXT',
  'VOICE',
  'ANDROID_NOTIFICATION',
  'IOS_SHARE',
  'OCR',
  'WECHAT_IMPORT',
  'ALIPAY_IMPORT',
  'CSV_IMPORT',
  'SYNC',
] as const;

export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const CONFIRMATION_STATUSES = [
  'CONFIRMED',
  'PENDING',
  'REJECTED',
] as const;

export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export const TRANSACTION_REVIEW_REASON_CODES = [
  'MISSING_FIELDS',
  'CONFIDENCE_NOT_HIGH',
  'AMBIGUOUS',
  'CATEGORY_ALTERNATIVES',
  'LEGACY_PENDING_UNCLASSIFIED',
] as const;

export type TransactionReviewReasonCode =
  (typeof TRANSACTION_REVIEW_REASON_CODES)[number];

export const DUPLICATE_STATUSES = ['NONE', 'POSSIBLE', 'MERGED'] as const;

export type DuplicateStatus = (typeof DUPLICATE_STATUSES)[number];

export const SYNC_STATUSES = [
  'LOCAL_ONLY',
  'PENDING',
  'SYNCED',
  'CONFLICT',
] as const;

export type SyncStatus = (typeof SYNC_STATUSES)[number];

export interface Transaction {
  id: string;
  revision: number;
  type: TransactionType;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  categoryId?: string;
  subcategoryId?: string;
  accountId?: string;
  targetAccountId?: string;
  merchantId?: string;
  merchantRawName?: string;
  projectId?: string;
  note?: string;
  source: TransactionSource;
  sourceReferenceId?: string;
  originalText?: string;
  confidence?: number;
  /**
   * Recognition uncertainty that must survive a trip through the pending
   * inbox. Optional only for source compatibility with pre-v5 callers; the
   * repository persists a concrete boolean and reason array for every row.
   */
  requiresReview?: boolean;
  reviewReasonCodes?: TransactionReviewReasonCode[];
  confirmationStatus: ConfirmationStatus;
  duplicateStatus: DuplicateStatus;
  relatedTransactionId?: string;
  fingerprint?: string;
  importRecordId?: string;
  /** Durable local receipt for an explicitly enabled automatic confirmation. */
  autoConfirmationReason?: string;
  autoConfirmedAt?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  syncStatus: SyncStatus;
}
