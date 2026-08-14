import type { Migration } from './Migration';

export const v10ImportMappingTemplates: Migration = {
  version: 10,
  name: 'import_mapping_templates',
  statements: [
    `CREATE TABLE import_mapping_templates (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      mapping_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT`,
  ],
};
