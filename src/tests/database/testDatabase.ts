import {
  configureDatabase,
  openOpSqliteConnection,
  runMigrations,
  type DatabaseConnection,
} from '../../database';

export function openTestDatabase(): DatabaseConnection {
  return openOpSqliteConnection({
    name: 'qingji_ai_test.sqlite',
    location: ':memory:',
  });
}

export async function openMigratedTestDatabase(): Promise<DatabaseConnection> {
  const database = openTestDatabase();
  await configureDatabase(database);
  await runMigrations(database, undefined, () => '2026-07-20T00:00:00.000Z');
  return database;
}
