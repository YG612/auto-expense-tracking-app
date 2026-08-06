import { render } from '@testing-library/react-native';

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

  it('renders the initial home route', async () => {
    const app = await render(<App databaseFactory={async () => database} />);

    expect(await app.findByText('本月结余')).toBeOnTheScreen();
    expect(app.getByText('预算进度')).toBeOnTheScreen();
    expect(app.getByText('本月分类排行')).toBeOnTheScreen();
    expect(app.getByText('最近交易')).toBeOnTheScreen();
    expect(app.getByText('本月尚未设置预算')).toBeOnTheScreen();
  }, 15_000);
});
