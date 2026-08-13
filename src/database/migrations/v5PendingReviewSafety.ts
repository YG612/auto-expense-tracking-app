import type { Migration } from './Migration';

export const v5PendingReviewSafety: Migration = {
  version: 5,
  name: 'pending_review_safety',
  statements: [
    `ALTER TABLE transactions
      ADD COLUMN requires_review INTEGER NOT NULL DEFAULT 0
      CHECK (requires_review IN (0, 1))`,
    `ALTER TABLE transactions
      ADD COLUMN review_reason_codes_json TEXT NOT NULL DEFAULT '[]'`,
    `UPDATE transactions
      SET requires_review = 1,
          review_reason_codes_json = '["LEGACY_PENDING_UNCLASSIFIED"]'
      WHERE confirmation_status = 'PENDING'`,
    `CREATE INDEX transactions_pending_review_idx
      ON transactions(confirmation_status, requires_review, occurred_at DESC)
      WHERE deleted_at IS NULL`,
  ],
};
