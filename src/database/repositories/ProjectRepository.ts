import type { Project } from '../../domain/entities';
import type { DatabaseConnection } from '../types';
import { BaseRepository } from './BaseRepository';
import { projectDefinition } from './entityDefinitions';

export class ProjectRepository extends BaseRepository<Project> {
  constructor(database: DatabaseConnection) {
    super(database, projectDefinition);
  }

  async listActive(): Promise<Project[]> {
    return this.select('is_archived = 0');
  }

  async findByName(name: string): Promise<Project | undefined> {
    const rows = await this.select('name = ? COLLATE NOCASE', [name], '', 1);
    return rows[0];
  }
}
