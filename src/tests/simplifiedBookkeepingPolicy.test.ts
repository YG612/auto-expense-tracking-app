import {
  SIMPLIFIED_CLASSIFICATION_LABELS,
  simplifyBookkeepingClassification,
} from '../domain/policies/simplifiedBookkeepingPolicy';

describe('simplified bookkeeping classification policy', () => {
  it('freezes one income label and eight expense labels', () => {
    expect(SIMPLIFIED_CLASSIFICATION_LABELS).toEqual([
      'income',
      'expense.food',
      'expense.transport',
      'expense.shopping',
      'expense.housing',
      'expense.entertainment',
      'expense.healthcare',
      'expense.education',
      'expense.other_expense',
    ]);
  });

  it.each([
    ['expense.travel', 'expense.transport'],
    ['expense.communication', 'expense.housing'],
    ['expense.pets', 'expense.housing'],
    ['expense.social', 'expense.other_expense'],
    ['expense.financial_fees', 'expense.other_expense'],
  ] as const)('rolls legacy category %s into %s', (legacy, expected) => {
    expect(
      simplifyBookkeepingClassification({
        type: 'EXPENSE',
        categoryKey: legacy,
      }),
    ).toMatchObject({
      direction: 'EXPENSE',
      classificationLabel: expected,
      categoryKey: expected,
    });
  });

  it('represents refunds as income direction plus non-user-facing flags', () => {
    expect(
      simplifyBookkeepingClassification({
        type: 'REFUND',
        categoryKey: 'income.refund',
      }),
    ).toEqual({
      direction: 'INCOME',
      classificationLabel: 'income',
      categoryKey: undefined,
      semanticFlags: {
        possibleTransfer: false,
        possibleRefund: true,
        possibleReimbursement: false,
        possibleDebtMovement: false,
        possibleStoredValueRecharge: false,
        excludeFromIncomeExpenseStats: true,
        offsetsPreviousExpense: true,
      },
    });
  });

  it('does not invent a direction for an internal transfer', () => {
    expect(
      simplifyBookkeepingClassification({ type: 'TRANSFER' }),
    ).toMatchObject({
      direction: undefined,
      classificationLabel: undefined,
      semanticFlags: {
        possibleTransfer: true,
        excludeFromIncomeExpenseStats: true,
      },
    });
  });
});
