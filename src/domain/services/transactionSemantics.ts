import type { Category, CategoryType, TransactionType } from '../entities';

export type CategoryAssignmentIssue =
  | 'CATEGORY_NOT_APPLICABLE'
  | 'CATEGORY_TYPE_MISMATCH'
  | 'SUBCATEGORY_TYPE_MISMATCH'
  | 'CATEGORY_MUST_BE_ROOT'
  | 'SUBCATEGORY_MUST_HAVE_PARENT'
  | 'SUBCATEGORY_PARENT_MISMATCH';

/**
 * Returns the category family required by a transaction type.
 * Cash-flow direction alone is deliberately not used here: transfers and
 * lending/repayment records are not ordinary income or expense categories.
 */
export function categoryTypeForTransactionType(
  type: TransactionType | undefined,
): CategoryType | undefined {
  if (type === 'EXPENSE') {
    return 'EXPENSE';
  }

  if (type === 'INCOME' || type === 'REFUND' || type === 'REIMBURSEMENT') {
    return 'INCOME';
  }

  return undefined;
}

export function categoryAssignmentIssues(
  type: TransactionType,
  category: Category | undefined,
  subcategory?: Category,
): CategoryAssignmentIssue[] {
  const issues: CategoryAssignmentIssue[] = [];
  const requiredType = categoryTypeForTransactionType(type);

  if (requiredType === undefined) {
    if (category !== undefined || subcategory !== undefined) {
      issues.push('CATEGORY_NOT_APPLICABLE');
    }
    return issues;
  }

  if (category !== undefined) {
    if (category.type !== requiredType) {
      issues.push('CATEGORY_TYPE_MISMATCH');
    }
    if (category.parentId !== undefined) {
      issues.push('CATEGORY_MUST_BE_ROOT');
    }
  }

  if (subcategory !== undefined) {
    if (subcategory.type !== requiredType) {
      issues.push('SUBCATEGORY_TYPE_MISMATCH');
    }
    if (subcategory.parentId === undefined) {
      issues.push('SUBCATEGORY_MUST_HAVE_PARENT');
    } else if (category !== undefined && subcategory.parentId !== category.id) {
      issues.push('SUBCATEGORY_PARENT_MISMATCH');
    }
  }

  return issues;
}

export function categoryAssignmentIssueMessage(
  issue: CategoryAssignmentIssue,
): string {
  switch (issue) {
    case 'CATEGORY_NOT_APPLICABLE':
      return '该交易类型不应设置普通收支分类';
    case 'CATEGORY_TYPE_MISMATCH':
    case 'SUBCATEGORY_TYPE_MISMATCH':
      return '交易类型与分类方向不一致';
    case 'CATEGORY_MUST_BE_ROOT':
      return '一级分类不能使用二级分类';
    case 'SUBCATEGORY_MUST_HAVE_PARENT':
      return '二级分类必须隶属于一级分类';
    case 'SUBCATEGORY_PARENT_MISMATCH':
      return '一级分类与二级分类不匹配';
  }
}
