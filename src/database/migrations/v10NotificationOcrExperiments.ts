import type { Migration } from './Migration';

const SEEDED_AT = '2026-08-14T00:00:00.000Z';

export const v10NotificationOcrExperiments: Migration = {
  version: 10,
  name: 'notification_ocr_experiments',
  statements: [
    `CREATE TABLE experimental_feature_settings (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      payment_notifications_enabled INTEGER NOT NULL DEFAULT 0
        CHECK (payment_notifications_enabled IN (0, 1)),
      image_ocr_enabled INTEGER NOT NULL DEFAULT 0
        CHECK (image_ocr_enabled IN (0, 1)),
      updated_at TEXT NOT NULL
    ) STRICT`,
    `INSERT INTO experimental_feature_settings (
      id, payment_notifications_enabled, image_ocr_enabled, updated_at
    ) VALUES (1, 0, 0, '${SEEDED_AT}')`,
    `CREATE TABLE payment_notification_imports (
      id TEXT PRIMARY KEY NOT NULL,
      batch_hash TEXT NOT NULL UNIQUE,
      candidate_count INTEGER NOT NULL CHECK (candidate_count >= 0),
      imported_count INTEGER NOT NULL CHECK (imported_count >= 0),
      created_at TEXT NOT NULL
    ) STRICT`,
  ],
};
