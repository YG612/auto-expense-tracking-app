import type {
  CategoryType,
  SyncStatus,
  Transaction,
  TransactionType,
} from '../entities';

export type TransactionTypeOption = {
  value: TransactionType;
  label: string;
  categoryType?: CategoryType;
  requiresTargetAccount?: boolean;
};

export const TRANSACTION_TYPE_OPTIONS: readonly TransactionTypeOption[] = [
  { value: 'EXPENSE', label: '支出', categoryType: 'EXPENSE' },
  { value: 'INCOME', label: '收入' },
  {
    value: 'TRANSFER',
    label: '转账',
    requiresTargetAccount: true,
  },
  { value: 'REFUND', label: '退款', categoryType: 'INCOME' },
  { value: 'BORROW_IN', label: '借入' },
  { value: 'LEND_OUT', label: '借出' },
  { value: 'REPAYMENT_IN', label: '收到还款' },
  { value: 'REPAYMENT_OUT', label: '支付还款' },
  {
    value: 'REIMBURSEMENT',
    label: '报销回款',
    categoryType: 'INCOME',
  },
  { value: 'ADJUSTMENT', label: '余额调整' },
] as const;

export type ManualTransactionDraft = {
  type: TransactionType;
  amountText: string;
  occurredAt: Date;
  categoryId?: string;
  subcategoryId?: string;
  accountId?: string;
  targetAccountId?: string;
  merchantName: string;
  projectId?: string;
  tagIds: readonly string[];
  note: string;
};

export type ManualTransactionValidation =
  | { ok: true; amountMinor: number }
  | { ok: false; field: keyof ManualTransactionDraft; message: string };

const FULL_WIDTH_DIGITS = '０１２３４５６７８９';

function normalizeAmountText(value: string): string {
  return value
    .trim()
    .replace(/[０-９]/gu, digit => String(FULL_WIDTH_DIGITS.indexOf(digit)))
    .replace('．', '.');
}

export function parseAmountToMinor(value: string): number | undefined {
  const normalized = normalizeAmountText(value);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(normalized);

  if (match === null) {
    return undefined;
  }

  const yuan = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const amountMinor = yuan * 100 + Number(fraction);

  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return undefined;
  }

  return amountMinor;
}

export function getTransactionTypeOption(
  type: TransactionType,
): TransactionTypeOption {
  const option = TRANSACTION_TYPE_OPTIONS.find(item => item.value === type);

  if (option === undefined) {
    throw new Error(`Unsupported transaction type: ${type}`);
  }

  return option;
}

export function validateManualTransaction(
  draft: ManualTransactionDraft,
): ManualTransactionValidation {
  const amountMinor = parseAmountToMinor(draft.amountText);

  if (amountMinor === undefined) {
    return {
      ok: false,
      field: 'amountText',
      message: '请输入大于 0 且最多两位小数的金额。',
    };
  }

  if (Number.isNaN(draft.occurredAt.getTime())) {
    return { ok: false, field: 'occurredAt', message: '请选择有效时间。' };
  }

  const option = getTransactionTypeOption(draft.type);

  if (option.categoryType !== undefined && draft.categoryId === undefined) {
    return { ok: false, field: 'categoryId', message: '请选择分类。' };
  }

  if (draft.accountId === undefined) {
    return { ok: false, field: 'accountId', message: '请选择账户。' };
  }

  if (option.requiresTargetAccount && draft.targetAccountId === undefined) {
    return {
      ok: false,
      field: 'targetAccountId',
      message: '请选择转入账户。',
    };
  }

  if (
    option.requiresTargetAccount &&
    draft.targetAccountId === draft.accountId
  ) {
    return {
      ok: false,
      field: 'targetAccountId',
      message: '转入账户不能与转出账户相同。',
    };
  }

  return { ok: true, amountMinor };
}

function nextSyncStatus(existing?: Transaction): SyncStatus {
  if (existing === undefined || existing.syncStatus === 'LOCAL_ONLY') {
    return 'LOCAL_ONLY';
  }

  return 'PENDING';
}

function trimmedOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function buildManualTransaction(
  draft: ManualTransactionDraft,
  amountMinor: number,
  id: string,
  nowIso: string,
  existing?: Transaction,
): Transaction {
  const storesCategory = draft.type !== 'INCOME';

  return {
    id,
    revision: existing?.revision ?? 1,
    type: draft.type,
    amountMinor,
    currency: existing?.currency ?? 'CNY',
    occurredAt: draft.occurredAt.toISOString(),
    categoryId: storesCategory ? draft.categoryId : undefined,
    subcategoryId: storesCategory ? draft.subcategoryId : undefined,
    accountId: draft.accountId,
    targetAccountId: draft.targetAccountId,
    merchantId: existing?.merchantId,
    merchantRawName: trimmedOrUndefined(draft.merchantName),
    projectId: draft.projectId,
    note: trimmedOrUndefined(draft.note),
    source: existing?.source ?? 'MANUAL',
    sourceReferenceId: existing?.sourceReferenceId,
    originalText: existing?.originalText,
    confidence: existing?.confidence,
    requiresReview: false,
    reviewReasonCodes: [],
    confirmationStatus: 'CONFIRMED',
    duplicateStatus: existing?.duplicateStatus ?? 'NONE',
    relatedTransactionId: existing?.relatedTransactionId,
    fingerprint: existing?.fingerprint,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
    deletedAt: existing?.deletedAt,
    syncStatus: nextSyncStatus(existing),
  };
}

export function amountTextFromMinor(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

export function formatAmountMinor(amountMinor: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export function formatLocalDateTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
