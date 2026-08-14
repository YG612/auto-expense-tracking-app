import type { DatabaseConnection, SqlRow } from '../types';
import {
  optionalString,
  requiredNumber,
  requiredString,
} from './mappingHelpers';

type TransactionExportSqlRow = SqlRow & {
  id: string;
  occurred_at: string;
  type: string;
  amount_minor: number;
  currency: string;
  category: string | null;
  subcategory: string | null;
  account: string | null;
  target_account: string | null;
  merchant: string | null;
  project: string | null;
  tags: string | null;
  note: string | null;
  source: string;
  source_reference_id: string | null;
  original_text: string | null;
  confidence: number | null;
  confirmation_status: string;
  duplicate_status: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TransactionExportRow = {
  id: string;
  occurredAt: string;
  type: string;
  amountMinor: number;
  currency: string;
  category?: string;
  subcategory?: string;
  account?: string;
  targetAccount?: string;
  merchant?: string;
  project?: string;
  tags?: string;
  note?: string;
  source: string;
  sourceReferenceId?: string;
  originalText?: string;
  confidence?: number;
  confirmationStatus: string;
  duplicateStatus: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type TransactionExportOptions = {
  includeDeleted?: boolean;
  includeOriginalText?: boolean;
};

export class LedgerExportRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async listTransactionsForExport(
    options: TransactionExportOptions = {},
  ): Promise<TransactionExportRow[]> {
    const includeOriginalText = options.includeOriginalText === true;
    const deletedPredicate =
      options.includeDeleted === true
        ? ''
        : 'WHERE transactions.deleted_at IS NULL';
    const result = await this.database.execute<TransactionExportSqlRow>(
      `SELECT
         transactions.id,
         transactions.occurred_at,
         transactions.type,
         transactions.amount_minor,
         transactions.currency,
         categories.name AS category,
         subcategories.name AS subcategory,
         accounts.name AS account,
         target_accounts.name AS target_account,
         COALESCE(
           NULLIF(transactions.merchant_raw_name, ''),
           merchants.canonical_name
         ) AS merchant,
         projects.name AS project,
         (
           SELECT group_concat(ordered_tags.name, '；')
           FROM (
             SELECT tags.name
             FROM transaction_tags
             JOIN tags ON tags.id = transaction_tags.tag_id
             WHERE transaction_tags.transaction_id = transactions.id
             ORDER BY tags.name COLLATE NOCASE ASC
           ) AS ordered_tags
         ) AS tags,
         transactions.note,
         transactions.source,
         transactions.source_reference_id,
         ${includeOriginalText ? 'transactions.original_text' : 'NULL'}
           AS original_text,
         transactions.confidence,
         transactions.confirmation_status,
         transactions.duplicate_status,
         transactions.deleted_at,
         transactions.created_at,
         transactions.updated_at
       FROM transactions
       LEFT JOIN categories ON categories.id = transactions.category_id
       LEFT JOIN categories AS subcategories
         ON subcategories.id = transactions.subcategory_id
       LEFT JOIN accounts ON accounts.id = transactions.account_id
       LEFT JOIN accounts AS target_accounts
         ON target_accounts.id = transactions.target_account_id
       LEFT JOIN merchants ON merchants.id = transactions.merchant_id
       LEFT JOIN projects ON projects.id = transactions.project_id
       ${deletedPredicate}
       ORDER BY transactions.occurred_at ASC, transactions.id ASC`,
    );

    return result.rows.map(row => ({
      id: requiredString(row, 'id'),
      occurredAt: requiredString(row, 'occurred_at'),
      type: requiredString(row, 'type'),
      amountMinor: requiredNumber(row, 'amount_minor'),
      currency: requiredString(row, 'currency'),
      category: optionalString(row, 'category'),
      subcategory: optionalString(row, 'subcategory'),
      account: optionalString(row, 'account'),
      targetAccount: optionalString(row, 'target_account'),
      merchant: optionalString(row, 'merchant'),
      project: optionalString(row, 'project'),
      tags: optionalString(row, 'tags'),
      note: optionalString(row, 'note'),
      source: requiredString(row, 'source'),
      sourceReferenceId: optionalString(row, 'source_reference_id'),
      originalText: optionalString(row, 'original_text'),
      confidence:
        row.confidence === null || row.confidence === undefined
          ? undefined
          : requiredNumber(row, 'confidence'),
      confirmationStatus: requiredString(row, 'confirmation_status'),
      duplicateStatus: requiredString(row, 'duplicate_status'),
      deletedAt: optionalString(row, 'deleted_at'),
      createdAt: requiredString(row, 'created_at'),
      updatedAt: requiredString(row, 'updated_at'),
    }));
  }
}
