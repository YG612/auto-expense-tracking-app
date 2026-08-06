import type { Tag } from '../../domain/entities';
import type { DatabaseConnection } from '../types';
import { BaseRepository } from './BaseRepository';
import { tagDefinition } from './entityDefinitions';

export class TagRepository extends BaseRepository<Tag> {
  constructor(database: DatabaseConnection) {
    super(database, tagDefinition);
  }

  async findByName(name: string): Promise<Tag | undefined> {
    const rows = await this.select('name = ? COLLATE NOCASE', [name], '', 1);
    return rows[0];
  }
}
