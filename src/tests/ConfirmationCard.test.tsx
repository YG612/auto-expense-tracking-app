import { fireEvent, render } from '@testing-library/react-native';

import type { ParsedTransactionCandidate } from '../classification/types';
import { ConfirmationCard } from '../features/smart-entry/components/ConfirmationCard';

const candidate: ParsedTransactionCandidate = {
  type: 'EXPENSE',
  amountMinor: 2500,
  currency: 'CNY',
  occurredAt: '2026-08-04T04:00:00.000Z',
  categoryKey: 'expense.food',
  subcategoryKey: 'expense.food.lunch',
  accountKey: 'WECHAT',
  tags: [],
  confidence: 0.96,
  missingFields: [],
  ambiguityReasons: [],
  originalText: '午饭花了25元，微信付的。',
  sourceText: '午饭花了25元,微信付的',
  categoryAlternatives: [],
  confidenceLevel: 'HIGH',
  suggestionSource: 'EXPLICIT_TEXT',
};

describe('text confirmation card', () => {
  it('shows the structured candidate and invokes explicit confirmation', async () => {
    const onConfirm = jest.fn();
    const card = await render(
      <ConfirmationCard
        accountLabel="微信"
        canConfirm
        canPersist
        candidate={candidate}
        categoryLabel="餐饮 / 午餐"
        index={0}
        onConfirm={onConfirm}
        onEdit={jest.fn()}
        onOpenPending={jest.fn()}
        onPending={jest.fn()}
        saveState="UNSAVED"
      />,
    );

    expect(card.getByText('候选 1')).toBeOnTheScreen();
    expect(card.getByText('高置信度 96%')).toBeOnTheScreen();
    expect(card.getByText('餐饮 / 午餐')).toBeOnTheScreen();
    fireEvent.press(card.getByRole('button', { name: '确认入账' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows low-confidence alternatives without a direct-confirm action', async () => {
    const card = await render(
      <ConfirmationCard
        accountLabel="待补充"
        canConfirm={false}
        canPersist
        candidate={{
          ...candidate,
          categoryKey: undefined,
          subcategoryKey: undefined,
          confidence: 0.57,
          confidenceLevel: 'LOW',
          missingFields: ['分类', '账户'],
          categoryAlternatives: [
            { label: '手机话费' },
            { label: '账户转账', type: 'TRANSFER' },
          ],
        }}
        categoryLabel="待确认"
        index={0}
        onConfirm={jest.fn()}
        onEdit={jest.fn()}
        onOpenPending={jest.fn()}
        onPending={jest.fn()}
        saveState="UNSAVED"
      />,
    );

    expect(card.getByText('低置信度 57%')).toBeOnTheScreen();
    expect(card.getByText('手机话费、账户转账')).toBeOnTheScreen();
    expect(card.queryByRole('button', { name: '确认入账' })).toBeNull();
    expect(card.getByRole('button', { name: '暂存待确认' })).toBeOnTheScreen();
  });
});
