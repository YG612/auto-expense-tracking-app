import type { Migration } from './Migration';

export const v14RecurringMonthlyAnchors: Migration = {
  version: 14,
  name: 'recurring_monthly_anchors',
  statements: [
    `ALTER TABLE recurring_templates
      ADD COLUMN monthly_anchor_day INTEGER
      CHECK (monthly_anchor_day IS NULL OR monthly_anchor_day BETWEEN 1 AND 31)`,
    `ALTER TABLE recurring_templates
      ADD COLUMN monthly_anchor_is_end_of_month INTEGER
      CHECK (
        monthly_anchor_is_end_of_month IS NULL OR
        monthly_anchor_is_end_of_month IN (0, 1)
      )`,
    `UPDATE recurring_templates
      SET monthly_anchor_day = CAST(strftime('%d', next_occurrence_at) AS INTEGER),
          monthly_anchor_is_end_of_month = CASE
            WHEN date(next_occurrence_at) = date(
              next_occurrence_at,
              'start of month',
              '+1 month',
              '-1 day'
            ) THEN 1
            ELSE 0
          END
      WHERE cadence = 'MONTHLY'`,
  ],
};
