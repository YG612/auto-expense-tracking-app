import type { Migration } from './Migration';

export const v9BudgetsAndRecurring: Migration = {
  version: 9,
  name: 'budgets_and_recurring',
  statements: [
    `CREATE TABLE recurring_templates (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('EXPENSE', 'INCOME')),
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      currency TEXT NOT NULL DEFAULT 'CNY',
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      note TEXT,
      cadence TEXT NOT NULL CHECK (cadence IN ('WEEKLY', 'MONTHLY')),
      next_occurrence_at TEXT NOT NULL,
      monthly_anchor_day INTEGER
        CHECK (monthly_anchor_day IS NULL OR monthly_anchor_day BETWEEN 1 AND 31),
      monthly_anchor_is_end_of_month INTEGER
        CHECK (
          monthly_anchor_is_end_of_month IS NULL OR
          monthly_anchor_is_end_of_month IN (0, 1)
        ),
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
