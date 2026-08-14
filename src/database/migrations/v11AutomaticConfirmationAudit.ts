import type { Migration } from './Migration';

export const v11AutomaticConfirmationAudit: Migration = {
  version: 11,
  name: 'automatic_confirmation_audit',
  statements: [
    `ALTER TABLE transactions
       ADD COLUMN auto_confirmation_reason TEXT
       CHECK (
         auto_confirmation_reason IS NULL OR
         length(auto_confirmation_reason) BETWEEN 1 AND 240
       )`,
    `ALTER TABLE transactions
       ADD COLUMN auto_confirmed_at TEXT`,
  ],
};
