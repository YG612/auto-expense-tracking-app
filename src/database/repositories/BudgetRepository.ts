import type { Budget } from '../../domain/entities';
import type { DatabaseConnection, SqlRow } from '../types';
import { BaseRepository } from './BaseRepository';
import { budgetDefinition } from './entityDefinitions';
import { optionalString } from './mappingHelpers';

type BudgetCategoryRow = SqlRow & {
  budget_category_parent_id: string | null;
};

type CategoryBudgetValidationRow = SqlRow & {
  id: string;
  parent_id: string | null;
  type: string;
  is_hidden: number;
};

function normalizedMonthlyBudgets(
  rows: readonly BudgetCategoryRow[],
): Budget[] {
  const normalized = new Map<
    string,
    { budget: Budget; primaryCategoryBudget: boolean }
  >();

  for (const row of rows) {
    const budget = budgetDefinition.fromRow(row);
    const parentId = optionalString(row, 'budget_category_parent_id');
    const effectiveCategoryId = parentId ?? budget.categoryId;
    const key = `${budget.periodType}\u0000${budget.currency}\u0000${effectiveCategoryId ?? '__TOTAL__'}`;
    const primaryCategoryBudget = parentId === undefined;
    const current = normalized.get(key);
    const effectiveBudget = { ...budget, categoryId: effectiveCategoryId };

    if (
      current === undefined ||
      (primaryCategoryBudget && !current.primaryCategoryBudget)
    ) {
      normalized.set(key, { budget: effectiveBudget, primaryCategoryBudget });
      continue;
    }
    if (current.primaryCategoryBudget || primaryCategoryBudget) continue;

    const combinedLimit = current.budget.limitMinor + budget.limitMinor;
    if (!Number.isSafeInteger(combinedLimit)) {
      throw new Error('Legacy category budgets exceed the supported range.');
    }
    normalized.set(key, {
      budget: { ...current.budget, limitMinor: combinedLimit },
      primaryCategoryBudget: false,
    });
  }

  return [...normalized.values()].map(entry => entry.budget);
}

export class BudgetRepository extends BaseRepository<Budget> {
  constructor(database: DatabaseConnection) {
    super(database, budgetDefinition);
  }

  async listForMonth(year: number, month: number): Promise<Budget[]> {
    const result = await this.database.execute<BudgetCategoryRow>(
      `SELECT
         ${budgetDefinition.columns.map(column => `budget.${column}`).join(', ')},
         category.parent_id AS budget_category_parent_id
       FROM budgets budget
       LEFT JOIN categories category ON category.id = budget.category_id
       WHERE budget.year = ? AND budget.month = ?
       ORDER BY budget.period_type, budget.currency, budget.category_id`,
      [year, month],
    );
    return normalizedMonthlyBudgets(result.rows);
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
      const requestedCategoryIds = budgets.flatMap(budget =>
        budget.categoryId === undefined ? [] : [budget.categoryId],
      );
      if (requestedCategoryIds.length > 0) {
        const placeholders = requestedCategoryIds.map(() => '?').join(', ');
        const result = await transaction.execute<CategoryBudgetValidationRow>(
          `SELECT id, parent_id, type, is_hidden
             FROM categories
            WHERE id IN (${placeholders})`,
          requestedCategoryIds,
        );
        const validIds = new Set(
          result.rows
            .filter(
              row =>
                row.parent_id === null &&
                row.type === 'EXPENSE' &&
                row.is_hidden === 0,
            )
            .map(row => row.id),
        );
        if (
          validIds.size !== requestedCategoryIds.length ||
          requestedCategoryIds.some(categoryId => !validIds.has(categoryId))
        ) {
          throw new Error(
            'Category budgets must use visible primary expense categories.',
          );
        }
      }

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
