import { fireEvent, render } from '@testing-library/react-native';

import type { TransactionSummary } from '../database';
import {
  PendingCard,
  pendingTransactionsEligibleForBatch,
} from '../features/pending/PendingScreen';

function pendingTransaction(
  overrides: Partial<TransactionSummary> = {},
): TransactionSummary {
  return {
    id: 'pending-1',
    revision: 1,
    type: 'EXPENSE',
    amountMinor: 2500,
    currency: 'CNY',
    occurredAt: '2026-08-08T04:00:00.000Z',
    categoryId: 'category-expense-food',
    accountId: 'account-wechat',
    source: 'TEXT',
    confidence: 0.96,
    requiresReview: false,
    reviewReasonCodes: [],
    confirmationStatus: 'PENDING',
    duplicateStatus: 'NONE',
    createdAt: '2026-08-08T04:00:00.000Z',
    updatedAt: '2026-08-08T04:00:00.000Z',
    syncStatus: 'LOCAL_ONLY',
    tagNames: [],
    ...overrides,
  };
}

describe('pending review safety', () => {
  it('never includes review-required rows in batch confirmation', () => {
    const direct = pendingTransaction();
    const needsReview = pendingTransaction({
      id: 'pending-2',
      requiresReview: true,
      reviewReasonCodes: ['AMBIGUOUS'],
    });

    expect(pendingTransactionsEligibleForBatch([direct, needsReview])).toEqual([
      direct,
    ]);
    expect(pendingTransactionsEligibleForBatch([needsReview])).toEqual([]);
  });

  it('shows one check/edit entry point for an uncertain row', async () => {
    const onEdit = jest.fn();
    const view = await render(
      <PendingCard
        busy={false}
        onConfirm={jest.fn()}
        onDelete={jest.fn()}
        onEdit={onEdit}
        transaction={pendingTransaction({
          requiresReview: true,
          reviewReasonCodes: ['AMBIGUOUS'],
        })}
      />,
    );

    expect(view.queryByRole('button', { name: '确认入账' })).toBeNull();
    expect(view.queryByRole('button', { name: '编辑' })).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '检查并确认' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('keeps confirm and edit as separate actions only for a safe row', async () => {
    const onConfirm = jest.fn();
    const onEdit = jest.fn();
    const view = await render(
      <PendingCard
        busy={false}
        onConfirm={onConfirm}
        onDelete={jest.fn()}
        onEdit={onEdit}
        transaction={pendingTransaction()}
      />,
    );

    await fireEvent.press(view.getByRole('button', { name: '确认入账' }));
    await fireEvent.press(view.getByRole('button', { name: '编辑' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
