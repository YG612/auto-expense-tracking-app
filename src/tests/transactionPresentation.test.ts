import {
  transactionCategoryLabel,
  transactionTitle,
} from '../features/transactions/transactionPresentation';
import type { TransactionSummary } from '../database';

function summary(type: TransactionSummary['type']): TransactionSummary {
  return {
    id: `transaction-${type}`,
    type,
    amountMinor: 1000,
    currency: 'CNY',
    occurredAt: '2026-08-17T00:00:00.000Z',
    source: 'TEXT',
    confirmationStatus: 'CONFIRMED',
    duplicateStatus: 'NONE',
    revision: 1,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    syncStatus: 'LOCAL_ONLY',
    tagNames: [],
  };
}

describe('simplified transaction presentation', () => {
  it.each([
    ['REFUND', '收入'],
    ['REIMBURSEMENT', '收入'],
    ['LEND_OUT', '支出'],
    ['REPAYMENT_OUT', '支出'],
  ] as const)(
    'presents legacy %s rows through the two-direction UI',
    (type, label) => {
      expect(transactionTitle(summary(type))).toBe(label);
      expect(transactionCategoryLabel(summary(type))).toBe(label);
    },
  );
});
