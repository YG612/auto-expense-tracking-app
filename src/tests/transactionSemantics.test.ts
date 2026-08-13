import type { Category } from '../domain/entities';
import {
  categoryAssignmentIssues,
  categoryTypeForTransactionType,
} from '../domain/services/transactionSemantics';

const createdAt = '2026-08-08T00:00:00.000Z';

function category(
  id: string,
  type: Category['type'],
  parentId?: string,
): Category {
  return {
    id,
    type,
    parentId,
    name: id,
    sortOrder: 0,
    isSystem: true,
    isHidden: false,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('transaction semantic invariants', () => {
  it('maps only ordinary categorized transaction types to a category family', () => {
    expect(categoryTypeForTransactionType('EXPENSE')).toBe('EXPENSE');
    expect(categoryTypeForTransactionType('INCOME')).toBe('INCOME');
    expect(categoryTypeForTransactionType('REFUND')).toBe('INCOME');
    expect(categoryTypeForTransactionType('REIMBURSEMENT')).toBe('INCOME');
    expect(categoryTypeForTransactionType('TRANSFER')).toBeUndefined();
    expect(categoryTypeForTransactionType('BORROW_IN')).toBeUndefined();
  });

  it('rejects an expense category attached to ordinary income', () => {
    expect(
      categoryAssignmentIssues(
        'INCOME',
        category('category-expense-food', 'EXPENSE'),
      ),
    ).toContain('CATEGORY_TYPE_MISMATCH');
  });

  it('accepts flat income categories and matching expense hierarchies', () => {
    const income = category('category-income-salary', 'INCOME');
    expect(categoryAssignmentIssues('INCOME', income)).toEqual([]);

    const expense = category('category-expense-food', 'EXPENSE');
    const lunch = category(
      'category-expense-food-lunch',
      'EXPENSE',
      expense.id,
    );
    expect(categoryAssignmentIssues('EXPENSE', expense, lunch)).toEqual([]);
  });

  it('rejects categories on transfers and mismatched parent-child pairs', () => {
    const food = category('category-expense-food', 'EXPENSE');
    const transport = category('category-expense-transport', 'EXPENSE');
    const lunch = category('category-expense-food-lunch', 'EXPENSE', food.id);

    expect(categoryAssignmentIssues('TRANSFER', food)).toContain(
      'CATEGORY_NOT_APPLICABLE',
    );
    expect(categoryAssignmentIssues('EXPENSE', transport, lunch)).toContain(
      'SUBCATEGORY_PARENT_MISMATCH',
    );
  });
});
