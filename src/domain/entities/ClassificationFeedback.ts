import type { TransactionType } from './Transaction';

export const FEEDBACK_LEARNING_STATUSES = [
  'PENDING',
  'PROMOTED',
  'DISMISSED',
] as const;

export type FeedbackLearningStatus =
  (typeof FEEDBACK_LEARNING_STATUSES)[number];

export interface ClassificationFeedback {
  id: string;
  transactionId: string;
  originalType?: TransactionType;
  correctedType?: TransactionType;
  originalCategoryId?: string;
  correctedCategoryId?: string;
  originalSubcategoryId?: string;
  correctedSubcategoryId?: string;
  originalAccountId?: string;
  correctedAccountId?: string;
  sourceText?: string;
  merchantRawName?: string;
  /** Existing callers that omit status create a PENDING learning sample. */
  learningStatus?: FeedbackLearningStatus;
  promotedRuleId?: string;
  processedAt?: string;
  createdAt: string;
}
