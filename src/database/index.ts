import { openOpSqliteConnection } from './OpSqliteConnection';
import {
  protectLedgerStorage,
  type LedgerStorageProtection,
} from './LedgerStorageProtection';
import { configureDatabase, runMigrations } from './migrations/runMigrations';
import type { DatabaseConnection } from './types';

export const APP_DATABASE_NAME = 'qingji_ai.sqlite';

let appDatabasePromise: Promise<DatabaseConnection> | undefined;

type PathAwareDatabaseConnection = DatabaseConnection & {
  getDatabasePath(): string;
};

type AppDatabaseInitializationDependencies = {
  configure(database: DatabaseConnection): Promise<unknown>;
  migrate(database: DatabaseConnection): Promise<unknown>;
  protect: LedgerStorageProtection;
};

const defaultInitializationDependencies: AppDatabaseInitializationDependencies =
  {
    configure: configureDatabase,
    migrate: runMigrations,
    protect: protectLedgerStorage,
  };

export async function initializeAppDatabaseConnection(
  database: PathAwareDatabaseConnection,
  dependencies: AppDatabaseInitializationDependencies = defaultInitializationDependencies,
): Promise<DatabaseConnection> {
  const databasePath = database.getDatabasePath();

  await dependencies.protect(databasePath);
  try {
    await dependencies.configure(database);
  } finally {
    // Enabling WAL may create the first sidecar files even when a later pragma fails.
    await dependencies.protect(databasePath);
  }
  try {
    await dependencies.migrate(database);
  } finally {
    // Migration writes create WAL/SHM on a fresh install. Reapply on every launch.
    await dependencies.protect(databasePath);
  }

  return database;
}

async function createAppDatabase(): Promise<DatabaseConnection> {
  const database = openOpSqliteConnection({ name: APP_DATABASE_NAME });

  try {
    return await initializeAppDatabaseConnection(database);
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
