import { openOpSqliteConnection } from './OpSqliteConnection';
import { configureDatabase, runMigrations } from './migrations/runMigrations';
import type { DatabaseConnection } from './types';

export const APP_DATABASE_NAME = 'qingji_ai.sqlite';

let appDatabasePromise: Promise<DatabaseConnection> | undefined;

async function createAppDatabase(): Promise<DatabaseConnection> {
  const database = openOpSqliteConnection({ name: APP_DATABASE_NAME });

  try {
    await configureDatabase(database);
    await runMigrations(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function getAppDatabase(): Promise<DatabaseConnection> {
  if (appDatabasePromise === undefined) {
    appDatabasePromise = createAppDatabase().catch(error => {
      appDatabasePromise = undefined;
      throw error;
    });
  }

  return appDatabasePromise;
}

export async function closeAppDatabase(): Promise<void> {
  if (appDatabasePromise === undefined) {
    return;
  }

  const database = await appDatabasePromise;
  database.close();
  appDatabasePromise = undefined;
}

export { openOpSqliteConnection } from './OpSqliteConnection';
export { configureDatabase, runMigrations } from './migrations/runMigrations';
export * from './repositories';
export type { Migration } from './migrations/Migration';
export type {
  DatabaseConnection,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlValue,
} from './types';
