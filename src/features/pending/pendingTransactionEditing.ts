import type { Transaction } from '../../domain/entities';
import {
  amountTextFromMinor,
  buildManualTransaction,
  type ManualTransactionDraft,
} from '../../domain/services/manualTransaction';

export function pendingDraftFromTransaction(
  transaction: Transaction & { merchantName?: string },
  tagIds: readonly string[],
): ManualTransactionDraft {
  return {
    type: transaction.type,
    amountText: amountTextFromMinor(transaction.amountMinor),
    occurredAt: new Date(transaction.occurredAt),
    categoryId: transaction.categoryId,
    subcategoryId: transaction.subcategoryId,
    accountId: transaction.accountId,
    targetAccountId: transaction.targetAccountId,
    merchantName: transaction.merchantRawName ?? transaction.merchantName ?? '',
    projectId: transaction.projectId,
    tagIds,
    note: transaction.note ?? '',
  };
}

export function buildReviewedTransaction(
  existing: Transaction,
  draft: ManualTransactionDraft,
  amountMinor: number,
  nowIso: string,
  confirm: boolean,
): Transaction {
  const reviewed = buildManualTransaction(
    draft,
    amountMinor,
    existing.id,
    nowIso,
    existing,
  );

  return confirm
    ? reviewed
    : {
        ...reviewed,
        confirmationStatus: 'PENDING',
      };
}
