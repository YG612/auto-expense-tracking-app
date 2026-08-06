import type { Budget } from '../../domain/entities';
import type { DatabaseConnection } from '../types';
import { BaseRepository } from './BaseRepository';
import { budgetDefinition } from './entityDefinitions';

export class BudgetRepository extends BaseRepository<Budget> {
  constructor(database: DatabaseConnection) {
    super(database, budgetDefinition);
  }

  async listForMonth(year: number, month: number): Promise<Budget[]> {
    return this.select('year = ? AND month = ?', [year, month]);
  }
}
