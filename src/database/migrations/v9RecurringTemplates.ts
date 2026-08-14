import { TRANSACTION_TYPES } from '../../domain/entities/Transaction';
import type { Migration } from './Migration';

function enumValues(values: readonly string[]): string {
  return values.map(value => `'${value}'`).join(', ');
}

const RECURRING_TYPES = TRANSACTION_TYPES.filter(
  type => type === 'EXPENSE' || type === 'INCOME',
);

export const v9RecurringTemplates: Migration = {
  version: 9,
  name: 'recurring_templates',
  statements: [
    `CREATE TABLE recurring_templates (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN (${enumValues(RECURRING_TYPES)})),
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      currency TEXT NOT NULL DEFAULT 'CNY',
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      note TEXT,
      cadence TEXT NOT NULL CHECK (cadence IN ('WEEKLY', 'MONTHLY')),
      next_occurrence_at TEXT NOT NULL,
      confirmation_policy TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (confirmation_policy IN ('DRAFT', 'AUTO')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      last_generated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT`,
    `CREATE INDEX recurring_templates_due_idx
      ON recurring_templates(enabled, next_occurrence_at)`,
    `CREATE UNIQUE INDEX transactions_recurring_source_reference_unique
      ON transactions(source_reference_id)
      WHERE source_reference_id LIKE 'recurring:%'`,
  ],
};
