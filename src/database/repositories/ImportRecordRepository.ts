import type { ImportRecord } from '../../domain/entities';
import type { DatabaseConnection } from '../types';
import { BaseRepository } from './BaseRepository';
import { importRecordDefinition } from './entityDefinitions';

export class ImportRecordRepository extends BaseRepository<ImportRecord> {
  constructor(database: DatabaseConnection) {
    super(database, importRecordDefinition);
  }

  async listRecent(limit = 50): Promise<ImportRecord[]> {
    return this.select(undefined, [], this.definition.defaultOrderBy, limit);
  }
}
