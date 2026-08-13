import type {
  Account,
  Category,
  ConfirmationStatus,
  Project,
  Tag,
  Transaction,
  TransactionSource,
} from '../entities';
import type { ParsedTransactionCandidate } from '../../classification/types';
import {
  categoryAssignmentIssueMessage,
  categoryAssignmentIssues,
} from './transactionSemantics';
import { reviewReasonCodes } from './reviewDisposition';

export type TextTransactionReferenceData = {
  categories: readonly Category[];
  accounts: readonly Account[];
  projects: readonly Project[];
  tags: readonly Tag[];
};

export type BuiltTextTransaction = {
  transaction: Transaction;
  tagIds: string[];
};

function bySystemKey(
  categories: readonly Category[],
  systemKey: string | undefined,
): Category | undefined {
  return systemKey === undefined
    ? undefined
    : categories.find(category => category.systemKey === systemKey);
}

function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export function buildTextTransaction(
  candidate: ParsedTransactionCandidate,
  references: TextTransactionReferenceData,
  id: string,
  nowIso: string,
  confirmationStatus: ConfirmationStatus,
  source: Extract<TransactionSource, 'TEXT' | 'VOICE'> = 'TEXT',
): BuiltTextTransaction {
  if (candidate.amountMinor === undefined || candidate.amountMinor <= 0) {
    throw new Error('请先补充有效金额后再保存。');
  }
  if (candidate.type === undefined) {
    throw new Error('请先选择交易类型后再保存。');
  }
  if (
    candidate.occurredAt === undefined ||
    Number.isNaN(new Date(candidate.occurredAt).getTime())
  ) {
    throw new Error('请先补充有效日期后再保存。');
  }

  const hintedCategory = references.categories.find(
    category => category.id === candidate.categoryIdHint,
  );
  const hintedSubcategory = references.categories.find(
    category => category.id === candidate.subcategoryIdHint,
  );
  const keyedCategory = bySystemKey(
    references.categories,
    candidate.categoryKey,
  );
  const keyedSubcategory = bySystemKey(
    references.categories,
    candidate.subcategoryKey,
  );
  const subcategory = hintedSubcategory ?? keyedSubcategory;
  const category =
    hintedCategory ??
    keyedCategory ??
    (subcategory?.parentId === undefined
      ? undefined
      : references.categories.find(item => item.id === subcategory.parentId));
  const categoryIssues = categoryAssignmentIssues(
    candidate.type,
    category,
    subcategory,
  );
  if (categoryIssues.length > 0) {
    throw new Error(
      `无法保存不一致的交易分类：${categoryIssues
        .map(categoryAssignmentIssueMessage)
        .join('、')}。`,
    );
  }
  const hintedAccount = references.accounts.find(
    account => account.id === candidate.accountIdHint,
  );
  const account =
    hintedAccount ??
    references.accounts.find(item => item.type === candidate.accountKey);
  const targetAccount = references.accounts.find(
    item => item.type === candidate.targetAccountKey,
  );
  const project = references.projects.find(
    item =>
      candidate.projectName !== undefined &&
      item.name.localeCompare(candidate.projectName, 'zh-CN', {
        sensitivity: 'accent',
      }) === 0,
  );
  const candidateTagNames = new Set(candidate.tags.map(name => name.trim()));
  const tagIds = references.tags
    .filter(tag => candidateTagNames.has(tag.name))
    .map(tag => tag.id);
  const reviewReasons = reviewReasonCodes(candidate);

  return {
    transaction: {
      id,
      revision: 1,
      type: candidate.type,
      amountMinor: candidate.amountMinor,
      currency: candidate.currency,
      occurredAt: candidate.occurredAt,
      categoryId: category?.id,
      subcategoryId: subcategory?.id,
      accountId: account?.id,
      targetAccountId: targetAccount?.id,
      merchantId: candidate.merchantIdHint,
      merchantRawName: trimmedOrUndefined(candidate.merchantRawName),
      projectId: project?.id,
      note: trimmedOrUndefined(candidate.note),
      source,
      originalText: trimmedOrUndefined(candidate.originalText),
      confidence: candidate.confidence,
      requiresReview: reviewReasons.length > 0,
      reviewReasonCodes: reviewReasons,
      confirmationStatus,
      duplicateStatus: 'NONE',
      createdAt: nowIso,
      updatedAt: nowIso,
      syncStatus: 'LOCAL_ONLY',
    },
    tagIds,
  };
}

export function confirmationIssues(transaction: Transaction): string[] {
  const issues: string[] = [];
  if (
    !Number.isSafeInteger(transaction.amountMinor) ||
    transaction.amountMinor <= 0
  ) {
    issues.push('金额');
  }
  if (Number.isNaN(new Date(transaction.occurredAt).getTime())) {
    issues.push('日期时间');
  }
  if (transaction.accountId === undefined) {
    issues.push('账户');
  }
  if (
    (transaction.type === 'EXPENSE' ||
      transaction.type === 'INCOME' ||
      transaction.type === 'REFUND' ||
      transaction.type === 'REIMBURSEMENT') &&
    transaction.categoryId === undefined
  ) {
    issues.push('分类');
  }
  if (transaction.type === 'TRANSFER') {
    if (transaction.targetAccountId === undefined) {
      issues.push('转入账户');
    } else if (transaction.targetAccountId === transaction.accountId) {
      issues.push('不同的转入账户');
    }
  }
  return issues;
}

export function canDirectlyConfirmTextTransaction(
  transaction: Transaction,
): boolean {
  return (
    confirmationIssues(transaction).length === 0 &&
    transaction.requiresReview !== true &&
    (transaction.reviewReasonCodes?.length ?? 0) === 0 &&
    (transaction.confidence ?? 0) >= 0.9
  );
}
