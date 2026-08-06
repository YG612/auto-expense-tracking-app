import {
  FEEDBACK_LEARNING_STATUSES,
  RULE_ORIGINS,
} from '../../domain/entities';
import type { Migration } from './Migration';

const SEEDED_AT = '2026-08-05T00:00:00.000Z';

function enumValues(values: readonly string[]): string {
  return values.map(value => `'${value}'`).join(', ');
}

export const v3PersonalizationLearning: Migration = {
  version: 3,
  name: 'personalization_learning',
  statements: [
    `ALTER TABLE user_rules
      ADD COLUMN origin TEXT NOT NULL DEFAULT 'USER_CREATED'
      CHECK (origin IN (${enumValues(RULE_ORIGINS)}))`,
    `ALTER TABLE classification_feedback
      ADD COLUMN learning_status TEXT NOT NULL DEFAULT 'PENDING'
      CHECK (learning_status IN (${enumValues(FEEDBACK_LEARNING_STATUSES)}))`,
    `ALTER TABLE classification_feedback
      ADD COLUMN promoted_rule_id TEXT
      REFERENCES user_rules(id) ON DELETE SET NULL`,
    `ALTER TABLE classification_feedback ADD COLUMN processed_at TEXT`,
    `CREATE INDEX classification_feedback_merchant_learning_idx
      ON classification_feedback(
        merchant_raw_name,
        learning_status,
        created_at DESC
      ) WHERE merchant_raw_name IS NOT NULL`,
    `CREATE TABLE personalization_settings (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      learning_enabled INTEGER NOT NULL DEFAULT 1
        CHECK (learning_enabled IN (0, 1)),
      updated_at TEXT NOT NULL
    ) STRICT`,
    `INSERT INTO personalization_settings (id, learning_enabled, updated_at)
      VALUES (1, 1, '${SEEDED_AT}')`,
    `CREATE TABLE learned_rule_suppressions (
      rule_type TEXT NOT NULL CHECK (rule_type = 'MERCHANT'),
      pattern TEXT NOT NULL COLLATE NOCASE,
      suppressed_at TEXT NOT NULL,
      PRIMARY KEY (rule_type, pattern)
    ) WITHOUT ROWID, STRICT`,
  ],
};
