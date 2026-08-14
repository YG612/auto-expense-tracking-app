import type { Budget } from '../../domain/entities';
import { createRepositories, type DatabaseConnection } from '../../database';
import { openMigratedTestDatabase } from './testDatabase';

const now = '2026-08-14T08:00:00.000Z';

function budget(id: string, categoryId?: string): Budget {
  return {
    id,
    periodType: 'MONTHLY',
    year: 2026,
    month: 8,
    categoryId,
    limitMinor: categoryId === undefined ? 300_000 : 80_000,
    currency: 'CNY',
    createdAt: now,
    updatedAt: now,
  };
}

describe('monthly budget settings repository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => database.close());

  it('atomically replaces total and category budgets without touching another month', async () => {
    const repositories = createRepositories(database);
    const category = (await repositories.categories.listVisible('EXPENSE'))[0]!;
    const september = { ...budget('budget-september'), month: 9 };
    await repositories.budgets.create(september);

    await repositories.budgets.replaceForMonth(2026, 8, 'CNY', [
      budget('budget-total'),
      budget('budget-category', category.id),
    ]);
    expect(await repositories.budgets.listForMonth(2026, 8)).toHaveLength(2);

    await repositories.budgets.replaceForMonth(2026, 8, 'CNY', [
      { ...budget('budget-total-new'), limitMinor: 250_000 },
    ]);
    expect(await repositories.budgets.listForMonth(2026, 8)).toMatchObject([
      { id: 'budget-total-new', limitMinor: 250_000 },
    ]);
    expect(await repositories.budgets.listForMonth(2026, 9)).toMatchObject([
      { id: 'budget-september' },
    ]);
  });

  it('rejects invalid or duplicate entries before deleting existing budgets', async () => {
    const repositories = createRepositories(database);
    await repositories.budgets.create(budget('budget-existing'));

    await expect(
      repositories.budgets.replaceForMonth(2026, 8, 'CNY', [
        budget('duplicate-a'),
        budget('duplicate-b'),
      ]),
    ).rejects.toThrow('Invalid monthly budget entry');
    expect(await repositories.budgets.listForMonth(2026, 8)).toMatchObject([
      { id: 'budget-existing' },
    ]);
  });
});
