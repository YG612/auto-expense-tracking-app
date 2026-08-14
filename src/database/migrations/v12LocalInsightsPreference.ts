import type { Migration } from './Migration';

export const v12LocalInsightsPreference: Migration = {
  version: 12,
  name: 'local_insights_preference',
  statements: [
    `ALTER TABLE personalization_settings
       ADD COLUMN local_insights_enabled INTEGER NOT NULL DEFAULT 1
       CHECK (local_insights_enabled IN (0, 1))`,
  ],
};
