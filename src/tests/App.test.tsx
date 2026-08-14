import { fireEvent, render } from '@testing-library/react-native';

import App from '../app/App';
import { createRepositories, type DatabaseConnection } from '../database';
import { openMigratedTestDatabase } from './database/testDatabase';

describe('App', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('renders the initial home route', async () => {
    const app = await render(<App databaseFactory={async () => database} />);

    await fireEvent.press(await app.findByText('跳过引导'));

    expect(await app.findByText('本月结余')).toBeOnTheScreen();
    expect(app.getByText('预算进度')).toBeOnTheScreen();
    expect(app.getByText('本月分类排行')).toBeOnTheScreen();
    expect(app.getByText('最近交易')).toBeOnTheScreen();
    expect(app.getByText('本月尚未设置预算')).toBeOnTheScreen();
  }, 15_000);

  it('does not expose exact amounts on the home screen when hiding is enabled', async () => {
    await createRepositories(database).privacySettings.update(
      { hideAmounts: true, onboardingCompleted: true },
      '2026-08-14T10:00:00.000Z',
    );
    await database.execute(
      `INSERT INTO transactions (
        id, type, amount_minor, currency, occurred_at, account_id, source,
        confirmation_status, duplicate_status, created_at, updated_at, sync_status
      ) VALUES (
        'hidden-amount', 'EXPENSE', 12345, 'CNY', ?, 'account-cash', 'MANUAL',
        'CONFIRMED', 'NONE', ?, ?, 'LOCAL_ONLY'
      )`,
      [
        new Date().toISOString(),
        '2026-08-14T10:00:00.000Z',
        '2026-08-14T10:00:00.000Z',
      ],
    );

    const app = await render(<App databaseFactory={async () => database} />);

    expect(await app.findAllByText('••••')).not.toHaveLength(0);
    expect(app.queryByText('¥123.45')).toBeNull();
  }, 15_000);
});
