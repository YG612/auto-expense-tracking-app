import type { PersonalizationSettings } from '../../domain/entities';
import type { DatabaseConnection } from '../types';
import { requiredBoolean, requiredString } from './mappingHelpers';
import { canonicalUtcTimestamp } from './transactionWriteIntegrity';

export class PersonalizationSettingsRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async get(): Promise<PersonalizationSettings> {
    const result = await this.database.execute(
      `SELECT learning_enabled, retain_original_text, updated_at
       FROM personalization_settings
       WHERE id = 1`,
    );
    const row = result.rows[0];

    if (row === undefined) {
      throw new Error('Personalization settings row is missing.');
    }

    return {
      learningEnabled: requiredBoolean(row, 'learning_enabled'),
      retainOriginalText: requiredBoolean(row, 'retain_original_text'),
      updatedAt: requiredString(row, 'updated_at'),
    };
  }

  async setLearningEnabled(
    learningEnabled: boolean,
    updatedAt: string,
  ): Promise<void> {
    const canonicalUpdatedAt = canonicalUtcTimestamp(updatedAt, 'updatedAt');
    await this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `UPDATE personalization_settings
         SET learning_enabled = ?, updated_at = ?
         WHERE id = 1`,
        [learningEnabled ? 1 : 0, canonicalUpdatedAt],
      );

      if (result.rowsAffected !== 1) {
        throw new Error('Personalization settings row is missing.');
      }
    });
  }

  async setRetainOriginalText(
    retainOriginalText: boolean,
    updatedAt: string,
  ): Promise<void> {
    const canonicalUpdatedAt = canonicalUtcTimestamp(updatedAt, 'updatedAt');
    await this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `UPDATE personalization_settings
         SET retain_original_text = ?, updated_at = ?
         WHERE id = 1`,
        [retainOriginalText ? 1 : 0, canonicalUpdatedAt],
      );

      if (result.rowsAffected !== 1) {
        throw new Error('Personalization settings row is missing.');
      }

      if (!retainOriginalText) {
        await transaction.execute(
          `UPDATE transactions
           SET original_text = NULL,
               revision = revision + 1,
               updated_at = CASE
                 WHEN updated_at > ? THEN updated_at
                 ELSE ?
               END,
               sync_status = CASE
                 WHEN sync_status = 'LOCAL_ONLY' THEN 'LOCAL_ONLY'
                 ELSE 'PENDING'
               END
           WHERE original_text IS NOT NULL`,
          [canonicalUpdatedAt, canonicalUpdatedAt],
        );
        await transaction.execute(
          `UPDATE classification_feedback
           SET source_text = NULL
           WHERE source_text IS NOT NULL`,
        );
      }
    });
  }
}
