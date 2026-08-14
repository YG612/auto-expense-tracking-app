import type {
  ConfirmationStatus,
  DuplicateStatus,
  Transaction,
  TransactionReviewReasonCode,
  TransactionType,
} from '../../domain/entities';
import { categoryTypeForTransactionType } from '../../domain/services/transactionSemantics';
import type {
  DatabaseConnection,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from '../types';
import { BaseRepository } from './BaseRepository';
import { transactionDefinition } from './entityDefinitions';
import { optionalString } from './mappingHelpers';
import {
  recognizedPayloadHash,
  reconcileRecognizedOperationInTransaction,
  saveRecognizedOperationInTransaction,
  type RecognizedOperationOutcome,
} from './recognizedOperationReceipt';
import {
  canonicalUtcTimestamp,
  createValidatedTransactionWithTags,
  LedgerValidationError,
  LedgerWriteConflictError,
  saveValidatedTransactionWithTags,
} from './transactionWriteIntegrity';

export type TransactionListOptions = {
  includeDeleted?: boolean;
  confirmationStatus?: ConfirmationStatus;
  limit?: number;
};

export const MAX_TRANSACTION_SEARCH_LENGTH = 120;

export type TransactionSummary = Transaction & {
  categoryName?: string;
  categoryIcon?: string;
  categoryType?: 'EXPENSE' | 'INCOME';
  subcategoryName?: string;
  accountName?: string;
  targetAccountName?: string;
  projectName?: string;
  merchantName?: string;
  relatedCategoryId?: string;
  relatedCategoryName?: string;
  relatedCategoryIcon?: string;
  tagNames: string[];
};

export type TransactionSearchOptions = {
  deletedOnly?: boolean;
  occurredFrom?: string;
  occurredBefore?: string;
  query?: string;
  type?: TransactionType;
  categoryId?: string;
  accountId?: string;
  projectId?: string;
  tagId?: string;
  confirmationStatus?: ConfirmationStatus;
  duplicateStatus?: DuplicateStatus;
  limit?: number;
};

export type TransactionRevisionReference = Pick<Transaction, 'id' | 'revision'>;

export type TransactionMutationResult =
  | { status: 'APPLIED'; transaction: Transaction }
  | { status: 'CONFLICT' }
  | { status: 'INVALID_STATE' }
  | { status: 'NOT_FOUND' };

export interface ConfirmPendingBatchResult {
  confirmedIds: readonly string[];
  conflictedIds: readonly string[];
  invalidStateIds: readonly string[];
  missingIds: readonly string[];
}

export interface PendingBatchMutationResult {
  appliedIds: readonly string[];
  conflictedIds: readonly string[];
  invalidStateIds: readonly string[];
  missingIds: readonly string[];
}

export type PendingReviewAssignment = {
  categoryId?: string;
  accountId?: string;
};

type TransactionSummaryRow = SqlRow & {
  category_name: string | null;
  category_icon: string | null;
  category_type: string | null;
  subcategory_name: string | null;
  account_name: string | null;
  target_account_name: string | null;
  project_name: string | null;
  merchant_name: string | null;
  related_category_id: string | null;
  related_category_name: string | null;
  related_category_icon: string | null;
  tag_names: string | null;
};

function summaryFromRow(row: TransactionSummaryRow): TransactionSummary {
  const tagNames = optionalString(row, 'tag_names');

  return {
    ...transactionDefinition.fromRow(row),
    categoryName: optionalString(row, 'category_name'),
    categoryIcon: optionalString(row, 'category_icon'),
    categoryType: optionalString(row, 'category_type') as
      'EXPENSE' | 'INCOME' | undefined,
    subcategoryName: optionalString(row, 'subcategory_name'),
    accountName: optionalString(row, 'account_name'),
    targetAccountName: optionalString(row, 'target_account_name'),
    projectName: optionalString(row, 'project_name'),
    merchantName: optionalString(row, 'merchant_name'),
    relatedCategoryId: optionalString(row, 'related_category_id'),
    relatedCategoryName: optionalString(row, 'related_category_name'),
    relatedCategoryIcon: optionalString(row, 'related_category_icon'),
    tagNames: tagNames === undefined ? [] : tagNames.split('\u001F'),
  };
}

export class TransactionRepository extends BaseRepository<Transaction> {
  constructor(database: DatabaseConnection) {
    super(database, transactionDefinition);
  }

  async findById(
    id: string,
    options: Pick<TransactionListOptions, 'includeDeleted'> = {},
  ): Promise<Transaction | undefined> {
    const where = options.includeDeleted
      ? 'id = ?'
      : 'id = ? AND deleted_at IS NULL';
    const rows = await this.select(where, [id], '', 1);
    return rows[0];
  }

  async list(options: TransactionListOptions = {}): Promise<Transaction[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];

    if (!options.includeDeleted) {
      clauses.push('deleted_at IS NULL');
    }

    if (options.confirmationStatus !== undefined) {
      clauses.push('confirmation_status = ?');
      params.push(options.confirmationStatus);
    }

    return this.select(
      clauses.length === 0 ? undefined : clauses.join(' AND '),
      params,
      this.definition.defaultOrderBy,
      options.limit,
    );
  }

  async listAll(): Promise<Transaction[]> {
    return this.list();
  }

  override async create(transaction: Transaction): Promise<void> {
    await this.database.transaction(async executor => {
      await createValidatedTransactionWithTags(executor, transaction, []);
    });
  }

  override async update(transaction: Transaction): Promise<boolean> {
    const existing = await this.findById(transaction.id, {
      includeDeleted: true,
    });
    if (existing === undefined) {
      return false;
    }
    const tags = await this.database.execute<{ tag_id: string }>(
      `SELECT tag_id
       FROM transaction_tags
       WHERE transaction_id = ?
       ORDER BY tag_id ASC`,
      [transaction.id],
    );
    await this.saveWithTags(
      transaction,
      tags.rows.map(row => row.tag_id),
    );
    return true;
  }

  async saveWithTags(
    transactionEntity: Transaction,
    tagIds: readonly string[],
  ): Promise<Transaction> {
    return this.database.transaction(transaction =>
      saveValidatedTransactionWithTags(transaction, transactionEntity, tagIds),
    );
  }

  async findBySourceReference(
    source: Transaction['source'],
    sourceReferenceId: string,
    options: Pick<TransactionListOptions, 'includeDeleted'> = {},
  ): Promise<Transaction | undefined> {
    const rows = await this.select(
      `source = ? AND source_reference_id = ?${
        options.includeDeleted ? '' : ' AND deleted_at IS NULL'
      }`,
      [source, sourceReferenceId],
      '',
      1,
    );
    return rows[0];
  }

  async saveRecognizedWithTags(
    transactionEntity: Transaction,
    tagIds: readonly string[],
  ): Promise<RecognizedOperationOutcome> {
    return this.database.transaction(executor =>
      saveRecognizedOperationInTransaction(executor, transactionEntity, tagIds),
    );
  }

  async reconcileRecognizedOperation(
    transactionEntity: Transaction,
    tagIds: readonly string[],
  ): Promise<RecognizedOperationOutcome | undefined> {
    if (transactionEntity.source !== 'VOICE') {
      throw new Error(
        'Only VOICE operations have durable recognition receipts.',
      );
    }
    const sourceReferenceId = transactionEntity.sourceReferenceId?.trim();
    if (sourceReferenceId === undefined || sourceReferenceId.length === 0) {
      throw new Error('VOICE transaction requires a stable sourceReferenceId.');
    }
    const payloadHash = recognizedPayloadHash(transactionEntity, tagIds);
    return this.database.transaction(executor =>
      reconcileRecognizedOperationInTransaction(
        executor,
        sourceReferenceId,
        payloadHash,
      ),
    );
  }

  async listSummaries(
    options: TransactionSearchOptions = {},
  ): Promise<TransactionSummary[]> {
    const clauses: string[] = [
      options.deletedOnly ? 't.deleted_at IS NOT NULL' : 't.deleted_at IS NULL',
    ];
    const params: SqlValue[] = [];

    if (options.occurredFrom !== undefined) {
      clauses.push('t.occurred_at >= ?');
      params.push(options.occurredFrom);
    }

    if (options.occurredBefore !== undefined) {
      clauses.push('t.occurred_at < ?');
      params.push(options.occurredBefore);
    }

    if (options.type !== undefined) {
      clauses.push('t.type = ?');
      params.push(options.type);
    }

    if (options.categoryId !== undefined) {
      clauses.push(`(
        t.category_id = ? OR
        t.subcategory_id = ? OR
        related_transaction.category_id = ? OR
        related_transaction.subcategory_id = ?
      )`);
      params.push(
        options.categoryId,
        options.categoryId,
        options.categoryId,
        options.categoryId,
      );
    }

    if (options.accountId !== undefined) {
      clauses.push('(t.account_id = ? OR t.target_account_id = ?)');
      params.push(options.accountId, options.accountId);
    }

    if (options.projectId !== undefined) {
      clauses.push('t.project_id = ?');
      params.push(options.projectId);
    }

    if (options.tagId !== undefined) {
      clauses.push(
        `EXISTS (
          SELECT 1 FROM transaction_tags selected_tag
          WHERE selected_tag.transaction_id = t.id
            AND selected_tag.tag_id = ?
        )`,
      );
      params.push(options.tagId);
    }

    if (options.confirmationStatus !== undefined) {
      clauses.push('t.confirmation_status = ?');
      params.push(options.confirmationStatus);
    }

    if (options.duplicateStatus !== undefined) {
      clauses.push('t.duplicate_status = ?');
      params.push(options.duplicateStatus);
    }

    const query = options.query?.trim();
    if (query !== undefined && query.length > 0) {
      if ([...query].length > MAX_TRANSACTION_SEARCH_LENGTH) {
        throw new LedgerValidationError(
          `Transaction search query must not exceed ${MAX_TRANSACTION_SEARCH_LENGTH} characters.`,
        );
      }
      clauses.push(`(
        t.note LIKE ? OR
        t.merchant_raw_name LIKE ? OR
        category.name LIKE ? OR
        subcategory.name LIKE ? OR
        account.name LIKE ? OR
        project.name LIKE ? OR
        tags.name LIKE ?
      )`);
      const pattern = `%${query}%`;
      params.push(
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
      );
    }

    const limit =
      options.limit === undefined
        ? undefined
        : Math.max(0, Math.trunc(options.limit));
    if (limit !== undefined) {
      params.push(limit);
    }

    const result = await this.database.execute<TransactionSummaryRow>(
      `SELECT
          ${transactionDefinition.columns.map(column => `t.${column}`).join(', ')},
          category.name AS category_name,
          category.icon AS category_icon,
          category.type AS category_type,
          subcategory.name AS subcategory_name,
          account.name AS account_name,
          target_account.name AS target_account_name,
          project.name AS project_name,
          COALESCE(t.merchant_raw_name, merchant.canonical_name) AS merchant_name,
          related_transaction.category_id AS related_category_id,
          related_category.name AS related_category_name,
          related_category.icon AS related_category_icon,
          GROUP_CONCAT(tags.name, char(31)) AS tag_names
        FROM transactions t
        LEFT JOIN categories category ON category.id = t.category_id
        LEFT JOIN categories subcategory ON subcategory.id = t.subcategory_id
        LEFT JOIN accounts account ON account.id = t.account_id
        LEFT JOIN accounts target_account ON target_account.id = t.target_account_id
        LEFT JOIN projects project ON project.id = t.project_id
        LEFT JOIN merchants merchant ON merchant.id = t.merchant_id
        LEFT JOIN transactions related_transaction
          ON related_transaction.id = t.related_transaction_id
        LEFT JOIN categories related_category
          ON related_category.id = related_transaction.category_id
        LEFT JOIN transaction_tags tt ON tt.transaction_id = t.id
        LEFT JOIN tags ON tags.id = tt.tag_id
        WHERE ${clauses.join(' AND ')}
        GROUP BY t.id
        ORDER BY t.occurred_at DESC, t.created_at DESC
      ${limit === undefined ? '' : 'LIMIT ?'}`,
      params,
    );

    return result.rows.map(row => summaryFromRow(row));
  }

  async countPending(): Promise<number> {
    const result = await this.database.execute<{ pending_count: number }>(
      `SELECT COUNT(*) AS pending_count
         FROM transactions
         WHERE deleted_at IS NULL
           AND confirmation_status = 'PENDING'
           AND duplicate_status != 'MERGED'`,
    );

    return result.rows[0]?.pending_count ?? 0;
  }

  async confirmPending(
    reference: TransactionRevisionReference,
    updatedAt: string,
  ): Promise<TransactionMutationResult> {
    return this.database.transaction(executor =>
      this.confirmPendingInTransaction(reference, updatedAt, executor),
    );
  }

  async confirmPendingBatch(
    references: readonly TransactionRevisionReference[],
    updatedAt: string,
  ): Promise<ConfirmPendingBatchResult> {
    const uniqueReferences = [
      ...new Map(
        references.map(reference => [reference.id, reference]),
      ).values(),
    ];
    return this.database.transaction(async executor => {
      const confirmedIds: string[] = [];
      const conflictedIds: string[] = [];
      const invalidStateIds: string[] = [];
      const missingIds: string[] = [];

      for (const reference of uniqueReferences) {
        const result = await this.confirmPendingInTransaction(
          reference,
          updatedAt,
          executor,
        );
        if (result.status === 'APPLIED') {
          confirmedIds.push(reference.id);
        } else if (result.status === 'CONFLICT') {
          conflictedIds.push(reference.id);
        } else if (result.status === 'INVALID_STATE') {
          invalidStateIds.push(reference.id);
        } else {
          missingIds.push(reference.id);
        }
      }

      return {
        confirmedIds,
        conflictedIds,
        invalidStateIds,
        missingIds,
      };
    });
  }

  async reviewPendingBatch(
    references: readonly TransactionRevisionReference[],
    assignment: PendingReviewAssignment,
    updatedAt: string,
  ): Promise<PendingBatchMutationResult> {
    if (
      assignment.categoryId === undefined &&
      assignment.accountId === undefined
    ) {
      throw new LedgerValidationError(
        'A category or account assignment is required.',
      );
    }
    const uniqueReferences = [
      ...new Map(
        references.map(reference => [reference.id, reference]),
      ).values(),
    ];
    const canonicalUpdatedAt = canonicalUtcTimestamp(updatedAt, 'updatedAt');

    return this.database.transaction(async executor => {
      const category =
        assignment.categoryId === undefined
          ? undefined
          : (
              await executor.execute<{
                id: string;
                parent_id: string | null;
                type: string;
              }>(
                `SELECT id, parent_id, type
                   FROM categories
                  WHERE id = ? AND is_hidden = 0`,
                [assignment.categoryId],
              )
            ).rows[0];
      if (assignment.categoryId !== undefined && category === undefined) {
        throw new LedgerValidationError('Selected category is unavailable.');
      }
      if (assignment.accountId !== undefined) {
        const account = await executor.execute(
          'SELECT id FROM accounts WHERE id = ? AND is_hidden = 0',
          [assignment.accountId],
        );
        if (account.rows[0] === undefined) {
          throw new LedgerValidationError('Selected account is unavailable.');
        }
      }

      const appliedIds: string[] = [];
      const conflictedIds: string[] = [];
      const invalidStateIds: string[] = [];
      const missingIds: string[] = [];

      for (const reference of uniqueReferences) {
        const current = await this.readById(reference.id, executor);
        if (current === undefined) {
          missingIds.push(reference.id);
          continue;
        }
        if (current.revision !== reference.revision) {
          conflictedIds.push(reference.id);
          continue;
        }
        const requiredCategoryType = categoryTypeForTransactionType(
          current.type,
        );
        if (
          current.deletedAt !== undefined ||
          current.confirmationStatus !== 'PENDING' ||
          (category !== undefined &&
            (requiredCategoryType === undefined ||
              category.type !== requiredCategoryType))
        ) {
          invalidStateIds.push(reference.id);
          continue;
        }

        const nextCategory =
          category === undefined
            ? {
                categoryId: current.categoryId,
                subcategoryId: current.subcategoryId,
              }
            : category.parent_id === null
              ? { categoryId: category.id, subcategoryId: undefined }
              : {
                  categoryId: category.parent_id,
                  subcategoryId: category.id,
                };
        const nextAccountId = assignment.accountId ?? current.accountId;
        const complete =
          nextAccountId !== undefined &&
          (requiredCategoryType === undefined ||
            nextCategory.categoryId !== undefined);
        const reviewReasonCodes = new Set<TransactionReviewReasonCode>(
          current.reviewReasonCodes ?? [],
        );
        if (complete) {
          reviewReasonCodes.delete('MISSING_FIELDS');
        } else {
          reviewReasonCodes.add('MISSING_FIELDS');
        }
        if (category !== undefined) {
          reviewReasonCodes.delete('CATEGORY_ALTERNATIVES');
        }

        const tags = await executor.execute<{ tag_id: string }>(
          'SELECT tag_id FROM transaction_tags WHERE transaction_id = ?',
          [reference.id],
        );
        try {
          await saveValidatedTransactionWithTags(
            executor,
            {
              ...current,
              ...nextCategory,
              accountId: nextAccountId,
              requiresReview: reviewReasonCodes.size > 0,
              reviewReasonCodes: [...reviewReasonCodes],
              updatedAt: canonicalUpdatedAt,
            },
            tags.rows.map(row => row.tag_id),
          );
          appliedIds.push(reference.id);
        } catch (error) {
          if (error instanceof LedgerWriteConflictError) {
            conflictedIds.push(reference.id);
          } else {
            throw error;
          }
        }
      }

      return {
        appliedIds,
        conflictedIds,
        invalidStateIds,
        missingIds,
      };
    });
  }

  async softDeletePendingBatch(
    references: readonly TransactionRevisionReference[],
    deletedAt: string,
  ): Promise<PendingBatchMutationResult> {
    const uniqueReferences = [
      ...new Map(
        references.map(reference => [reference.id, reference]),
      ).values(),
    ];

    return this.database.transaction(async executor => {
      const appliedIds: string[] = [];
      const conflictedIds: string[] = [];
      const invalidStateIds: string[] = [];
      const missingIds: string[] = [];

      for (const reference of uniqueReferences) {
        const current = await this.readById(reference.id, executor);
        if (current === undefined) {
          missingIds.push(reference.id);
          continue;
        }
        if (current.revision !== reference.revision) {
          conflictedIds.push(reference.id);
          continue;
        }
        if (
          current.deletedAt !== undefined ||
          current.confirmationStatus !== 'PENDING'
        ) {
          invalidStateIds.push(reference.id);
          continue;
        }
        const result = await this.softDeleteInTransaction(
          reference,
          deletedAt,
          executor,
        );
        if (result.status === 'APPLIED') appliedIds.push(reference.id);
        else if (result.status === 'CONFLICT') conflictedIds.push(reference.id);
        else if (result.status === 'INVALID_STATE') {
          invalidStateIds.push(reference.id);
        } else missingIds.push(reference.id);
      }

      return {
        appliedIds,
        conflictedIds,
        invalidStateIds,
        missingIds,
      };
    });
  }

  async softDelete(
    reference: TransactionRevisionReference,
    deletedAt: string,
  ): Promise<TransactionMutationResult> {
    return this.database.transaction(transaction =>
      this.softDeleteInTransaction(reference, deletedAt, transaction),
    );
  }

  private async softDeleteInTransaction(
    reference: TransactionRevisionReference,
    deletedAt: string,
    transaction: SqlExecutor,
  ): Promise<TransactionMutationResult> {
    const canonicalDeletedAt = canonicalUtcTimestamp(deletedAt, 'deletedAt');
    const current = await this.readById(reference.id, transaction);
    if (current === undefined) {
      return { status: 'NOT_FOUND' };
    }
    if (current.revision !== reference.revision) {
      return { status: 'CONFLICT' };
    }
    if (current.deletedAt !== undefined) {
      return { status: 'INVALID_STATE' };
    }
    if (
      Date.parse(canonicalDeletedAt) < Date.parse(current.createdAt) ||
      Date.parse(canonicalDeletedAt) < Date.parse(current.updatedAt)
    ) {
      throw new LedgerValidationError(
        'deletedAt cannot be earlier than the current transaction timestamps.',
      );
    }
    const result = await transaction.execute(
      `UPDATE transactions
         SET deleted_at = ?,
             updated_at = ?,
             revision = revision + 1,
             sync_status = CASE
               WHEN sync_status = 'LOCAL_ONLY' THEN 'LOCAL_ONLY'
               ELSE 'PENDING'
             END
         WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      [
        canonicalDeletedAt,
        canonicalDeletedAt,
        reference.id,
        reference.revision,
      ],
    );
    if (result.rowsAffected !== 1) {
      return this.explainMutationFailure(reference, false, transaction);
    }
    const persisted = await this.readById(reference.id, transaction);
    if (persisted === undefined) {
      return { status: 'NOT_FOUND' };
    }
    return { status: 'APPLIED', transaction: persisted };
  }

  async restore(
    reference: TransactionRevisionReference,
    restoredAt: string,
  ): Promise<TransactionMutationResult> {
    return this.database.transaction(async transaction => {
      const canonicalRestoredAt = canonicalUtcTimestamp(
        restoredAt,
        'restoredAt',
      );
      const current = await this.readById(reference.id, transaction);
      if (current === undefined) {
        return { status: 'NOT_FOUND' };
      }
      if (current.revision !== reference.revision) {
        return { status: 'CONFLICT' };
      }
      if (current.deletedAt === undefined) {
        return { status: 'INVALID_STATE' };
      }
      if (
        Date.parse(canonicalRestoredAt) < Date.parse(current.createdAt) ||
        Date.parse(canonicalRestoredAt) < Date.parse(current.updatedAt)
      ) {
        throw new LedgerValidationError(
          'restoredAt cannot be earlier than the current transaction timestamps.',
        );
      }
      const result = await transaction.execute(
        `UPDATE transactions
         SET deleted_at = NULL,
             updated_at = ?,
             revision = revision + 1,
             sync_status = CASE
               WHEN sync_status = 'LOCAL_ONLY' THEN 'LOCAL_ONLY'
               ELSE 'PENDING'
             END
         WHERE id = ? AND revision = ? AND deleted_at IS NOT NULL`,
        [canonicalRestoredAt, reference.id, reference.revision],
      );
      if (result.rowsAffected !== 1) {
        return this.explainMutationFailure(reference, true, transaction);
      }
      const persisted = await this.readById(reference.id, transaction);
      if (persisted === undefined) {
        return { status: 'NOT_FOUND' };
      }
      return { status: 'APPLIED', transaction: persisted };
    });
  }

  private async confirmPendingInTransaction(
    reference: TransactionRevisionReference,
    updatedAt: string,
    executor: SqlExecutor,
  ): Promise<TransactionMutationResult> {
    const current = await this.readById(reference.id, executor);
    if (current === undefined) {
      return { status: 'NOT_FOUND' };
    }
    if (current.revision !== reference.revision) {
      return { status: 'CONFLICT' };
    }
    if (
      current.deletedAt !== undefined ||
      current.confirmationStatus !== 'PENDING'
    ) {
      return { status: 'INVALID_STATE' };
    }
    if (
      current.requiresReview === true ||
      (current.reviewReasonCodes?.length ?? 0) > 0
    ) {
      return { status: 'INVALID_STATE' };
    }
    const tags = await executor.execute<{ tag_id: string }>(
      'SELECT tag_id FROM transaction_tags WHERE transaction_id = ?',
      [reference.id],
    );
    try {
      const persisted = await saveValidatedTransactionWithTags(
        executor,
        {
          ...current,
          confirmationStatus: 'CONFIRMED',
          updatedAt,
          syncStatus:
            current.syncStatus === 'LOCAL_ONLY' ? 'LOCAL_ONLY' : 'PENDING',
        },
        tags.rows.map(row => row.tag_id),
      );
      return { status: 'APPLIED', transaction: persisted };
    } catch (error) {
      if (error instanceof LedgerWriteConflictError) {
        return { status: 'CONFLICT' };
      }
      throw error;
    }
  }

  private async readById(
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

  private async explainMutationFailure(
    reference: TransactionRevisionReference,
    expectedDeleted: boolean,
    executor: SqlExecutor,
  ): Promise<TransactionMutationResult> {
    const current = await this.readById(reference.id, executor);
    if (current === undefined) {
      return { status: 'NOT_FOUND' };
    }
    if (current.revision !== reference.revision) {
      return { status: 'CONFLICT' };
    }
    if ((current.deletedAt !== undefined) !== expectedDeleted) {
      return { status: 'INVALID_STATE' };
    }
    return { status: 'CONFLICT' };
  }
}
