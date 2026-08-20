import { fireEvent, render, waitFor } from '@testing-library/react-native';

import type { ParsedTransactionCandidate } from '../classification/types';
import type { ManualTransactionDraft } from '../domain/services/manualTransaction';
import { ConfirmationCard } from '../features/smart-entry/components/ConfirmationCard';

const now = '2026-08-04T04:00:00.000Z';
const references = {
  categories: [
    {
      id: 'food',
      type: 'EXPENSE' as const,
      systemKey: 'expense.food',
      name: '餐饮',
      sortOrder: 1,
      isSystem: true,
      isHidden: false,
      createdAt: now,
      updatedAt: now,
    },
  ],
  accounts: [
    {
      id: 'wechat',
      name: '微信',
      type: 'WECHAT' as const,
      currency: 'CNY',
      includeInNetWorth: true,
      sortOrder: 1,
      isHidden: false,
      createdAt: now,
      updatedAt: now,
    },
  ],
  projects: [
    {
      id: 'trip',
      name: '上海旅行',
      currency: 'CNY',
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    },
  ],
  tags: [{ id: 'travel', name: '旅行', createdAt: now, updatedAt: now }],
};

const candidate: ParsedTransactionCandidate = {
  type: 'EXPENSE',
  amountMinor: 2500,
  currency: 'CNY',
  occurredAt: now,
  categoryKey: 'expense.food',
  accountKey: 'WECHAT',
  merchantRawName: '一鸣',
  projectName: '上海旅行',
  tags: ['旅行'],
  note: '和朋友吃饭',
  confidence: 0.96,
  missingFields: [],
  ambiguityReasons: [],
  originalText: '午饭花了25元，微信付的。',
  sourceText: '午饭花了25元，微信付的',
  categoryAlternatives: [],
  confidenceLevel: 'HIGH',
  suggestionSource: 'EXPLICIT_TEXT',
};

const initialDraft: ManualTransactionDraft = {
  type: 'EXPENSE',
  amountText: '25.00',
  occurredAt: new Date(now),
  categoryId: 'food',
  accountId: 'wechat',
  merchantName: '一鸣',
  projectId: 'trip',
  tagIds: ['travel'],
  note: '和朋友吃饭',
};

const baseProps = {
  accountLabel: '微信',
  categoryLabel: '餐饮',
  index: 0,
  initialDraft,
  references,
  onConfirmEdited: jest.fn(),
  onEdit: jest.fn(),
  onPending: jest.fn(),
  reviewState: 'READY' as const,
};

describe('smart-entry confirmation card', () => {
  beforeEach(() => jest.clearAllMocks());

  it('edits only recognized business fields and keeps type and time read-only', async () => {
    const card = await render(
      <ConfirmationCard candidate={candidate} {...baseProps} />,
    );

    expect(card.getByText('支出 · 08/04 12:00')).toBeOnTheScreen();
    expect(card.queryByLabelText('交易类型')).toBeNull();
    expect(card.queryByLabelText('日期和时间')).toBeNull();
    expect(card.getByLabelText('金额')).toHaveProp('value', '25.00');
    expect(card.getByRole('button', { name: '餐饮' })).toBeOnTheScreen();
    expect(card.getByRole('button', { name: '微信' })).toBeOnTheScreen();
    expect(card.getByLabelText('商户')).toHaveProp('value', '一鸣');
    expect(card.getByRole('button', { name: '上海旅行' })).toBeOnTheScreen();
    expect(card.getByRole('button', { name: '旅行' })).toBeOnTheScreen();
    expect(card.getByLabelText('备注')).toHaveProp('value', '和朋友吃饭');
    expect(card.getByRole('button', { name: '编辑' })).toBeOnTheScreen();

    await fireEvent.changeText(card.getByLabelText('金额'), '28.50');
    await fireEvent.changeText(card.getByLabelText('商户'), '一鸣真鲜奶吧');
    await fireEvent.press(card.getByRole('button', { name: '确认入账' }));

    await waitFor(() => {
      expect(baseProps.onConfirmEdited).toHaveBeenCalledWith(
        expect.objectContaining({
          amountText: '28.50',
          merchantName: '一鸣真鲜奶吧',
          type: 'EXPENSE',
          occurredAt: new Date(now),
        }),
      );
    });
  });

  it('does not add empty merchant, project, tag, or note controls', async () => {
    const card = await render(
      <ConfirmationCard
        {...baseProps}
        candidate={{
          ...candidate,
          merchantRawName: undefined,
          projectName: undefined,
          tags: [],
          note: undefined,
        }}
        initialDraft={{
          ...initialDraft,
          merchantName: '',
          projectId: undefined,
          tagIds: [],
          note: '',
        }}
      />,
    );

    expect(card.queryByLabelText('商户')).toBeNull();
    expect(card.queryByLabelText('备注')).toBeNull();
    expect(card.queryByText('项目')).toBeNull();
    expect(card.queryByText('标签')).toBeNull();
    expect(card.getByLabelText('金额')).toBeOnTheScreen();
  });

  it('routes genuinely missing hidden fields to the full editor', async () => {
    const onEdit = jest.fn();
    const card = await render(
      <ConfirmationCard
        {...baseProps}
        accountLabel="待补充"
        candidate={{
          ...candidate,
          categoryKey: undefined,
          accountKey: undefined,
          missingFields: ['分类', '账户'],
          confidenceLevel: 'LOW',
        }}
        initialDraft={{
          ...initialDraft,
          categoryId: undefined,
          accountId: undefined,
        }}
        onEdit={onEdit}
      />,
    );

    expect(card.queryByText('分类')).toBeNull();
    expect(card.queryByText('账户')).toBeNull();
    await fireEvent.press(card.getByRole('button', { name: '编辑' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('keeps the status specific while naming the full-editor action consistently', async () => {
    const onEdit = jest.fn();
    const card = await render(
      <ConfirmationCard
        {...baseProps}
        accountLabel="待补充"
        candidate={{
          ...candidate,
          accountKey: undefined,
          missingFields: ['账户'],
          confidenceLevel: 'MEDIUM',
        }}
        initialDraft={{ ...initialDraft, accountId: undefined }}
        onEdit={onEdit}
      />,
    );

    expect(card.getByText('请选择入账账户')).toBeOnTheScreen();
    await fireEvent.press(card.getByRole('button', { name: '编辑' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
