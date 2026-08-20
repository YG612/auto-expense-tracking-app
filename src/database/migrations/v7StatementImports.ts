import type { Migration } from './Migration';

export const v7StatementImports: Migration = {
  version: 7,
  name: 'statement_imports',
  statements: [
    `ALTER TABLE transactions
      ADD COLUMN import_record_id TEXT
      REFERENCES import_records(id) ON DELETE RESTRICT`,
    `CREATE INDEX transactions_import_record_id_idx
      ON transactions(import_record_id)`,
    `ALTER TABLE import_records ADD COLUMN undone_at TEXT`,
    `CREATE TABLE import_mapping_templates (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      mapping_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT`,
  ],
};
