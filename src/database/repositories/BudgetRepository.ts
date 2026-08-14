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

  async replaceForMonth(
    year: number,
    month: number,
    currency: string,
    budgets: readonly Budget[],
  ): Promise<void> {
    if (
      !Number.isInteger(year) ||
      year < 1970 ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      currency.length === 0 ||
      currency.length > 8
    ) {
      throw new Error('Invalid monthly budget scope.');
    }
    const categoryKeys = new Set<string>();
    for (const budget of budgets) {
      const categoryKey = budget.categoryId ?? '__TOTAL__';
      if (
        budget.year !== year ||
        budget.month !== month ||
        budget.currency !== currency ||
        budget.periodType !== 'MONTHLY' ||
        !Number.isSafeInteger(budget.limitMinor) ||
        budget.limitMinor <= 0 ||
        categoryKeys.has(categoryKey)
      ) {
        throw new Error('Invalid monthly budget entry.');
      }
      categoryKeys.add(categoryKey);
    }

    await this.database.transaction(async transaction => {
      await transaction.execute(
        `DELETE FROM budgets
         WHERE period_type = 'MONTHLY'
           AND year = ? AND month = ? AND currency = ?`,
        [year, month, currency],
      );
      for (const budget of budgets) {
        await this.insert(budget, transaction);
      }
    });
  }
}
