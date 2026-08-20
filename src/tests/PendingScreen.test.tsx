import { fireEvent, render } from '@testing-library/react-native';

import type { TransactionSummary } from '../database';
import {
  PendingCard,
  pendingTransactionsEligibleForBatch,
} from '../features/pending/PendingScreen';

const timestamp = '2026-08-08T04:00:00.000Z';

const references = {
  categories: [
    {
      id: 'category-expense-food',
      type: 'EXPENSE' as const,
      name: '餐饮',
      sortOrder: 1,
      isSystem: true,
      isHidden: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  accounts: [
    {
      id: 'account-wechat',
      name: '微信',
      type: 'WECHAT' as const,
      currency: 'CNY',
      includeInNetWorth: true,
      sortOrder: 1,
      isHidden: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  projects: [],
  tags: [],
};

function pendingTransaction(
  overrides: Partial<TransactionSummary> = {},
): TransactionSummary {
  return {
    id: 'pending-1',
    revision: 1,
    type: 'EXPENSE',
    amountMinor: 2500,
    currency: 'CNY',
    occurredAt: timestamp,
    categoryId: 'category-expense-food',
    accountId: 'account-wechat',
    source: 'TEXT',
    confidence: 0.96,
    requiresReview: false,
    reviewReasonCodes: [],
    confirmationStatus: 'PENDING',
    duplicateStatus: 'NONE',
    createdAt: timestamp,
    updatedAt: timestamp,
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

  it('exposes recognized fields directly on an uncertain card', async () => {
    const onSave = jest.fn(async () => true);
    const onEdit = jest.fn();
    const view = await render(
      <PendingCard
        busy={false}
        onDelete={jest.fn()}
        onEdit={onEdit}
        onSave={onSave}
        references={references}
        tagIds={[]}
        transaction={pendingTransaction({
          merchantRawName: '原商户',
          note: '原备注',
          requiresReview: true,
          reviewReasonCodes: ['AMBIGUOUS'],
        })}
      />,
    );

    expect(view.getByRole('button', { name: '编辑' })).toBeOnTheScreen();
    expect(view.getByLabelText('金额').props.value).toBe('25.00');
    expect(view.getByLabelText('商户').props.value).toBe('原商户');
    expect(view.getByLabelText('备注').props.value).toBe('原备注');

    await fireEvent.changeText(view.getByLabelText('金额'), '32.50');
    await fireEvent.changeText(view.getByLabelText('商户'), '修改后商户');
    await fireEvent.press(view.getByRole('button', { name: '保存并确认' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        amountText: '32.50',
        merchantName: '修改后商户',
        categoryId: 'category-expense-food',
        accountId: 'account-wechat',
      }),
      true,
    );
    await fireEvent.press(view.getByRole('button', { name: '编辑' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('can save inline corrections without confirming the row', async () => {
    const onSave = jest.fn(async () => true);
    const view = await render(
      <PendingCard
        busy={false}
        onDelete={jest.fn()}
        onEdit={jest.fn()}
        onSave={onSave}
        references={references}
        tagIds={[]}
        transaction={pendingTransaction()}
      />,
    );

    await fireEvent.changeText(view.getByLabelText('备注'), '稍后再确认');
    await fireEvent.press(view.getByRole('button', { name: '仅保存' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ note: '稍后再确认' }),
      false,
    );
  });
});
