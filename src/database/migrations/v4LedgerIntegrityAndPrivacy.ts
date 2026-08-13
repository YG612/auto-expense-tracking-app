import type { Migration } from './Migration';

export const v4LedgerIntegrityAndPrivacy: Migration = {
  version: 4,
  name: 'ledger_integrity_and_privacy',
  statements: [
    `ALTER TABLE transactions
      ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
      CHECK (revision >= 1)`,
    `ALTER TABLE personalization_settings
      ADD COLUMN retain_original_text INTEGER NOT NULL DEFAULT 1
      CHECK (retain_original_text IN (0, 1))`,
  ],
};
