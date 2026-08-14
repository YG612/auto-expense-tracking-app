import { createId } from '../../utils/createId';
import type { DatabaseConnection } from '../types';
import { canonicalUtcTimestamp } from './transactionWriteIntegrity';

export const CURRENT_EXPERIENCE_VERSION = 'TRUSTED_INTELLIGENCE_V1';

export type ProductValueEventType =
  'ENTRY_STARTED' | 'CONFIRM_CLICK' | 'EDIT_OPEN';

export type ProductValueMetrics = {
  experienceVersion: string;
  startedSessions: number;
  successfulSessions: number;
  firstEntrySuccessRate: number;
  averageConfirmationOperations: number;
  sevenDayActiveBookkeepingDays: number;
  correctionRate: number;
};

export class ProductValueMetricsRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async record(input: {
    eventType: ProductValueEventType;
    sessionId: string;
    transactionId?: string;
    occurredAt: string;
    experienceVersion?: string;
  }): Promise<void> {
    const sessionId = input.sessionId.trim();
    const experienceVersion = (
      input.experienceVersion ?? CURRENT_EXPERIENCE_VERSION
    ).trim();
    if (sessionId.length === 0 || sessionId.length > 160) {
      throw new Error('Product metric session ID is invalid.');
    }
    if (experienceVersion.length === 0 || experienceVersion.length > 80) {
      throw new Error('Product metric experience version is invalid.');
    }
    await this.database.execute(
      `INSERT INTO product_value_events (
         id, event_type, experience_version, session_id, transaction_id,
         occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        createId('product-event'),
        input.eventType,
        experienceVersion,
        sessionId,
        input.transactionId ?? null,
        canonicalUtcTimestamp(input.occurredAt, 'occurredAt'),
      ],
    );
  }

  async summarize(
    experienceVersion = CURRENT_EXPERIENCE_VERSION,
    now: Date = new Date(),
  ): Promise<ProductValueMetrics> {
    const events = await this.database.execute<{
      event_type: ProductValueEventType;
      session_id: string;
      transaction_id: string | null;
    }>(
      `SELECT event_type, session_id, transaction_id
       FROM product_value_events
       WHERE experience_version = ?`,
      [experienceVersion],
    );
    const started = new Set(
      events.rows
        .filter(row => row.event_type === 'ENTRY_STARTED')
        .map(row => row.session_id),
    );
    const successful = new Set(
      events.rows
        .filter(
          row =>
            row.event_type === 'CONFIRM_CLICK' && row.transaction_id !== null,
        )
        .map(row => row.session_id),
    );
    const operations = events.rows.filter(
      row =>
        row.event_type === 'CONFIRM_CLICK' || row.event_type === 'EDIT_OPEN',
    ).length;
    const sevenDayStart = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    const activeDays = await this.database.execute<{ active_days: number }>(
      `SELECT COUNT(DISTINCT substr(occurred_at, 1, 10)) AS active_days
       FROM transactions
       WHERE confirmation_status = 'CONFIRMED'
         AND deleted_at IS NULL
         AND occurred_at >= ?
         AND occurred_at <= ?`,
      [sevenDayStart.toISOString(), now.toISOString()],
    );
    const correction = await this.database.execute<{
      confirmed_count: number;
      feedback_count: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM transactions
          WHERE confirmation_status = 'CONFIRMED'
            AND deleted_at IS NULL
            AND source IN ('TEXT', 'VOICE')) AS confirmed_count,
         (SELECT COUNT(*) FROM classification_feedback) AS feedback_count`,
    );
    const confirmedCount = correction.rows[0]?.confirmed_count ?? 0;
    const feedbackCount = correction.rows[0]?.feedback_count ?? 0;
    return {
      experienceVersion,
      startedSessions: started.size,
      successfulSessions: successful.size,
      firstEntrySuccessRate:
        started.size === 0 ? 0 : successful.size / started.size,
      averageConfirmationOperations:
        successful.size === 0 ? 0 : operations / successful.size,
      sevenDayActiveBookkeepingDays: activeDays.rows[0]?.active_days ?? 0,
      correctionRate: confirmedCount === 0 ? 0 : feedbackCount / confirmedCount,
    };
  }
}
