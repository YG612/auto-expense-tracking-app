import type { TransactionType } from '../entities';
import { rollupExpenseSystemKey } from './bookkeepingPresentationPolicy';

export const SIMPLIFIED_CLASSIFICATION_LABELS = [
  'income',
  'expense.food',
  'expense.transport',
  'expense.shopping',
  'expense.housing',
  'expense.entertainment',
  'expense.healthcare',
  'expense.education',
  'expense.other_expense',
] as const;

export type SimplifiedClassificationLabel =
  (typeof SIMPLIFIED_CLASSIFICATION_LABELS)[number];

export type CashFlowDirection = 'INCOME' | 'EXPENSE';

export type SimplifiedSemanticFlags = {
  possibleTransfer: boolean;
  possibleRefund: boolean;
  possibleReimbursement: boolean;
  possibleDebtMovement: boolean;
  possibleStoredValueRecharge: boolean;
  excludeFromIncomeExpenseStats: boolean;
  offsetsPreviousExpense: boolean;
};

export type SimplifiedClassification = {
  direction?: CashFlowDirection;
  classificationLabel?: SimplifiedClassificationLabel;
  categoryKey?: Exclude<SimplifiedClassificationLabel, 'income'>;
  semanticFlags: SimplifiedSemanticFlags;
};

const INCOME_DIRECTION_TYPES = new Set<TransactionType>([
  'INCOME',
  'REFUND',
  'BORROW_IN',
  'REPAYMENT_IN',
  'REIMBURSEMENT',
]);

const EXPENSE_DIRECTION_TYPES = new Set<TransactionType>([
  'EXPENSE',
  'LEND_OUT',
  'REPAYMENT_OUT',
]);

const DEBT_MOVEMENT_TYPES = new Set<TransactionType>([
  'BORROW_IN',
  'LEND_OUT',
  'REPAYMENT_IN',
  'REPAYMENT_OUT',
]);

export function cashFlowDirectionForTransactionType(
  type: TransactionType | undefined,
): CashFlowDirection | undefined {
  if (type !== undefined && INCOME_DIRECTION_TYPES.has(type)) return 'INCOME';
  if (type !== undefined && EXPENSE_DIRECTION_TYPES.has(type)) return 'EXPENSE';
  return undefined;
}

export function simplifiedExpenseCategoryKey(
  systemKey: string | undefined,
): Exclude<SimplifiedClassificationLabel, 'income'> | undefined {
  if (systemKey === undefined) return undefined;
  const canonical = rollupExpenseSystemKey(systemKey).group.canonicalSystemKey;
  return SIMPLIFIED_CLASSIFICATION_LABELS.includes(
    canonical as SimplifiedClassificationLabel,
  )
    ? (canonical as Exclude<SimplifiedClassificationLabel, 'income'>)
    : undefined;
}

/**
 * Projects the legacy bookkeeping semantics into the user-facing two-direction,
 * nine-label contract. Legacy types remain available to persistence and
 * analytics, but callers do not need to expose them as user choices.
 */
export function simplifyBookkeepingClassification(input: {
  type?: TransactionType;
  categoryKey?: string;
  storedValueRecharge?: boolean;
}): SimplifiedClassification {
  const direction = cashFlowDirectionForTransactionType(input.type);
  const categoryKey =
    input.type === 'EXPENSE'
      ? simplifiedExpenseCategoryKey(input.categoryKey)
      : undefined;
  const possibleRefund = input.type === 'REFUND';
  const possibleReimbursement = input.type === 'REIMBURSEMENT';
  const possibleDebtMovement =
    input.type !== undefined && DEBT_MOVEMENT_TYPES.has(input.type);
  const possibleTransfer = input.type === 'TRANSFER';
  const possibleStoredValueRecharge = input.storedValueRecharge === true;

  return {
    direction,
    classificationLabel:
      direction === 'INCOME'
        ? 'income'
        : input.type === 'EXPENSE'
          ? categoryKey
          : undefined,
    categoryKey,
    semanticFlags: {
      possibleTransfer,
      possibleRefund,
      possibleReimbursement,
      possibleDebtMovement,
      possibleStoredValueRecharge,
      excludeFromIncomeExpenseStats:
        possibleTransfer ||
        possibleRefund ||
        possibleReimbursement ||
        possibleDebtMovement ||
        possibleStoredValueRecharge,
      offsetsPreviousExpense: possibleRefund || possibleReimbursement,
    },
  };
}
