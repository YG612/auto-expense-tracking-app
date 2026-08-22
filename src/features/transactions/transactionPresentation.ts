import type { TransactionSummary } from '../../database';
import type { TransactionType } from '../../domain/entities';
import { getTransactionTypeOption } from '../../domain/services/manualTransaction';
import { cashFlowDirectionForTransactionType } from '../../domain/policies/simplifiedBookkeepingPolicy';

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

function simplifiedTypeLabel(type: TransactionType): string {
  const direction = cashFlowDirectionForTransactionType(type);
  return direction === 'INCOME'
    ? '收入'
    : direction === 'EXPENSE'
      ? '支出'
      : getTransactionTypeOption(type).label;
}

export function transactionTitle(transaction: TransactionSummary): string {
  return (
    transaction.merchantName ??
    transaction.note ??
    transaction.subcategoryName ??
    transaction.categoryName ??
    simplifiedTypeLabel(transaction.type)
  );
}

export function transactionCategoryLabel(
  transaction: TransactionSummary,
): string {
  if (transaction.categoryName === undefined) {
    return simplifiedTypeLabel(transaction.type);
  }

  return transaction.subcategoryName === undefined
    ? transaction.categoryName
    : `${transaction.categoryName} / ${transaction.subcategoryName}`;
}
