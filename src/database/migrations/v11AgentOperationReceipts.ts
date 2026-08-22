import type { Migration } from './Migration';

export const v11AgentOperationReceipts: Migration = {
  version: 11,
  name: 'agent_operation_receipts',
  statements: [
    `CREATE TABLE agent_operation_receipts (
      caller_id TEXT NOT NULL CHECK (
        length(caller_id) BETWEEN 1 AND 128
      ),
      idempotency_key TEXT NOT NULL CHECK (
        length(idempotency_key) BETWEEN 1 AND 128
      ),
      operation TEXT NOT NULL CHECK (
        operation = 'CREATE_PENDING_BILL'
      ),
      payload_hash TEXT NOT NULL CHECK (
        length(payload_hash) BETWEEN 16 AND 128
      ),
      state TEXT NOT NULL CHECK (state IN ('IN_PROGRESS', 'COMMITTED')),
      transaction_ids_json TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      PRIMARY KEY (caller_id, idempotency_key)
    ) STRICT`,
  ],
};
