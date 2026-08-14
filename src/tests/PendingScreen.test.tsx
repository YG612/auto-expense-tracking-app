import { fireEvent, render } from '@testing-library/react-native';

import type { TransactionSummary } from '../database';
import type { Account, Category } from '../domain/entities';
import {
  PendingCard,
  pendingTransactionsEligibleForBatch,
} from '../features/pending/PendingScreen';
import {
  pendingAccountOptions,
  pendingCategoryOptions,
} from '../features/pending/pendingReviewOptions';

const now = '2026-08-08T04:00:00.000Z';

function category(
  id: string,
  name: string,
  systemKey: string,
  parentId?: string,
): Category {
  return {
    id,
    type: 'EXPENSE',
    parentId,
    systemKey,
    name,
    sortOrder: 0,
    isSystem: true,
    isHidden: false,
    createdAt: now,
    updatedAt: now,
  };
}

function account(id: string, name: string, type: Account['type']): Account {
  return {
    id,
    name,
    type,
    currency: 'CNY',
    includeInNetWorth: true,
    sortOrder: 0,
    isHidden: false,
    createdAt: now,
    updatedAt: now,
  };
}

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

  it('edits required fields directly from the card', async () => {
    const onChooseAccount = jest.fn();
    const onChooseCategory = jest.fn();
    const view = await render(
      <PendingCard
        accountChoices={[
          {
            id: 'account-wechat',
            label: '微信',
            selected: false,
            recommendation: 'MOST_LIKELY',
          },
        ]}
        busy={false}
        categoryChoices={[
          {
            id: 'category-expense-transport-bus',
            label: '公交',
            detail: '交通',
            selected: false,
            recommendation: 'MOST_LIKELY',
          },
        ]}
        onChooseAccount={onChooseAccount}
        onChooseCategory={onChooseCategory}
        onConfirm={jest.fn()}
        onDelete={jest.fn()}
        onEdit={jest.fn()}
        transaction={pendingTransaction({
          accountId: undefined,
          categoryId: undefined,
          requiresReview: true,
          reviewReasonCodes: ['MISSING_FIELDS'],
        })}
      />,
    );

    expect(view.getAllByText('必选')).toHaveLength(2);
    await fireEvent.press(
      view.getByRole('button', { name: '账户：微信，最可能' }),
    );
    await fireEvent.press(
      view.getByRole('button', { name: '分类：交通 / 公交，最可能' }),
    );
    expect(onChooseAccount).toHaveBeenCalledWith('account-wechat');
    expect(onChooseCategory).toHaveBeenCalledWith(
      'category-expense-transport-bus',
    );
  });

  it('exposes pending selection as an accessible checkbox', async () => {
    const onToggleSelected = jest.fn();
    const view = await render(
      <PendingCard
        busy={false}
        onConfirm={jest.fn()}
        onDelete={jest.fn()}
        onEdit={jest.fn()}
        onToggleSelected={onToggleSelected}
        selected={false}
        transaction={pendingTransaction()}
      />,
    );

    await fireEvent.press(
      view.getByRole('checkbox', { name: '选择此待确认记录' }),
    );
    expect(onToggleSelected).toHaveBeenCalledTimes(1);
  });
});

describe('pending inline recommendations', () => {
  const categories = [
    category('category-expense-food', '餐饮', 'expense.food'),
    category(
      'category-expense-food-snacks',
      '零食',
      'expense.food.snacks',
      'category-expense-food',
    ),
    category(
      'category-expense-food-drinks',
      '饮料',
      'expense.food.drinks',
      'category-expense-food',
    ),
    category(
      'category-expense-food-breakfast',
      '早餐',
      'expense.food.breakfast',
      'category-expense-food',
    ),
    category('category-expense-shopping', '购物', 'expense.shopping'),
    category(
      'category-expense-shopping-daily_supplies',
      '日用品',
      'expense.shopping.daily_supplies',
      'category-expense-shopping',
    ),
  ];

  it('surfaces ambiguity alternatives before generic categories', () => {
    const result = pendingCategoryOptions(
      pendingTransaction({
        categoryId: undefined,
        originalText: '罗森便利店消费 25 元',
      }),
      categories,
    );

    expect(result.quick.map(option => option.label)).toEqual([
      '零食',
      '饮料',
      '早餐',
    ]);
    expect(result.quick[0]?.recommendation).toBe('MOST_LIKELY');
    expect(result.all[3]?.label).toBe('日用品');
  });

  it('uses the bill source as the account recommendation when missing', () => {
    const result = pendingAccountOptions(
      pendingTransaction({
        accountId: undefined,
        source: 'ALIPAY_IMPORT',
      }),
      [
        account('account-wechat', '微信', 'WECHAT'),
        account('account-alipay', '支付宝', 'ALIPAY'),
      ],
    );

    expect(result.quick[0]).toMatchObject({
      id: 'account-alipay',
      recommendation: 'MOST_LIKELY',
      selected: false,
    });
  });
});
