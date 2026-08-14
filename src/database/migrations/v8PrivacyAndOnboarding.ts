import type { Migration } from './Migration';

const SEEDED_AT = '2026-08-13T00:00:00.000Z';

export const v8PrivacyAndOnboarding: Migration = {
  version: 8,
  name: 'privacy_and_onboarding',
  statements: [
    `CREATE TABLE privacy_settings (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      app_lock_enabled INTEGER NOT NULL DEFAULT 0
        CHECK (app_lock_enabled IN (0, 1)),
      hide_amounts INTEGER NOT NULL DEFAULT 0
        CHECK (hide_amounts IN (0, 1)),
      lock_timeout_seconds INTEGER NOT NULL DEFAULT 0
        CHECK (lock_timeout_seconds IN (0, 30, 60, 300)),
      onboarding_completed INTEGER NOT NULL DEFAULT 0
        CHECK (onboarding_completed IN (0, 1)),
      first_backup_reminder_dismissed INTEGER NOT NULL DEFAULT 0
        CHECK (first_backup_reminder_dismissed IN (0, 1)),
      last_backup_at TEXT,
      updated_at TEXT NOT NULL
    ) STRICT`,
    `INSERT INTO privacy_settings (
      id,
      app_lock_enabled,
      hide_amounts,
      lock_timeout_seconds,
      onboarding_completed,
      first_backup_reminder_dismissed,
      last_backup_at,
      updated_at
    ) VALUES (
      1,
      0,
      0,
      0,
      CASE
        WHEN EXISTS (SELECT 1 FROM transactions LIMIT 1)
          OR EXISTS (SELECT 1 FROM import_records LIMIT 1)
        THEN 1
        ELSE 0
      END,
      0,
      NULL,
      '${SEEDED_AT}'
    )`,
  ],
};
