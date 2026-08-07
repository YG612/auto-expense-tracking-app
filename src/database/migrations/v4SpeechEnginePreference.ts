import type { Migration } from './Migration';

export const v4SpeechEnginePreference: Migration = {
  version: 4,
  name: 'speech_engine_preference',
  statements: [
    `ALTER TABLE personalization_settings
      ADD COLUMN preferred_speech_engine_id TEXT`,
  ],
};
