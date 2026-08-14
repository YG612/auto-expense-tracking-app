import {
  PRIVACY_LOCK_TIMEOUT_SECONDS,
  type PrivacyLockTimeoutSeconds,
  type PrivacySettings,
} from '../../domain/entities';
import type { DatabaseConnection } from '../types';
import {
  optionalString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from './mappingHelpers';
import { canonicalUtcTimestamp } from './transactionWriteIntegrity';

export class PrivacySettingsRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async get(): Promise<PrivacySettings> {
    const result = await this.database.execute(
      `SELECT app_lock_enabled, hide_amounts, lock_timeout_seconds,
              onboarding_completed, first_backup_reminder_dismissed,
              last_backup_at, updated_at
       FROM privacy_settings WHERE id = 1`,
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Privacy settings row is missing.');
    const timeout = requiredNumber(row, 'lock_timeout_seconds');
    if (
      !PRIVACY_LOCK_TIMEOUT_SECONDS.includes(
        timeout as PrivacyLockTimeoutSeconds,
      )
    ) {
      throw new Error('Privacy lock timeout is invalid.');
    }
    return {
      appLockEnabled: requiredBoolean(row, 'app_lock_enabled'),
      hideAmounts: requiredBoolean(row, 'hide_amounts'),
      lockTimeoutSeconds: timeout as PrivacyLockTimeoutSeconds,
      onboardingCompleted: requiredBoolean(row, 'onboarding_completed'),
      firstBackupReminderDismissed: requiredBoolean(
        row,
        'first_backup_reminder_dismissed',
      ),
      lastBackupAt: optionalString(row, 'last_backup_at'),
      updatedAt: requiredString(row, 'updated_at'),
    };
  }

  async update(
    patch: Partial<
      Pick<
        PrivacySettings,
        | 'appLockEnabled'
        | 'hideAmounts'
        | 'lockTimeoutSeconds'
        | 'onboardingCompleted'
        | 'firstBackupReminderDismissed'
        | 'lastBackupAt'
      >
    >,
    updatedAt: string,
  ): Promise<PrivacySettings> {
    const current = await this.get();
    const next = { ...current, ...patch };
    if (!PRIVACY_LOCK_TIMEOUT_SECONDS.includes(next.lockTimeoutSeconds)) {
      throw new Error('Privacy lock timeout is invalid.');
    }
    const canonicalUpdatedAt = canonicalUtcTimestamp(updatedAt, 'updatedAt');
    const lastBackupAt =
      next.lastBackupAt === undefined
        ? undefined
        : canonicalUtcTimestamp(next.lastBackupAt, 'lastBackupAt');
    await this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `UPDATE privacy_settings
         SET app_lock_enabled = ?, hide_amounts = ?, lock_timeout_seconds = ?,
             onboarding_completed = ?, first_backup_reminder_dismissed = ?,
             last_backup_at = ?, updated_at = ?
         WHERE id = 1`,
        [
          next.appLockEnabled ? 1 : 0,
          next.hideAmounts ? 1 : 0,
          next.lockTimeoutSeconds,
          next.onboardingCompleted ? 1 : 0,
          next.firstBackupReminderDismissed ? 1 : 0,
          lastBackupAt ?? null,
          canonicalUpdatedAt,
        ],
      );
      if (result.rowsAffected !== 1) {
        throw new Error('Privacy settings row is missing.');
      }
    });
    return this.get();
  }
}
