import { fireEvent, render } from '@testing-library/react-native';

import App from '../app/App';
import type { DatabaseConnection } from '../database';
import { openMigratedTestDatabase } from './database/testDatabase';

describe('App', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('explains the local-first boundary before rendering the home route', async () => {
    const app = await render(<App databaseFactory={async () => database} />);

    expect(await app.findByText('账本默认只在你的设备上')).toBeOnTheScreen();
    await fireEvent.press(app.getByText('下一步'));
    expect(await app.findByText('识别结果先确认，再入账')).toBeOnTheScreen();
    await fireEvent.press(app.getByText('下一步'));
    expect(
      await app.findByText('本地优先，也意味着要主动备份'),
    ).toBeOnTheScreen();
    await fireEvent.press(app.getByText('开始记账'));

    expect(await app.findByText('本月结余')).toBeOnTheScreen();
    expect(app.getByText('预算进度')).toBeOnTheScreen();
    expect(app.getByText('本月分类排行')).toBeOnTheScreen();
    expect(app.getByText('最近交易')).toBeOnTheScreen();
    expect(app.getByText('本月尚未设置预算')).toBeOnTheScreen();

    const privacySettings = await database.execute<{
      onboarding_completed: number;
    }>('SELECT onboarding_completed FROM privacy_settings WHERE id = 1');
    expect(privacySettings.rows[0]?.onboarding_completed).toBe(1);
  }, 15_000);
});
