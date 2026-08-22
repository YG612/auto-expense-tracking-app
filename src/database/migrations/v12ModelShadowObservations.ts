import type { Migration } from './Migration';

export const v12ModelShadowObservations: Migration = {
  version: 12,
  name: 'model_shadow_observations',
  statements: [
    `CREATE TABLE model_shadow_observations (
      id TEXT PRIMARY KEY NOT NULL,
      transaction_id TEXT NOT NULL UNIQUE
        REFERENCES transactions(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 100),
      model_version TEXT NOT NULL CHECK (length(model_version) BETWEEN 1 AND 50),
      taxonomy_version INTEGER NOT NULL CHECK (taxonomy_version > 0),
      predicted_category_key TEXT NOT NULL CHECK (
        length(predicted_category_key) BETWEEN 1 AND 150
      ),
      final_category_key TEXT NOT NULL CHECK (
        length(final_category_key) BETWEEN 1 AND 150
      ),
      matched INTEGER NOT NULL CHECK (matched IN (0, 1)),
      calibrated_confidence REAL NOT NULL CHECK (
        calibrated_confidence BETWEEN 0 AND 1
      ),
      latency_ms REAL NOT NULL CHECK (latency_ms BETWEEN 0 AND 60000),
      created_at TEXT NOT NULL
    ) STRICT`,
    `CREATE INDEX model_shadow_observations_version_time_idx
      ON model_shadow_observations(model_version, created_at DESC)`,
  ],
};
