import type { DatabaseConnection, SqlRow } from '../types';
import type { Migration } from './Migration';
import { v1InitialSchema } from './v1InitialSchema';
import { v2SeedReferenceData } from './v2SeedReferenceData';
import { v3PersonalizationLearning } from './v3PersonalizationLearning';
import { v4LedgerIntegrityAndPrivacy } from './v4LedgerIntegrityAndPrivacy';
import { v5PendingReviewSafety } from './v5PendingReviewSafety';
import { v6VoiceOperationReceipts } from './v6VoiceOperationReceipts';
import { v7StatementImports } from './v7StatementImports';

type AppliedMigrationRow = SqlRow & {
  version: number;
  name: string;
};

const CREATE_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT`;

export const MIGRATIONS: readonly Migration[] = [
  v1InitialSchema,
  v2SeedReferenceData,
  v3PersonalizationLearning,
  v4LedgerIntegrityAndPrivacy,
  v5PendingReviewSafety,
  v6VoiceOperationReceipts,
  v7StatementImports,
];

function validateMigrations(migrations: readonly Migration[]): void {
  let previousVersion = 0;

  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Invalid migration version: ${migration.version}`);
    }

    if (migration.version <= previousVersion) {
      throw new Error('Migrations must have unique, ascending versions.');
    }

    if (migration.statements.length === 0) {
      throw new Error(`Migration ${migration.version} has no statements.`);
    }

    previousVersion = migration.version;
  }
}

export async function configureDatabase(
  database: DatabaseConnection,
): Promise<void> {
  await database.execute('PRAGMA foreign_keys = ON');
  await database.execute('PRAGMA journal_mode = WAL');
  await database.execute('PRAGMA synchronous = FULL');
  await database.execute('PRAGMA busy_timeout = 5000');
}

export async function runMigrations(
  database: DatabaseConnection,
  migrations: readonly Migration[] = MIGRATIONS,
  now: () => string = () => new Date().toISOString(),
): Promise<number[]> {
  validateMigrations(migrations);

  await database.transaction(async transaction => {
    await transaction.execute(CREATE_MIGRATIONS_TABLE);
  });

  const appliedResult = await database.transaction(transaction =>
    transaction.execute<AppliedMigrationRow>(
      'SELECT version, name FROM schema_migrations ORDER BY version ASC',
    ),
  );
  const appliedByVersion = new Map(
    appliedResult.rows.map(row => [Number(row.version), String(row.name)]),
  );
  const knownByVersion = new Map(
    migrations.map(migration => [migration.version, migration.name]),
  );
  const latestKnownVersion = migrations.at(-1)?.version ?? 0;
  const latestAppliedVersion = Math.max(0, ...appliedByVersion.keys());

  if (latestAppliedVersion > latestKnownVersion) {
    throw new Error(
      `Database version ${latestAppliedVersion} is newer than supported version ${latestKnownVersion}.`,
    );
  }

  for (const [version, appliedName] of appliedByVersion) {
    const knownName = knownByVersion.get(version);

    if (knownName === undefined) {
      throw new Error(
        `Database contains unknown migration version ${version}.`,
      );
    }

    if (knownName !== appliedName) {
      throw new Error(
        `Migration ${version} name mismatch: expected ${knownName}, found ${appliedName}.`,
      );
    }
  }

  const appliedNow: number[] = [];

  for (const migration of migrations) {
    const appliedName = appliedByVersion.get(migration.version);

    if (appliedName !== undefined) {
      continue;
    }

    await database.transaction(async transaction => {
      for (const statement of migration.statements) {
        await transaction.execute(statement);
      }

      await transaction.execute(
        `INSERT INTO schema_migrations (version, name, applied_at)
         VALUES (?, ?, ?)`,
        [migration.version, migration.name, now()],
      );
      await transaction.execute(`PRAGMA user_version = ${migration.version}`);
    });

    appliedNow.push(migration.version);
  }

  return appliedNow;
}
