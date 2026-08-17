import type { ModelShadowObservation } from '../../domain/entities';
import type { DatabaseConnection } from '../types';
import { BaseRepository } from './BaseRepository';
import { modelShadowObservationDefinition } from './entityDefinitions';

export interface ShadowObservationSummary {
  modelVersion: string;
  observationCount: number;
  matchedCount: number;
  firstObservedAt?: string;
  lastObservedAt?: string;
}

export class ModelShadowObservationRepository extends BaseRepository<ModelShadowObservation> {
  constructor(database: DatabaseConnection) {
    super(database, modelShadowObservationDefinition);
  }

  async record(observation: ModelShadowObservation): Promise<boolean> {
    const values = modelShadowObservationDefinition.toValues(observation);
    const columns = modelShadowObservationDefinition.columns;
    const result = await this.database.transaction(transaction =>
      transaction.execute(
        `INSERT OR IGNORE INTO model_shadow_observations (${columns.join(', ')})
         VALUES (${columns.map(() => '?').join(', ')})`,
        columns.map(column => values[column]),
      ),
    );
    return result.rowsAffected === 1;
  }

  async listForModel(
    modelVersion: string,
    limit = 5_000,
  ): Promise<ModelShadowObservation[]> {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 5_000) {
      throw new Error('Shadow observation limit must be between 1 and 5000.');
    }
    return this.select(
      'model_version = ?',
      [modelVersion],
      'created_at ASC',
      limit,
    );
  }

  async summary(modelVersion: string): Promise<ShadowObservationSummary> {
    const result = await this.database.execute<{
      observation_count: number;
      matched_count: number;
      first_observed_at: string | null;
      last_observed_at: string | null;
    }>(
      `SELECT COUNT(*) AS observation_count,
              COALESCE(SUM(matched), 0) AS matched_count,
              MIN(created_at) AS first_observed_at,
              MAX(created_at) AS last_observed_at
       FROM model_shadow_observations
       WHERE model_version = ?`,
      [modelVersion],
    );
    const row = result.rows[0];
    return {
      modelVersion,
      observationCount: Number(row?.observation_count ?? 0),
      matchedCount: Number(row?.matched_count ?? 0),
      firstObservedAt:
        typeof row?.first_observed_at === 'string'
          ? row.first_observed_at
          : undefined,
      lastObservedAt:
        typeof row?.last_observed_at === 'string'
          ? row.last_observed_at
          : undefined,
    };
  }

  async latestSummary(): Promise<ShadowObservationSummary | undefined> {
    const result = await this.database.execute<{
      model_version: string;
      observation_count: number;
      matched_count: number;
      first_observed_at: string;
      last_observed_at: string;
    }>(
      `SELECT model_version,
              COUNT(*) AS observation_count,
              COALESCE(SUM(matched), 0) AS matched_count,
              MIN(created_at) AS first_observed_at,
              MAX(created_at) AS last_observed_at
       FROM model_shadow_observations
       GROUP BY model_version
       ORDER BY last_observed_at DESC, model_version ASC
       LIMIT 1`,
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      modelVersion: row.model_version,
      observationCount: Number(row.observation_count),
      matchedCount: Number(row.matched_count),
      firstObservedAt: row.first_observed_at,
      lastObservedAt: row.last_observed_at,
    };
  }

  async exportJsonl(modelVersion: string): Promise<string> {
    const observations = await this.listForModel(modelVersion);
    return `${observations
      .map(observation =>
        JSON.stringify({ ...observation, autoCommitted: false }),
      )
      .join('\n')}\n`;
  }
}
