import { fireEvent, render } from '@testing-library/react-native';
import { NativeModules } from 'react-native';

import App from '../app/App';
import type { DatabaseConnection } from '../database';
import { openMigratedTestDatabase } from './database/testDatabase';

describe('DataManagementScreen', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
    delete NativeModules.PrivacyProtection;
    database.close();
  });

  it('is reachable from settings and explains both local export paths', async () => {
    const app = await render(<App databaseFactory={async () => database} />);

    await fireEvent.press(await app.findByText('跳过引导'));
    await fireEvent.press(await app.findByText('设置'));
    await fireEvent.press(await app.findByText('导出与加密备份'));

    expect(await app.findByText('导出与备份')).toBeOnTheScreen();
    expect(app.getByText('导出 CSV')).toBeOnTheScreen();
    expect(app.getByText('加密备份与恢复')).toBeOnTheScreen();
    expect(app.getByText('创建备份')).toBeOnTheScreen();
    expect(app.getByText('从备份恢复')).toBeOnTheScreen();
  });

  it('requires the confirmation phrase and system authentication before erasing', async () => {
    await database.execute(
      `INSERT INTO transactions (
         id, type, amount_minor, currency, occurred_at, source,
         confirmation_status, duplicate_status, created_at, updated_at,
         sync_status
       ) VALUES (
         'erase-from-ui', 'EXPENSE', 100, 'CNY',
         '2026-08-22T10:00:00.000Z', 'MANUAL', 'CONFIRMED', 'NONE',
         '2026-08-22T10:00:00.000Z', '2026-08-22T10:00:00.000Z', 'LOCAL_ONLY'
       )`,
    );
    const authenticate = jest.fn(async () => ({
      status: 'AUTHENTICATED' as const,
    }));
    NativeModules.PrivacyProtection = {
      getCapabilities: jest.fn(async () => ({
        available: true,
        method: 'DEVICE_OWNER_AUTHENTICATION' as const,
      })),
      authenticate,
      setScreenCaptureProtected: jest.fn(async () => undefined),
      hidePrivacyOverlay: jest.fn(async () => undefined),
    };
    const app = await render(<App databaseFactory={async () => database} />);
    await fireEvent.press(await app.findByText('跳过引导'));
    await fireEvent.press(await app.findByText('设置'));
    await fireEvent.press(await app.findByText('导出与加密备份'));
    await fireEvent.press(await app.findByLabelText('开始删除全部本机数据'));

    expect(await app.findByText('最后确认删除')).toBeOnTheScreen();
    expect(authenticate).not.toHaveBeenCalled();
    await fireEvent.changeText(
      app.getByLabelText('删除全部数据确认语句'),
      '删除全部数据',
    );
    await fireEvent.press(app.getByText('验证身份并删除'));

    expect(await app.findByText('账本默认只在你的设备上')).toBeOnTheScreen();
    expect(authenticate).toHaveBeenCalledWith(
      '验证身份以删除轻记 AI 的全部本机数据',
    );
    const remaining = await database.execute<{ count: number }>(
      'SELECT COUNT(*) AS count FROM transactions',
    );
    expect(remaining.rows[0]?.count).toBe(0);
  }, 20_000);
});
