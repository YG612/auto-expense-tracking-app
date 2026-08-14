import type {
  StatementColumnMapping,
  StatementField,
} from '../../importers/types';
import type { DatabaseConnection, SqlRow } from '../types';
import { canonicalUtcTimestamp } from './transactionWriteIntegrity';

const FIELDS: readonly StatementField[] = [
  'occurredAt',
  'type',
  'amount',
  'merchant',
  'account',
  'sourceReferenceId',
  'note',
];

export type ImportMappingTemplate = {
  id: string;
  name: string;
  mapping: StatementColumnMapping;
  createdAt: string;
  updatedAt: string;
};

function validatedMapping(raw: string): StatementColumnMapping {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Import mapping template is invalid.');
  }
  const record = value as Record<string, unknown>;
  const mapping: StatementColumnMapping = {};
  for (const field of FIELDS) {
    const column = record[field];
    if (column !== undefined) {
      if (typeof column !== 'string' || column.trim().length === 0) {
        throw new Error('Import mapping template contains an invalid column.');
      }
      mapping[field] = column.trim();
    }
  }
  if (mapping.occurredAt === undefined || mapping.amount === undefined) {
    throw new Error(
      'Import mapping template requires date and amount columns.',
    );
  }
  return mapping;
}

export class ImportMappingTemplateRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async list(): Promise<ImportMappingTemplate[]> {
    const result = await this.database.execute<
      SqlRow & {
        id: string;
        name: string;
        mapping_json: string;
        created_at: string;
        updated_at: string;
      }
    >(
      'SELECT * FROM import_mapping_templates ORDER BY updated_at DESC, name ASC',
    );
    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      mapping: validatedMapping(row.mapping_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async save(template: ImportMappingTemplate): Promise<void> {
    const name = template.name.trim();
    if (name.length === 0 || name.length > 80)
      throw new Error('映射模板名称无效。');
    const mapping = validatedMapping(JSON.stringify(template.mapping));
    const createdAt = canonicalUtcTimestamp(template.createdAt, 'createdAt');
    const updatedAt = canonicalUtcTimestamp(template.updatedAt, 'updatedAt');
    await this.database.execute(
      `INSERT INTO import_mapping_templates (
         id, name, mapping_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         mapping_json = excluded.mapping_json,
         updated_at = excluded.updated_at`,
      [template.id, name, JSON.stringify(mapping), createdAt, updatedAt],
    );
  }

  async delete(id: string): Promise<void> {
    await this.database.execute(
      'DELETE FROM import_mapping_templates WHERE id = ?',
      [id],
    );
  }
}
