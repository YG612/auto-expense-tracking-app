import type { TransactionSummary } from '../../database';
import type { TransactionType } from '../../domain/entities';
import { getTransactionTypeOption } from '../../domain/services/manualTransaction';

export type AmountTone = 'negative' | 'positive' | 'neutral';

export function transactionAmountTone(type: TransactionType): AmountTone {
  if (['EXPENSE', 'LEND_OUT', 'REPAYMENT_OUT'].includes(type)) {
    return 'negative';
  }

  if (
    ['INCOME', 'REFUND', 'BORROW_IN', 'REPAYMENT_IN', 'REIMBURSEMENT'].includes(
      type,
    )
  ) {
    return 'positive';
  }

  return 'neutral';
}

export function transactionTitle(transaction: TransactionSummary): string {
  return (
    transaction.merchantName ??
    transaction.note ??
    transaction.subcategoryName ??
    transaction.categoryName ??
    getTransactionTypeOption(transaction.type).label
  );
}

export function transactionCategoryLabel(
  transaction: TransactionSummary,
): string {
  if (transaction.categoryName === undefined) {
    return getTransactionTypeOption(transaction.type).label;
  }

  return transaction.subcategoryName === undefined
    ? transaction.categoryName
    : `${transaction.categoryName} / ${transaction.subcategoryName}`;
}
