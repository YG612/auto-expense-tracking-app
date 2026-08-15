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
  merchantRawName: '一鸣',
  projectName: '上海旅行',
  tags: ['旅行'],
  note: '和朋友吃饭',
  confidence: 0.96,
  missingFields: [],
  ambiguityReasons: [],
  originalText: '午饭花了25元，微信付的。',
  sourceText: '午饭花了25元,微信付的',
  categoryAlternatives: [],
  confidenceLevel: 'HIGH',
  suggestionSource: 'EXPLICIT_TEXT',
  matchedRulePattern: '午饭',
  matchedRulePriority: 100,
};

const baseProps = {
  accountLabel: '微信',
  categoryLabel: '餐饮 / 午餐',
  index: 0,
  onConfirm: jest.fn(),
  onEdit: jest.fn(),
  onPending: jest.fn(),
  reviewState: 'READY' as const,
};

describe('text confirmation card', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps the direct-confirm summary compact and exposes optional PRD fields on demand', async () => {
    const card = await render(
      <ConfirmationCard candidate={candidate} {...baseProps} />,
    );

    expect(card.getByText('第 1 笔')).toBeOnTheScreen();
    expect(card.getByText('可确认')).toBeOnTheScreen();
    expect(card.getByText('支出 · 餐饮 / 午餐')).toBeOnTheScreen();
    const expectedLocalTime = new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(candidate.occurredAt!));
    expect(card.getByText(`微信 · ${expectedLocalTime}`)).toBeOnTheScreen();
    expect(card.getByText('一鸣')).toBeOnTheScreen();
    expect(card.queryByText(/96%/)).toBeNull();
    expect(card.queryByText(/优先级/)).toBeNull();

    expect(card.getByRole('button', { name: '确认入账' })).toBeOnTheScreen();
    expect(card.getByRole('button', { name: '编辑' })).toBeOnTheScreen();
    expect(card.getByRole('button', { name: '存入待处理' })).toBeOnTheScreen();

    await fireEvent.press(card.getByRole('button', { name: '确认入账' }));
    expect(baseProps.onConfirm).toHaveBeenCalledWith('DIRECT_CONFIRM');

    await fireEvent.press(card.getByRole('button', { name: '查看详情' }));
    expect(card.getByText('高 · 可确认')).toBeOnTheScreen();
    expect(card.getByText('上海旅行')).toBeOnTheScreen();
    expect(card.getByText('旅行')).toBeOnTheScreen();
    expect(card.getByText('和朋友吃饭')).toBeOnTheScreen();
    expect(card.getByText('本次明确表达')).toBeOnTheScreen();
  });

  it('keeps a real amount ambiguity behind editing', async () => {
    const onEdit = jest.fn();
    const onPending = jest.fn();
    const card = await render(
      <ConfirmationCard
        {...baseProps}
        candidate={{
          ...candidate,
          confidence: 0.82,
          confidenceLevel: 'MEDIUM',
          ambiguityReasons: ['同一条描述中存在多个金额'],
        }}
        onEdit={onEdit}
        onPending={onPending}
      />,
    );

    expect(card.getByText('请检查')).toBeOnTheScreen();
    expect(card.queryByRole('button', { name: '确认入账' })).toBeNull();
    await fireEvent.press(card.getByRole('button', { name: '检查并编辑' }));
    await fireEvent.press(card.getByRole('button', { name: '存入待处理' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onPending).toHaveBeenCalledTimes(1);
  });

  it('offers one-tap reviewed confirmation when a personal rule completed the card', async () => {
    const onConfirm = jest.fn();
    const card = await render(
      <ConfirmationCard
        {...baseProps}
        accountLabel="微信"
        candidate={{
          ...candidate,
          amountMinor: 400,
          categoryKey: 'expense.transport',
          subcategoryKey: 'expense.transport.bus',
          confidence: 0.89,
          confidenceLevel: 'MEDIUM',
          merchantRawName: undefined,
          originalText: '坐车来回花了4块钱',
          sourceText: '坐车来回花了4块钱',
          suggestionSource: 'USER_RULE',
        }}
        categoryLabel="交通 / 公交"
        onConfirm={onConfirm}
      />,
    );

    expect(card.getByText('核对后确认')).toBeOnTheScreen();
    expect(card.getByText('支出 · 交通 / 公交')).toBeOnTheScreen();
    expect(card.getByRole('button', { name: '确认入账' })).toBeOnTheScreen();
    expect(card.getByRole('button', { name: '编辑' })).toBeOnTheScreen();
    expect(card.queryByRole('button', { name: '检查并编辑' })).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();

    await fireEvent.press(card.getByRole('button', { name: '确认入账' }));
    expect(onConfirm).toHaveBeenCalledWith('USER_REVIEWED_CONFIRM');
  });

  it('surfaces a recent-account advisory without forcing the editor', async () => {
    const onConfirm = jest.fn();
    const advisory = '账户按最近使用填为微信';
    const card = await render(
      <ConfirmationCard
        {...baseProps}
        candidate={{
          ...candidate,
          confidence: 0.89,
          confidenceLevel: 'MEDIUM',
          advisoryReasons: [advisory],
        }}
        onConfirm={onConfirm}
      />,
    );

    expect(card.getByText(advisory)).toBeOnTheScreen();
    expect(card.queryByText(/另有 1 条提示/)).toBeNull();
    expect(card.getByRole('button', { name: '确认入账' })).toBeOnTheScreen();
    expect(onConfirm).not.toHaveBeenCalled();

    await fireEvent.press(card.getByRole('button', { name: '确认入账' }));
    expect(onConfirm).toHaveBeenCalledWith('USER_REVIEWED_CONFIRM');
  });

  it('lets the user explicitly confirm a complete non-critical medium suggestion', async () => {
    const onConfirm = jest.fn();
    const card = await render(
      <ConfirmationCard
        {...baseProps}
        candidate={{
          ...candidate,
          confidence: 0.82,
          confidenceLevel: 'MEDIUM',
          categoryAlternatives: [{ label: '快餐' }],
        }}
        onConfirm={onConfirm}
      />,
    );

    expect(card.getByText('核对后确认')).toBeOnTheScreen();
    expect(card.getByText(/请核对当前建议/)).toBeOnTheScreen();
    await fireEvent.press(card.getByRole('button', { name: '确认入账' }));
    expect(onConfirm).toHaveBeenCalledWith('USER_REVIEWED_CONFIRM');
  });

  it('makes missing information the only primary path and progressively reveals alternatives', async () => {
    const onEdit = jest.fn();
    const card = await render(
      <ConfirmationCard
        {...baseProps}
        accountLabel="待补充"
        candidate={{
          ...candidate,
          categoryKey: undefined,
          subcategoryKey: undefined,
          accountKey: undefined,
          confidence: 0.57,
          confidenceLevel: 'LOW',
          missingFields: ['分类', '账户'],
          categoryAlternatives: [
            { label: '手机话费' },
            { label: '账户转账', type: 'TRANSFER' },
          ],
        }}
        categoryLabel="待确认"
        onEdit={onEdit}
      />,
    );

    expect(card.getByText('需补充')).toBeOnTheScreen();
    expect(card.getByText(/待补充：分类、账户/)).toBeOnTheScreen();
    expect(card.queryByText('手机话费、账户转账')).toBeNull();
    expect(card.queryByRole('button', { name: '确认入账' })).toBeNull();
    expect(card.queryByRole('button', { name: '存入待处理' })).toBeNull();
    await fireEvent.press(card.getByRole('button', { name: '补充信息' }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    await fireEvent.press(card.getByRole('button', { name: '查看详情' }));
    expect(card.getByText('手机话费、账户转账')).toBeOnTheScreen();
    expect(card.getByText('低 · 需补充')).toBeOnTheScreen();
  });
});
