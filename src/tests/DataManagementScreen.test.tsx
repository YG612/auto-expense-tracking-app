import { fireEvent, render, waitFor } from '@testing-library/react-native';

import App from '../app/App';
import type { DatabaseConnection } from '../database';
import { openMigratedTestDatabase } from './database/testDatabase';

describe('DataManagementScreen', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
    await database.execute(
      `INSERT INTO transactions (
         id, type, amount_minor, currency, occurred_at, account_id, source,
         confirmation_status, duplicate_status, created_at, updated_at,
         sync_status
       ) VALUES (
         'transaction-data-management', 'EXPENSE', 1990, 'CNY',
         '2026-08-13T12:00:00.000Z', 'account-wechat', 'MANUAL',
         'CONFIRMED', 'NONE', '2026-08-13T12:00:00.000Z',
         '2026-08-13T12:00:00.000Z', 'LOCAL_ONLY'
       )`,
    );
  });

  afterEach(() => {
    database.close();
  });

  it('shows the deletion scope and requires the exact confirmation phrase', async () => {
    const app = await render(<App databaseFactory={async () => database} />);

    await fireEvent.press(await app.findByText('跳过引导'));
    await fireEvent.press(await app.findByText('设置'));
    await fireEvent.press(await app.findByText('数据管理'));

    expect(await app.findByText('你的数据留在本机')).toBeOnTheScreen();
    expect(app.getByText('已确认交易')).toBeOnTheScreen();
    expect(app.getAllByText('1').length).toBeGreaterThan(0);

    await fireEvent.press(app.getByText('删除本机全部账本数据'));
    expect(await app.findByText('此操作无法在 App 内撤销')).toBeOnTheScreen();

    const input = app.getByLabelText('删除全部数据确认短语');
    await fireEvent.changeText(input, '删除');
    await fireEvent.press(app.getByText('永久删除'));

    let count = await database.execute<{ count: number }>(
      'SELECT COUNT(*) AS count FROM transactions',
    );
    expect(count.rows[0]?.count).toBe(1);

    await fireEvent.changeText(input, '删除全部数据');
    await fireEvent.press(app.getByText('永久删除'));

    expect(
      await app.findByText(
        '本机账本数据已全部删除，系统分类和默认账户已恢复可用。',
      ),
    ).toBeOnTheScreen();
    await waitFor(async () => {
      count = await database.execute<{ count: number }>(
        'SELECT COUNT(*) AS count FROM transactions',
      );
      expect(count.rows[0]?.count).toBe(0);
    });
  }, 20_000);
});
