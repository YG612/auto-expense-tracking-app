import type { PersonalizationSettings } from '../../domain/entities';
import type { DatabaseConnection } from '../types';
import {
  optionalString,
  requiredBoolean,
  requiredString,
} from './mappingHelpers';

export class PersonalizationSettingsRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async get(): Promise<PersonalizationSettings> {
    const result = await this.database.execute(
      `SELECT learning_enabled, updated_at
       FROM personalization_settings
       WHERE id = 1`,
    );
    const row = result.rows[0];

    if (row === undefined) {
      throw new Error('Personalization settings row is missing.');
    }

    return {
      learningEnabled: requiredBoolean(row, 'learning_enabled'),
      updatedAt: requiredString(row, 'updated_at'),
    };
  }

  async setLearningEnabled(
    learningEnabled: boolean,
    updatedAt: string,
  ): Promise<void> {
    await this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `UPDATE personalization_settings
         SET learning_enabled = ?, updated_at = ?
         WHERE id = 1`,
        [learningEnabled ? 1 : 0, updatedAt],
      );

      if (result.rowsAffected !== 1) {
        throw new Error('Personalization settings row is missing.');
      }
    });
  }

  async getPreferredSpeechEngineId(): Promise<string | undefined> {
    const result = await this.database.execute(
      `SELECT preferred_speech_engine_id
       FROM personalization_settings
       WHERE id = 1`,
    );
    const row = result.rows[0];

    if (row === undefined) {
      throw new Error('Personalization settings row is missing.');
    }

    const value = optionalString(row, 'preferred_speech_engine_id');
    return value === undefined || value.length === 0 ? undefined : value;
  }

  async setPreferredSpeechEngineId(
    engineId: string | undefined,
  ): Promise<void> {
    await this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `UPDATE personalization_settings
         SET preferred_speech_engine_id = ?
         WHERE id = 1`,
        [engineId ?? null],
      );

      if (result.rowsAffected !== 1) {
        throw new Error('Personalization settings row is missing.');
      }
    });
  }
}
