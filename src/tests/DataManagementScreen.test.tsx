import { fireEvent, render } from '@testing-library/react-native';

import App from '../app/App';
import type { DatabaseConnection } from '../database';
import { openMigratedTestDatabase } from './database/testDatabase';

describe('DataManagementScreen', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
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
});
