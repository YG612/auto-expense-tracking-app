import {
  CONFIRMATION_STATUSES,
  DUPLICATE_STATUSES,
  SYNC_STATUSES,
  TRANSACTION_REVIEW_REASON_CODES,
  TRANSACTION_SOURCES,
  TRANSACTION_TYPES,
  type Transaction,
} from '../../domain/entities';
import { AppError } from '../../domain/errors/AppError';
import {
  bookkeepingTextLength,
  MAX_BOOKKEEPING_TEXT_CHARACTERS,
} from '../../domain/policies/bookkeepingInputPolicy';
import { categoryTypeForTransactionType } from '../../domain/services/transactionSemantics';
import type { SqlExecutor, SqlRow } from '../types';
import { transactionDefinition } from './entityDefinitions';

const MAX_ID_LENGTH = 128;
const MAX_MERCHANT_LENGTH = 256;
const MAX_NOTE_LENGTH = 2_000;
const MAX_SOURCE_REFERENCE_LENGTH = 512;
const MAX_FINGERPRINT_LENGTH = 256;
const MAX_TAGS_PER_TRANSACTION = 50;

type CategoryReferenceRow = SqlRow & {
  id: string;
  type: 'EXPENSE' | 'INCOME';
  parent_id: string | null;
};

type AccountReferenceRow = SqlRow & {
  id: string;
  currency: string;
};

type PrivacySettingsRow = SqlRow & {
  retain_original_text: number;
};

export class LedgerValidationError extends AppError {
  constructor(readonly reason: string) {
    super(
      'LEDGER-WRITE-INVALID',
      '交易数据不完整或不一致，请检查金额、分类、账户和时间后重试。',
      {
        category: 'VALIDATION',
        retryable: true,
        cause: reason,
      },
    );
    this.name = 'LedgerValidationError';
  }
}

export class LedgerWriteConflictError extends AppError {
  constructor(reason = 'The transaction changed since it was loaded.') {
    super('LEDGER-WRITE-CONFLICT', '这笔记录已在其他页面更新，请刷新后重试。', {
      category: 'CONFLICT',
      retryable: true,
      cause: reason,
    });
    this.name = 'LedgerWriteConflictError';
  }
}

export interface ValidatedTransactionWrite {
  transaction: Transaction;
  tagIds: readonly string[];
}

function fail(message: string): never {
  throw new LedgerValidationError(message);
}

function requireBoundedIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_ID_LENGTH) {
    return fail(
      `${field} must contain between 1 and ${MAX_ID_LENGTH} characters.`,
    );
  }
  return normalized;
}

function optionalBoundedIdentifier(
  value: string | undefined,
  field: string,
): string | undefined {
  return value === undefined
    ? undefined
    : requireBoundedIdentifier(value, field);
}

function optionalBoundedText(
  value: string | undefined,
  field: string,
  maximumLength: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (bookkeepingTextLength(value) > maximumLength) {
    return fail(`${field} must not exceed ${maximumLength} characters.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized;
}

const STRICT_ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function canonicalUtcTimestamp(value: string, field: string): string {
  if (value.length > 64) {
    return fail(`${field} must be a valid timestamp.`);
  }
  const match = STRICT_ISO_TIMESTAMP.exec(value);
  if (match === null) {
    return fail(`${field} must be a valid timestamp.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0'));
  const zone = match[8]!;
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return fail(`${field} contains an impossible calendar date or time.`);
  }

  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMinutePart = Number(zone.slice(4, 6));
    if (
      offsetHours > 14 ||
      offsetMinutePart > 59 ||
      (offsetHours === 14 && offsetMinutePart !== 0)
    ) {
      return fail(`${field} contains an invalid UTC offset.`);
    }
    const sign = zone.startsWith('+') ? 1 : -1;
    offsetMinutes = sign * (offsetHours * 60 + offsetMinutePart);
  }

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millisecond);
  const utcMilliseconds = local.getTime() - offsetMinutes * 60_000;
  const roundTrip = new Date(utcMilliseconds + offsetMinutes * 60_000);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day ||
    roundTrip.getUTCHours() !== hour ||
    roundTrip.getUTCMinutes() !== minute ||
    roundTrip.getUTCSeconds() !== second ||
    roundTrip.getUTCMilliseconds() !== millisecond
  ) {
    return fail(`${field} cannot be represented without calendar rollover.`);
  }
  const canonical = new Date(utcMilliseconds).toISOString();
  if (!STRICT_ISO_TIMESTAMP.test(canonical)) {
    return fail(`${field} is outside the supported four-digit year range.`);
  }
  return canonical;
}

function enumContains<Value extends string>(
  values: readonly Value[],
  value: string,
): value is Value {
  return (values as readonly string[]).includes(value);
}

async function loadCategory(
  id: string,
  executor: SqlExecutor,
): Promise<CategoryReferenceRow> {
  const result = await executor.execute<CategoryReferenceRow>(
    'SELECT id, type, parent_id FROM categories WHERE id = ?',
    [id],
  );
  const category = result.rows[0];
  if (category === undefined) {
    return fail(`Category ${id} does not exist.`);
  }
  return category;
}

async function loadAccount(
  id: string,
  executor: SqlExecutor,
): Promise<AccountReferenceRow> {
  const result = await executor.execute<AccountReferenceRow>(
    'SELECT id, currency FROM accounts WHERE id = ?',
    [id],
  );
  const account = result.rows[0];
  if (account === undefined) {
    return fail(`Account ${id} does not exist.`);
  }
  return account;
}

async function assertReferenceExists(
  table: 'merchants' | 'projects' | 'transactions',
  id: string,
  executor: SqlExecutor,
): Promise<void> {
  const result = await executor.execute<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${table} WHERE id = ?`,
    [id],
  );
  if ((result.rows[0]?.count ?? 0) !== 1) {
    fail(`${table} reference ${id} does not exist.`);
  }
}

async function retainOriginalText(executor: SqlExecutor): Promise<boolean> {
  const result = await executor.execute<PrivacySettingsRow>(
    `SELECT retain_original_text
     FROM personalization_settings
     WHERE id = 1`,
  );
  const value = result.rows[0]?.retain_original_text;
  if (value !== 0 && value !== 1) {
    return fail('Personalization privacy settings are invalid or missing.');
  }
  return value === 1;
}

async function validateTagIds(
  tagIds: readonly string[],
  executor: SqlExecutor,
): Promise<readonly string[]> {
  const uniqueTagIds = [
    ...new Set(tagIds.map(tagId => requireBoundedIdentifier(tagId, 'tagId'))),
  ];
  if (uniqueTagIds.length > MAX_TAGS_PER_TRANSACTION) {
    return fail(
      `A transaction cannot contain more than ${MAX_TAGS_PER_TRANSACTION} tags.`,
    );
  }
  if (uniqueTagIds.length === 0) {
    return uniqueTagIds;
  }

  const placeholders = uniqueTagIds.map(() => '?').join(', ');
  const result = await executor.execute<{ id: string }>(
    `SELECT id FROM tags WHERE id IN (${placeholders})`,
    uniqueTagIds,
  );
  if (result.rows.length !== uniqueTagIds.length) {
    return fail('One or more transaction tags do not exist.');
  }
  return uniqueTagIds;
}

export async function validateTransactionForWrite(
  candidate: Transaction,
  tagIds: readonly string[],
  executor: SqlExecutor,
): Promise<ValidatedTransactionWrite> {
  const id = requireBoundedIdentifier(candidate.id, 'id');
  if (!Number.isSafeInteger(candidate.revision) || candidate.revision < 1) {
    fail('revision must be a positive safe integer.');
  }
  if (!enumContains(TRANSACTION_TYPES, candidate.type)) {
    fail(`Unsupported transaction type: ${String(candidate.type)}.`);
  }
  if (
    !Number.isSafeInteger(candidate.amountMinor) ||
    candidate.amountMinor <= 0
  ) {
    fail('amountMinor must be a positive safe integer.');
  }

  const currency = candidate.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) {
    fail('currency must be a three-letter ISO currency code.');
  }
  if (!enumContains(TRANSACTION_SOURCES, candidate.source)) {
    fail(`Unsupported transaction source: ${String(candidate.source)}.`);
  }
  if (!enumContains(CONFIRMATION_STATUSES, candidate.confirmationStatus)) {
    fail(
      `Unsupported confirmation status: ${String(candidate.confirmationStatus)}.`,
    );
  }
  if (!enumContains(DUPLICATE_STATUSES, candidate.duplicateStatus)) {
    fail(`Unsupported duplicate status: ${String(candidate.duplicateStatus)}.`);
  }
  if (!enumContains(SYNC_STATUSES, candidate.syncStatus)) {
    fail(`Unsupported sync status: ${String(candidate.syncStatus)}.`);
  }
  if (
    candidate.confidence !== undefined &&
    (!Number.isFinite(candidate.confidence) ||
      candidate.confidence < 0 ||
      candidate.confidence > 1)
  ) {
    fail('confidence must be between 0 and 1.');
  }

  const requiresReview = candidate.requiresReview ?? false;
  const rawReviewReasonCodes = candidate.reviewReasonCodes ?? [];
  if (typeof requiresReview !== 'boolean') {
    fail('requiresReview must be a boolean.');
  }
  if (
    !Array.isArray(rawReviewReasonCodes) ||
    !rawReviewReasonCodes.every(code =>
      (TRANSACTION_REVIEW_REASON_CODES as readonly string[]).includes(code),
    )
  ) {
    fail('reviewReasonCodes contains an unsupported value.');
  }
  const reviewReasonCodes = [...new Set(rawReviewReasonCodes)];
  if (reviewReasonCodes.length !== rawReviewReasonCodes.length) {
    fail('reviewReasonCodes must not contain duplicates.');
  }
  if (requiresReview !== reviewReasonCodes.length > 0) {
    fail('requiresReview and reviewReasonCodes must describe the same state.');
  }
  if (candidate.confirmationStatus === 'CONFIRMED' && requiresReview) {
    fail('A transaction that requires review cannot be confirmed.');
  }

  const occurredAt = canonicalUtcTimestamp(candidate.occurredAt, 'occurredAt');
  const createdAt = canonicalUtcTimestamp(candidate.createdAt, 'createdAt');
  const updatedAt = canonicalUtcTimestamp(candidate.updatedAt, 'updatedAt');
  const deletedAt =
    candidate.deletedAt === undefined
      ? undefined
      : canonicalUtcTimestamp(candidate.deletedAt, 'deletedAt');
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    fail('updatedAt cannot be earlier than createdAt.');
  }
  if (
    deletedAt !== undefined &&
    Date.parse(deletedAt) < Date.parse(createdAt)
  ) {
    fail('deletedAt cannot be earlier than createdAt.');
  }

  const categoryId = optionalBoundedIdentifier(
    candidate.categoryId,
    'categoryId',
  );
  const subcategoryId = optionalBoundedIdentifier(
    candidate.subcategoryId,
    'subcategoryId',
  );
  const accountId = optionalBoundedIdentifier(candidate.accountId, 'accountId');
  const targetAccountId = optionalBoundedIdentifier(
    candidate.targetAccountId,
    'targetAccountId',
  );
  const merchantId = optionalBoundedIdentifier(
    candidate.merchantId,
    'merchantId',
  );
  const projectId = optionalBoundedIdentifier(candidate.projectId, 'projectId');
  const relatedTransactionId = optionalBoundedIdentifier(
    candidate.relatedTransactionId,
    'relatedTransactionId',
  );
  const requiredCategoryType = categoryTypeForTransactionType(candidate.type);

  if (requiredCategoryType === undefined) {
    if (categoryId !== undefined || subcategoryId !== undefined) {
      fail('This transaction type cannot use an income or expense category.');
    }
  } else if (
    candidate.confirmationStatus === 'CONFIRMED' &&
    candidate.type === 'EXPENSE' &&
    categoryId === undefined
  ) {
    fail('Confirmed expense transactions require a primary category.');
  }

  let category: CategoryReferenceRow | undefined;
  if (categoryId !== undefined) {
    category = await loadCategory(categoryId, executor);
    if (category.type !== requiredCategoryType) {
      fail('The transaction type and category direction do not match.');
    }
    if (category.parent_id !== null) {
      fail('categoryId must refer to a root category.');
    }
  }

  if (subcategoryId !== undefined) {
    if (category === undefined) {
      fail('A subcategory requires its root category.');
    }
    const subcategory = await loadCategory(subcategoryId, executor);
    if (subcategory.type !== requiredCategoryType) {
      fail('The transaction type and subcategory direction do not match.');
    }
    if (subcategory.parent_id !== category.id) {
      fail('The subcategory does not belong to the selected root category.');
    }
  }

  let account: AccountReferenceRow | undefined;
  if (accountId !== undefined) {
    account = await loadAccount(accountId, executor);
    if (account.currency !== currency) {
      fail('The transaction and account currencies do not match.');
    }
  } else if (candidate.confirmationStatus === 'CONFIRMED') {
    fail('A confirmed transaction requires an account.');
  }

  if (candidate.type === 'TRANSFER') {
    if (
      candidate.confirmationStatus === 'CONFIRMED' &&
      targetAccountId === undefined
    ) {
      fail('A confirmed transfer requires a target account.');
    }
    if (targetAccountId !== undefined) {
      if (targetAccountId === account?.id) {
        fail('Transfer source and target accounts must be different.');
      }
      const targetAccount = await loadAccount(targetAccountId, executor);
      if (targetAccount.currency !== currency) {
        fail('The transfer target account currency does not match.');
      }
    }
  } else if (targetAccountId !== undefined) {
    fail('Only transfers can contain a target account.');
  }

  if (merchantId !== undefined) {
    await assertReferenceExists('merchants', merchantId, executor);
  }
  if (projectId !== undefined) {
    await assertReferenceExists('projects', projectId, executor);
  }
  if (relatedTransactionId !== undefined) {
    if (relatedTransactionId === id) {
      fail('A transaction cannot reference itself.');
    }
    await assertReferenceExists('transactions', relatedTransactionId, executor);
  }

  const keepOriginalText = await retainOriginalText(executor);
  const validatedTagIds = await validateTagIds(tagIds, executor);
  return {
    transaction: {
      ...candidate,
      id,
      currency,
      occurredAt,
      categoryId,
      subcategoryId,
      accountId,
      targetAccountId,
      merchantId,
      merchantRawName: optionalBoundedText(
        candidate.merchantRawName,
        'merchantRawName',
        MAX_MERCHANT_LENGTH,
      ),
      projectId,
      note: optionalBoundedText(candidate.note, 'note', MAX_NOTE_LENGTH),
      sourceReferenceId: optionalBoundedText(
        candidate.sourceReferenceId,
        'sourceReferenceId',
        MAX_SOURCE_REFERENCE_LENGTH,
      ),
      originalText: keepOriginalText
        ? optionalBoundedText(
            candidate.originalText,
            'originalText',
            MAX_BOOKKEEPING_TEXT_CHARACTERS,
          )
        : undefined,
      requiresReview,
      reviewReasonCodes,
      relatedTransactionId,
      fingerprint: optionalBoundedText(
        candidate.fingerprint,
        'fingerprint',
        MAX_FINGERPRINT_LENGTH,
      ),
      createdAt,
      updatedAt,
      deletedAt,
    },
    tagIds: validatedTagIds,
  };
}

async function readTransaction(
  id: string,
  executor: SqlExecutor,
): Promise<Transaction | undefined> {
  const result = await executor.execute(
    `SELECT ${transactionDefinition.columns.join(', ')}
     FROM transactions
     WHERE id = ?`,
    [id],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : transactionDefinition.fromRow(row);
}

async function replaceTransactionTags(
  transactionId: string,
  tagIds: readonly string[],
  executor: SqlExecutor,
): Promise<void> {
  await executor.execute(
    'DELETE FROM transaction_tags WHERE transaction_id = ?',
    [transactionId],
  );
  for (const tagId of tagIds) {
    await executor.execute(
      `INSERT INTO transaction_tags (transaction_id, tag_id)
       VALUES (?, ?)`,
      [transactionId, tagId],
    );
  }
}

async function insertNewTransactionWithTags(
  executor: SqlExecutor,
  candidate: Transaction,
  tagIds: readonly string[],
): Promise<Transaction> {
  if (candidate.revision !== 1) {
    throw new LedgerWriteConflictError(
      'A new transaction must start at revision 1.',
    );
  }
  if (candidate.deletedAt !== undefined) {
    fail('A new transaction cannot start in the recycle bin.');
  }

  const validated = await validateTransactionForWrite(
    candidate,
    tagIds,
    executor,
  );
  const values = transactionDefinition.toValues(validated.transaction);
  const columns = transactionDefinition.columns;
  const insert = await executor.execute(
    `INSERT INTO transactions (${columns.join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})
     ON CONFLICT(id) DO NOTHING`,
    columns.map(column => values[column]),
  );
  if (insert.rowsAffected !== 1) {
    throw new LedgerWriteConflictError(
      'A transaction with this id was created concurrently.',
    );
  }
  await replaceTransactionTags(candidate.id, validated.tagIds, executor);
  return validated.transaction;
}

export async function createValidatedTransactionWithTags(
  executor: SqlExecutor,
  candidate: Transaction,
  tagIds: readonly string[],
): Promise<Transaction> {
  if ((await readTransaction(candidate.id, executor)) !== undefined) {
    throw new LedgerWriteConflictError(
      'A transaction with this id already exists; create never overwrites.',
    );
  }
  return insertNewTransactionWithTags(executor, candidate, tagIds);
}

export async function saveValidatedTransactionWithTags(
  executor: SqlExecutor,
  candidate: Transaction,
  tagIds: readonly string[],
): Promise<Transaction> {
  const existing = await readTransaction(candidate.id, executor);
  if (existing === undefined) {
    return insertNewTransactionWithTags(executor, candidate, tagIds);
  }

  if (existing.deletedAt !== undefined) {
    throw new LedgerWriteConflictError(
      'A deleted transaction cannot be revived by an old edit screen.',
    );
  }
  if (candidate.revision !== existing.revision) {
    throw new LedgerWriteConflictError();
  }
  if (candidate.deletedAt !== undefined) {
    fail('Use the explicit recycle-bin operation to delete a transaction.');
  }
  if (
    canonicalUtcTimestamp(candidate.createdAt, 'createdAt') !==
      canonicalUtcTimestamp(existing.createdAt, 'stored createdAt') ||
    candidate.source !== existing.source ||
    (candidate.sourceReferenceId?.trim() || undefined) !==
      (existing.sourceReferenceId?.trim() || undefined)
  ) {
    fail('createdAt, source, and sourceReferenceId are immutable.');
  }

  const validated = await validateTransactionForWrite(
    candidate,
    tagIds,
    executor,
  );
  if (
    Date.parse(validated.transaction.updatedAt) < Date.parse(existing.updatedAt)
  ) {
    fail('updatedAt cannot move backwards.');
  }

  const next: Transaction = {
    ...validated.transaction,
    revision: existing.revision + 1,
    createdAt: existing.createdAt,
    source: existing.source,
    sourceReferenceId: existing.sourceReferenceId,
  };
  const values = transactionDefinition.toValues(next);
  const mutableColumns = transactionDefinition.columns.filter(
    column =>
      ![
        'id',
        'revision',
        'created_at',
        'deleted_at',
        'source',
        'source_reference_id',
      ].includes(column),
  );
  const result = await executor.execute(
    `UPDATE transactions
     SET ${mutableColumns.map(column => `${column} = ?`).join(', ')},
         revision = revision + 1
     WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
    [
      ...mutableColumns.map(column => values[column]),
      existing.id,
      existing.revision,
    ],
  );
  if (result.rowsAffected !== 1) {
    throw new LedgerWriteConflictError();
  }

  await replaceTransactionTags(existing.id, validated.tagIds, executor);
  return next;
}
