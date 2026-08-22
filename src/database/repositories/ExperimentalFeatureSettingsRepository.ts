import type { ExperimentalFeatureSettings } from '../../domain/entities';
import type { DatabaseConnection } from '../types';
import { canonicalUtcTimestamp } from './transactionWriteIntegrity';

type ExperimentalFeaturePatch = Partial<
  Pick<
    ExperimentalFeatureSettings,
    'paymentNotificationsEnabled' | 'imageOcrEnabled'
  >
>;

export class ExperimentalFeatureSettingsRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async get(): Promise<ExperimentalFeatureSettings> {
    const result = await this.database.execute<{
      payment_notifications_enabled: number;
      image_ocr_enabled: number;
      updated_at: string;
    }>(
      `SELECT payment_notifications_enabled, image_ocr_enabled, updated_at
       FROM experimental_feature_settings WHERE id = 1`,
    );
    const row = result.rows[0];
    if (row === undefined)
      throw new Error('Experimental feature settings are missing.');
    return {
      paymentNotificationsEnabled: row.payment_notifications_enabled === 1,
      imageOcrEnabled: row.image_ocr_enabled === 1,
      updatedAt: row.updated_at,
    };
  }

  async update(
    patch: ExperimentalFeaturePatch,
    updatedAt: string,
  ): Promise<ExperimentalFeatureSettings> {
    const current = await this.get();
    const next = { ...current, ...patch };
    const canonicalUpdatedAt = canonicalUtcTimestamp(updatedAt, 'updatedAt');
    await this.database.execute(
      `UPDATE experimental_feature_settings
       SET payment_notifications_enabled = ?, image_ocr_enabled = ?, updated_at = ?
       WHERE id = 1`,
      [
        next.paymentNotificationsEnabled ? 1 : 0,
        next.imageOcrEnabled ? 1 : 0,
        canonicalUpdatedAt,
      ],
    );
    return { ...next, updatedAt: canonicalUpdatedAt };
  }
}
