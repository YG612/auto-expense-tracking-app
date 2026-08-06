import {
  ACCOUNT_TYPES,
  BUDGET_PERIOD_TYPES,
  CATEGORY_TYPES,
  CONFIRMATION_STATUSES,
  DUPLICATE_STATUSES,
  IMPORT_SOURCES,
  RULE_TYPES,
  SYNC_STATUSES,
  TRANSACTION_SOURCES,
  TRANSACTION_TYPES,
} from '../../domain/entities';
import type { Migration } from './Migration';

function enumValues(values: readonly string[]): string {
  return values.map(value => `'${value}'`).join(', ');
}

export const v1InitialSchema: Migration = {
  version: 1,
  name: 'initial_schema',
  statements: [
    `CREATE TABLE categories (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL CHECK (type IN (${enumValues(CATEGORY_TYPES)})),
      parent_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
      system_key TEXT,
      name TEXT NOT NULL,
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
      is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT`,
    `CREATE UNIQUE INDEX categories_system_key_unique
      ON categories(system_key) WHERE system_key IS NOT NULL`,
    `CREATE INDEX categories_parent_id_idx ON categories(parent_id)`,
    `CREATE INDEX categories_type_sort_idx
      ON categories(type, is_hidden, sort_order)`,

    `CREATE TABLE accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN (${enumValues(ACCOUNT_TYPES)})),
      currency TEXT NOT NULL,
      include_in_net_worth INTEGER NOT NULL DEFAULT 1
        CHECK (include_in_net_worth IN (0, 1)),
      opening_balance_minor INTEGER,
      current_balance_minor INTEGER,
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT`,
    `CREATE INDEX accounts_visible_sort_idx
      ON accounts(is_hidden, sort_order)`,

    `CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      start_date TEXT,
      end_date TEXT,
      budget_minor INTEGER CHECK (budget_minor IS NULL OR budget_minor >= 0),
      currency TEXT NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT`,
    `CREATE INDEX projects_archived_idx ON projects(is_archived, created_at)`,

    `CREATE TABLE merchants (
      id TEXT PRIMARY KEY NOT NULL,
      canonical_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      default_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      default_subcategory_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT`,
    `CREATE UNIQUE INDEX merchants_normalized_name_unique
      ON merchants(normalized_name)`,

    `CREATE TABLE tags (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT`,
    `CREATE UNIQUE INDEX tags_name_unique ON tags(name)`,

    `CREATE TABLE transactions (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL CHECK (type IN (${enumValues(TRANSACTION_TYPES)})),
      amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
      currency TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      subcategory_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      target_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      merchant_id TEXT REFERENCES merchants(id) ON DELETE SET NULL,
      merchant_raw_name TEXT,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      note TEXT,
      source TEXT NOT NULL CHECK (source IN (${enumValues(TRANSACTION_SOURCES)})),
      source_reference_id TEXT,
      original_text TEXT,
      confidence REAL CHECK (
        confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
      ),
      confirmation_status TEXT NOT NULL
        CHECK (confirmation_status IN (${enumValues(CONFIRMATION_STATUSES)})),
      duplicate_status TEXT NOT NULL
        CHECK (duplicate_status IN (${enumValues(DUPLICATE_STATUSES)})),
      related_transaction_id TEXT
        REFERENCES transactions(id) ON DELETE SET NULL,
      fingerprint TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL CHECK (sync_status IN (${enumValues(
        SYNC_STATUSES,
      )}))
    ) STRICT`,
    `CREATE INDEX transactions_occurred_at_idx
      ON transactions(occurred_at DESC)`,
    `CREATE INDEX transactions_active_occurred_at_idx
      ON transactions(occurred_at DESC) WHERE deleted_at IS NULL`,
    `CREATE INDEX transactions_category_id_idx ON transactions(category_id)`,
    `CREATE INDEX transactions_account_id_idx ON transactions(account_id)`,
    `CREATE INDEX transactions_confirmation_status_idx
      ON transactions(confirmation_status)`,
    `CREATE INDEX transactions_fingerprint_idx ON transactions(fingerprint)`,
    `CREATE UNIQUE INDEX transactions_source_reference_unique
      ON transactions(source, source_reference_id)
      WHERE source_reference_id IS NOT NULL`,

    `CREATE TABLE transaction_tags (
      transaction_id TEXT NOT NULL
        REFERENCES transactions(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (transaction_id, tag_id)
    ) WITHOUT ROWID, STRICT`,
    `CREATE INDEX transaction_tags_tag_id_idx ON transaction_tags(tag_id)`,

    `CREATE TABLE user_rules (
      id TEXT PRIMARY KEY NOT NULL,
      rule_type TEXT NOT NULL CHECK (rule_type IN (${enumValues(RULE_TYPES)})),
      pattern TEXT NOT NULL,
      transaction_type TEXT
        CHECK (
          transaction_type IS NULL OR
          transaction_type IN (${enumValues(TRANSACTION_TYPES)})
        ),
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      subcategory_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT`,
    `CREATE INDEX user_rules_match_idx
      ON user_rules(enabled, rule_type, priority DESC)`,

    `CREATE TABLE classification_feedback (
      id TEXT PRIMARY KEY NOT NULL,
      transaction_id TEXT NOT NULL
        REFERENCES transactions(id) ON DELETE CASCADE,
      original_type TEXT
        CHECK (original_type IS NULL OR original_type IN (${enumValues(
          TRANSACTION_TYPES,
        )})),
      corrected_type TEXT
        CHECK (corrected_type IS NULL OR corrected_type IN (${enumValues(
          TRANSACTION_TYPES,
        )})),
      original_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      corrected_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      original_subcategory_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      corrected_subcategory_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      original_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      corrected_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      source_text TEXT,
      merchant_raw_name TEXT,
      created_at TEXT NOT NULL
    ) STRICT`,
    `CREATE INDEX classification_feedback_transaction_id_idx
      ON classification_feedback(transaction_id)`,

    `CREATE TABLE budgets (
      id TEXT PRIMARY KEY NOT NULL,
      period_type TEXT NOT NULL
        CHECK (period_type IN (${enumValues(BUDGET_PERIOD_TYPES)})),
      year INTEGER NOT NULL CHECK (year >= 1970),
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
      limit_minor INTEGER NOT NULL CHECK (limit_minor >= 0),
      currency TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT`,
    `CREATE UNIQUE INDEX budgets_month_total_unique
      ON budgets(period_type, year, month, currency)
      WHERE category_id IS NULL`,
    `CREATE UNIQUE INDEX budgets_month_category_unique
      ON budgets(period_type, year, month, category_id, currency)
      WHERE category_id IS NOT NULL`,

    `CREATE TABLE import_records (
      id TEXT PRIMARY KEY NOT NULL,
      source TEXT NOT NULL CHECK (source IN (${enumValues(IMPORT_SOURCES)})),
      file_name TEXT,
      source_reference_id TEXT,
      raw_content_hash TEXT,
      parsed_count INTEGER NOT NULL DEFAULT 0 CHECK (parsed_count >= 0),
      imported_count INTEGER NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
      duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
      failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
      created_at TEXT NOT NULL
    ) STRICT`,
    `CREATE INDEX import_records_created_at_idx
      ON import_records(created_at DESC)`,
    `CREATE INDEX import_records_raw_content_hash_idx
      ON import_records(raw_content_hash)`,
  ],
};
