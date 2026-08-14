import type { ImportRecord, Transaction } from '../../domain/entities';
import type {
  NormalizedImportCandidateV1,
  StatementImportPreview,
} from '../../importers/types';
import { classifyStatementPreview } from '../../importers/classifyStatementPreview';
import { createId } from '../../utils/createId';
import type { DatabaseConnection, SqlExecutor, SqlRow } from '../types';
import {
  accountDefinition,
  categoryDefinition,
  importRecordDefinition,
  merchantDefinition,
  userRuleDefinition,
} from './entityDefinitions';
import {
  canonicalUtcTimestamp,
  createValidatedTransactionWithTags,
} from './transactionWriteIntegrity';

export type ImportDuplicateKind = 'NONE' | 'POSSIBLE' | 'DEFINITE';

export type ReviewedImportCandidate = {
  candidate: NormalizedImportCandidateV1;
  duplicateKind: ImportDuplicateKind;
  existingTransactionId?: string;
};

export type StatementImportReview = {
  preview: StatementImportPreview;
  rows: readonly ReviewedImportCandidate[];
  definiteDuplicateCount: number;
  possibleDuplicateCount: number;
};

export type StatementImportCommitResult = {
  importRecord: ImportRecord;
  transactionIds: readonly string[];
};

export type StatementImportBatchCommitResult = {
  results: readonly StatementImportCommitResult[];
  transactionIds: readonly string[];
};

type DuplicateRow = SqlRow & {
  id: string;
  source: string;
  source_reference_id: string | null;
  fingerprint: string | null;
};

type AccountRow = SqlRow & { id: string; name: string };

function normalizedName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replaceAll(/[\s\p{P}\p{S}]/gu, '');
}

async function insertImportRecord(
  record: ImportRecord,
  executor: SqlExecutor,
): Promise<void> {
  const columns = importRecordDefinition.columns;
  const values = importRecordDefinition.toValues(record);
  await executor.execute(
    `INSERT INTO import_records (${columns.join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})`,
    columns.map(column => values[column]),
  );
}

function prepareImportRecord(
  review: StatementImportReview,
  createdAt: string,
): {
  importRecord: ImportRecord;
  importable: readonly ReviewedImportCandidate[];
} {
  const importable = review.rows.filter(
    row => row.duplicateKind !== 'DEFINITE',
  );
  return {
    importRecord: {
      id: createId('import-record'),
      source: review.preview.source,
      fileName: review.preview.fileName,
      rawContentHash: review.preview.rawContentHash,
      parsedCount:
        review.preview.candidates.length + review.preview.failures.length,
      importedCount: importable.length,
      duplicateCount:
        review.definiteDuplicateCount + review.possibleDuplicateCount,
      failedCount: review.preview.failures.length,
      createdAt,
    },
    importable,
  };
}

export class StatementImportRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async analyze(
    preview: StatementImportPreview,
  ): Promise<StatementImportReview> {
    const [categoryRows, accountRows, userRuleRows, merchantRows] =
      await Promise.all([
        this.database.execute(
          `SELECT ${categoryDefinition.columns.join(', ')} FROM categories WHERE is_hidden = 0`,
        ),
        this.database.execute(
          `SELECT ${accountDefinition.columns.join(', ')} FROM accounts WHERE is_hidden = 0`,
        ),
        this.database.execute(
          `SELECT ${userRuleDefinition.columns.join(', ')} FROM user_rules WHERE enabled = 1`,
        ),
        this.database.execute(
          `SELECT ${merchantDefinition.columns.join(', ')} FROM merchants`,
        ),
      ]);
    const classifiedPreview = classifyStatementPreview(preview, {
      categories: categoryRows.rows.map(row => categoryDefinition.fromRow(row)),
      accounts: accountRows.rows.map(row => accountDefinition.fromRow(row)),
      userRules: userRuleRows.rows.map(row => userRuleDefinition.fromRow(row)),
      merchants: merchantRows.rows.map(row => merchantDefinition.fromRow(row)),
    });
    const existing = await this.database.execute<DuplicateRow>(
      `SELECT id, source, source_reference_id, fingerprint
       FROM transactions
       WHERE deleted_at IS NULL
         AND (source_reference_id IS NOT NULL OR fingerprint IS NOT NULL)`,
    );
    const sourceReferences = new Map<string, string>();
    const fingerprints = new Map<string, string>();
    for (const row of existing.rows) {
      if (row.source_reference_id !== null) {
        sourceReferences.set(
          `${row.source}|${row.source_reference_id.trim()}`,
          row.id,
        );
      }
      if (row.fingerprint !== null) fingerprints.set(row.fingerprint, row.id);
    }

    const rows: ReviewedImportCandidate[] = [];
    for (const candidate of classifiedPreview.candidates) {
      const referenceKey =
        candidate.sourceReferenceId === undefined
          ? undefined
          : `${candidate.transactionSource}|${candidate.sourceReferenceId.trim()}`;
      const referenceMatch =
        referenceKey === undefined
          ? undefined
          : sourceReferences.get(referenceKey);
      const fingerprintMatch = fingerprints.get(candidate.fingerprint);
      if (referenceMatch !== undefined) {
        rows.push({
          candidate,
          duplicateKind: 'DEFINITE',
          existingTransactionId: referenceMatch,
        });
        continue;
      }
      if (fingerprintMatch !== undefined) {
        rows.push({
          candidate,
          duplicateKind: 'POSSIBLE',
          existingTransactionId: fingerprintMatch,
        });
      } else {
        rows.push({ candidate, duplicateKind: 'NONE' });
      }
      if (referenceKey !== undefined) {
        sourceReferences.set(referenceKey, `source-row-${candidate.sourceRow}`);
      }
      fingerprints.set(
        candidate.fingerprint,
        `source-row-${candidate.sourceRow}`,
      );
    }

    return {
      preview: classifiedPreview,
      rows,
      definiteDuplicateCount: rows.filter(
        row => row.duplicateKind === 'DEFINITE',
      ).length,
      possibleDuplicateCount: rows.filter(
        row => row.duplicateKind === 'POSSIBLE',
      ).length,
    };
  }

  async commit(
    review: StatementImportReview,
    createdAt: string,
  ): Promise<StatementImportCommitResult> {
    const batch = await this.commitMany([review], createdAt);
    return batch.results[0]!;
  }

  async commitMany(
    reviews: readonly StatementImportReview[],
    createdAt: string,
  ): Promise<StatementImportBatchCommitResult> {
    const canonicalCreatedAt = canonicalUtcTimestamp(createdAt, 'createdAt');
    const prepared = reviews.map(review =>
      prepareImportRecord(review, canonicalCreatedAt),
    );
    const results = prepared.map(({ importRecord }) => ({
      importRecord,
      transactionIds: [] as string[],
    }));

    await this.database.transaction(async executor => {
      const accountRows = await executor.execute<AccountRow>(
        'SELECT id, name FROM accounts ORDER BY sort_order ASC',
      );
      const accountByName = new Map(
        accountRows.rows.map(row => [normalizedName(row.name), row.id]),
      );

      for (const [batchIndex, batch] of prepared.entries()) {
        await insertImportRecord(batch.importRecord, executor);
        for (const row of batch.importable) {
          const candidate = row.candidate;
          const id = createId('transaction');
          const accountId =
            candidate.accountIdHint ??
            (candidate.accountHint === undefined
              ? undefined
              : accountByName.get(normalizedName(candidate.accountHint)));
          const categoryRequired =
            candidate.type === 'EXPENSE' ||
            candidate.type === 'INCOME' ||
            candidate.type === 'REFUND' ||
            candidate.type === 'REIMBURSEMENT';
          const hasMissingFields =
            accountId === undefined ||
            (categoryRequired && candidate.categoryIdHint === undefined);
          const reviewReasonCodes: Transaction['reviewReasonCodes'] = [
            ...(hasMissingFields ? (['MISSING_FIELDS'] as const) : []),
            ...(row.duplicateKind === 'POSSIBLE'
              ? (['AMBIGUOUS'] as const)
              : []),
          ];
          const transaction: Transaction = {
            id,
            revision: 1,
            type: candidate.type,
            amountMinor: candidate.amountMinor,
            currency: candidate.currency,
            occurredAt: candidate.occurredAt,
            categoryId: candidate.categoryIdHint,
            subcategoryId: candidate.subcategoryIdHint,
            accountId,
            merchantId: candidate.merchantIdHint,
            merchantRawName: candidate.merchantRawName,
            note: candidate.note,
            source: candidate.transactionSource,
            sourceReferenceId: candidate.sourceReferenceId,
            confidence: row.duplicateKind === 'POSSIBLE' ? 0.75 : 1,
            requiresReview: reviewReasonCodes.length > 0,
            reviewReasonCodes,
            confirmationStatus: 'PENDING',
            duplicateStatus:
              row.duplicateKind === 'POSSIBLE' ? 'POSSIBLE' : 'NONE',
            relatedTransactionId: row.existingTransactionId,
            fingerprint: candidate.fingerprint,
            importRecordId: batch.importRecord.id,
            createdAt: canonicalCreatedAt,
            updatedAt: canonicalCreatedAt,
            syncStatus: 'LOCAL_ONLY',
          };
          await createValidatedTransactionWithTags(executor, transaction, []);
          results[batchIndex]!.transactionIds.push(id);
        }
      }
    });

    return {
      results,
      transactionIds: results.flatMap(result => result.transactionIds),
    };
  }

  async undo(importRecordId: string, undoneAt: string): Promise<number> {
    const canonicalUndoneAt = canonicalUtcTimestamp(undoneAt, 'undoneAt');
    return this.database.transaction(async executor => {
      const record = await executor.execute<{ undone_at: string | null }>(
        'SELECT undone_at FROM import_records WHERE id = ?',
        [importRecordId],
      );
      if (record.rows[0] === undefined)
        throw new Error('Import record not found.');
      if (record.rows[0].undone_at !== null) return 0;

      await executor.execute(
        `DELETE FROM classification_feedback
         WHERE transaction_id IN (
           SELECT id FROM transactions WHERE import_record_id = ?
         )`,
        [importRecordId],
      );
      await executor.execute(
        `DELETE FROM transaction_tags
         WHERE transaction_id IN (
           SELECT id FROM transactions WHERE import_record_id = ?
         )`,
        [importRecordId],
      );
      const deleted = await executor.execute(
        'DELETE FROM transactions WHERE import_record_id = ?',
        [importRecordId],
      );
      const updated = await executor.execute(
        `UPDATE import_records
         SET imported_count = 0, undone_at = ?
         WHERE id = ? AND undone_at IS NULL`,
        [canonicalUndoneAt, importRecordId],
      );
      if (updated.rowsAffected !== 1)
        throw new Error('Import undo conflicted.');
      return deleted.rowsAffected;
    });
  }
}
