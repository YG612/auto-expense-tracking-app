import type { Migration } from './Migration';

export const v8StatementImportAudit: Migration = {
  version: 8,
  name: 'statement_import_audit',
  statements: [
    `ALTER TABLE transactions
      ADD COLUMN import_record_id TEXT
      REFERENCES import_records(id) ON DELETE RESTRICT`,
    `CREATE INDEX transactions_import_record_id_idx
      ON transactions(import_record_id)`,
    `ALTER TABLE import_records ADD COLUMN undone_at TEXT`,
  ],
};
