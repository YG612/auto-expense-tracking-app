import { fireEvent, render, waitFor } from '@testing-library/react-native';

import App from '../app/App';
import type { DatabaseConnection } from '../database';
import { openMigratedTestDatabase } from './database/testDatabase';

describe('BudgetSettingsScreen', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => database.close());

  it('saves the monthly total budget in integer minor units', async () => {
    const app = await render(<App databaseFactory={async () => database} />);
    await fireEvent.press(await app.findByText('跳过引导'));
    await fireEvent.press(await app.findByText('设置'));
    await fireEvent.press(await app.findByText('月度预算'));

    await fireEvent.changeText(
      await app.findByLabelText('全部支出预算'),
      '3000.50',
    );
    await fireEvent.press(app.getByText('保存本月预算'));
    expect(
      await app.findByText(
        '预算已保存在本机，首页、分析和本地洞察会立即使用。',
      ),
    ).toBeOnTheScreen();

    await waitFor(async () => {
      const result = await database.execute<{
        limit_minor: number;
        category_id: string | null;
      }>(
        `SELECT limit_minor, category_id FROM budgets
         WHERE category_id IS NULL`,
      );
      expect(result.rows).toEqual([
        { limit_minor: 300_050, category_id: null },
      ]);
    });
  }, 20_000);
});
