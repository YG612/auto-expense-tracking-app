import type {
  ConfirmationStatus,
  DuplicateStatus,
  Transaction,
  TransactionType,
} from '../../domain/entities';
import type { DatabaseConnection, SqlRow, SqlValue } from '../types';
import { BaseRepository } from './BaseRepository';
import { transactionDefinition } from './entityDefinitions';
import { optionalString } from './mappingHelpers';

export type TransactionListOptions = {
  includeDeleted?: boolean;
  confirmationStatus?: ConfirmationStatus;
  limit?: number;
};

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

  async saveWithTags(
    transactionEntity: Transaction,
    tagIds: readonly string[],
  ): Promise<void> {
    const values = transactionDefinition.toValues(transactionEntity);
    const columns = transactionDefinition.columns;
    const uniqueTagIds = [...new Set(tagIds)];

    await this.database.transaction(async transaction => {
      const existing = await transaction.execute<{ id: string }>(
        'SELECT id FROM transactions WHERE id = ?',
        [transactionEntity.id],
      );

      if (existing.rows.length === 0) {
        await transaction.execute(
          `INSERT INTO transactions (${columns.join(', ')})
           VALUES (${columns.map(() => '?').join(', ')})`,
          columns.map(column => values[column]),
        );
      } else {
        const updatedColumns = columns.filter(column => column !== 'id');
        await transaction.execute(
          `UPDATE transactions
           SET ${updatedColumns.map(column => `${column} = ?`).join(', ')}
           WHERE id = ?`,
          [
            ...updatedColumns.map(column => values[column]),
            transactionEntity.id,
          ],
        );
      }

      await transaction.execute(
        'DELETE FROM transaction_tags WHERE transaction_id = ?',
        [transactionEntity.id],
      );

      for (const tagId of uniqueTagIds) {
        await transaction.execute(
          `INSERT INTO transaction_tags (transaction_id, tag_id)
           VALUES (?, ?)`,
          [transactionEntity.id, tagId],
        );
      }
    });
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

  async confirmPending(id: string, updatedAt: string): Promise<boolean> {
    const result = await this.database.execute(
      `UPDATE transactions
       SET confirmation_status = 'CONFIRMED',
           updated_at = ?,
           sync_status = CASE
             WHEN sync_status = 'LOCAL_ONLY' THEN 'LOCAL_ONLY'
             ELSE 'PENDING'
           END
       WHERE id = ?
         AND deleted_at IS NULL
         AND confirmation_status = 'PENDING'`,
      [updatedAt, id],
    );

    return result.rowsAffected === 1;
  }

  async confirmPendingBatch(
    ids: readonly string[],
    updatedAt: string,
  ): Promise<number> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      return 0;
    }

    const placeholders = uniqueIds.map(() => '?').join(', ');
    const result = await this.database.execute(
      `UPDATE transactions
       SET confirmation_status = 'CONFIRMED',
           updated_at = ?,
           sync_status = CASE
             WHEN sync_status = 'LOCAL_ONLY' THEN 'LOCAL_ONLY'
             ELSE 'PENDING'
           END
       WHERE id IN (${placeholders})
         AND deleted_at IS NULL
         AND confirmation_status = 'PENDING'`,
      [updatedAt, ...uniqueIds],
    );

    return result.rowsAffected;
  }

  async softDelete(id: string, deletedAt: string): Promise<boolean> {
    return this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `UPDATE transactions
         SET deleted_at = ?,
             updated_at = ?,
             sync_status = CASE
               WHEN sync_status = 'LOCAL_ONLY' THEN 'LOCAL_ONLY'
               ELSE 'PENDING'
             END
         WHERE id = ? AND deleted_at IS NULL`,
        [deletedAt, deletedAt, id],
      );

      return result.rowsAffected === 1;
    });
  }

  async restore(id: string, restoredAt: string): Promise<boolean> {
    return this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `UPDATE transactions
         SET deleted_at = NULL,
             updated_at = ?,
             sync_status = CASE
               WHEN sync_status = 'LOCAL_ONLY' THEN 'LOCAL_ONLY'
               ELSE 'PENDING'
             END
         WHERE id = ? AND deleted_at IS NOT NULL`,
        [restoredAt, id],
      );

      return result.rowsAffected === 1;
    });
  }
}
