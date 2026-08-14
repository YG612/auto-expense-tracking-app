import type { Migration } from './Migration';

export const v13ProductValueMetrics: Migration = {
  version: 13,
  name: 'product_value_metrics',
  statements: [
    `CREATE TABLE product_value_events (
      id TEXT PRIMARY KEY NOT NULL,
      event_type TEXT NOT NULL CHECK (
        event_type IN ('ENTRY_STARTED', 'CONFIRM_CLICK', 'EDIT_OPEN')
      ),
      experience_version TEXT NOT NULL,
      session_id TEXT NOT NULL,
      transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
      occurred_at TEXT NOT NULL
    ) STRICT`,
    `CREATE INDEX product_value_events_experience_idx
       ON product_value_events(experience_version, occurred_at)`,
  ],
};
