import type { Migration } from './Migration';

/**
 * A voice origin is consumed permanently. The receipt intentionally has no
 * foreign key to transactions: removing a ledger row must never make an old
 * microphone result reusable.
 */
export const v6VoiceOperationReceipts: Migration = {
  version: 6,
  name: 'voice_operation_receipts',
  statements: [
    `CREATE TABLE recognized_operation_receipts (
      source TEXT NOT NULL CHECK (source = 'VOICE'),
      source_reference_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      transaction_id TEXT NOT NULL UNIQUE,
      confirmation_status TEXT NOT NULL CHECK (
        confirmation_status IN ('CONFIRMED', 'PENDING')
      ),
      state TEXT NOT NULL CHECK (state = 'COMMITTED'),
      committed_at TEXT NOT NULL,
      PRIMARY KEY (source, source_reference_id)
    ) STRICT`,
    `CREATE INDEX recognized_operation_receipts_transaction_idx
      ON recognized_operation_receipts(transaction_id)`,
    `INSERT INTO recognized_operation_receipts (
      source,
      source_reference_id,
      payload_hash,
      transaction_id,
      confirmation_status,
      state,
      committed_at
    )
    SELECT
      source,
      source_reference_id,
      'legacy-unbound:' || id,
      id,
      confirmation_status,
      'COMMITTED',
      updated_at
    FROM transactions
    WHERE source = 'VOICE'
      AND source_reference_id IS NOT NULL
      AND confirmation_status IN ('CONFIRMED', 'PENDING')`,
  ],
};
