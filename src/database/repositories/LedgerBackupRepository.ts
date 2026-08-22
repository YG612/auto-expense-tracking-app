import { sha256 } from '../../utils/sha256';
import { utf8ByteLength } from '../../utils/utf8ByteLength';
import { AppError } from '../../domain/errors/AppError';
import type {
  DatabaseConnection,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from '../types';
import { requiredNumber } from './mappingHelpers';
import { canonicalUtcTimestamp } from './transactionWriteIntegrity';

export const LEDGER_BACKUP_FORMAT = 'qingji-ai-ledger-backup';
export const LEDGER_BACKUP_FORMAT_VERSION = 1;
export const MAX_LEDGER_BACKUP_BYTES = 32 * 1024 * 1024;
const MAX_BACKUP_ROWS = 1_000_000;

type JsonScalar = string | number | null;
type BackupRow = Record<string, JsonScalar>;

type TableSpecification = {
  name: string;
  orderBy: string;
  introducedInSchemaVersion?: number;
  legacyRows?: readonly BackupRow[];
};

const TABLES: readonly TableSpecification[] = [
  { name: 'categories', orderBy: 'parent_id IS NOT NULL, sort_order, id' },
  { name: 'accounts', orderBy: 'sort_order, id' },
  { name: 'projects', orderBy: 'id' },
  { name: 'merchants', orderBy: 'id' },
  { name: 'tags', orderBy: 'id' },
  {
    name: 'personalization_settings',
    orderBy: 'id',
    introducedInSchemaVersion: 3,
    legacyRows: [
      {
        id: 1,
        learning_enabled: 1,
        retain_original_text: 1,
        updated_at: '2026-08-13T00:00:00.000Z',
      },
    ],
  },
  {
    name: 'experimental_feature_settings',
    orderBy: 'id',
    introducedInSchemaVersion: 10,
    legacyRows: [
      {
        id: 1,
        payment_notifications_enabled: 0,
        image_ocr_enabled: 0,
        updated_at: '2026-08-14T00:00:00.000Z',
      },
    ],
  },
  {
    name: 'privacy_settings',
    orderBy: 'id',
    introducedInSchemaVersion: 8,
    legacyRows: [
      {
        id: 1,
        app_lock_enabled: 0,
        hide_amounts: 0,
        lock_timeout_seconds: 0,
        onboarding_completed: 1,
        first_backup_reminder_dismissed: 0,
        last_backup_at: null,
        updated_at: '2026-08-13T00:00:00.000Z',
      },
    ],
  },
  { name: 'transactions', orderBy: 'occurred_at, id' },
  {
    name: 'model_shadow_observations',
    orderBy: 'created_at, id',
    introducedInSchemaVersion: 12,
  },
  { name: 'user_rules', orderBy: 'id' },
  { name: 'budgets', orderBy: 'id' },
  {
    name: 'recurring_templates',
    orderBy: 'next_occurrence_at, id',
    introducedInSchemaVersion: 9,
  },
  { name: 'import_records', orderBy: 'id' },
  {
    name: 'payment_notification_imports',
    orderBy: 'created_at, id',
    introducedInSchemaVersion: 10,
  },
  {
    name: 'import_mapping_templates',
    orderBy: 'updated_at, name, id',
    introducedInSchemaVersion: 7,
  },
  { name: 'transaction_tags', orderBy: 'transaction_id, tag_id' },
  { name: 'classification_feedback', orderBy: 'id' },
  {
    name: 'learned_rule_suppressions',
    orderBy: 'rule_type, pattern',
    introducedInSchemaVersion: 3,
  },
  {
    name: 'recognized_operation_receipts',
    orderBy: 'source, source_reference_id',
    introducedInSchemaVersion: 6,
  },
  {
    name: 'agent_operation_receipts',
    orderBy: 'caller_id, idempotency_key',
    introducedInSchemaVersion: 11,
  },
] as const;

const DELETE_ORDER = [...TABLES].reverse();
const TABLE_NAMES = new Set(TABLES.map(table => table.name));

function tableIsRequired(
  table: TableSpecification,
  schemaVersion: number,
): boolean {
  return (table.introducedInSchemaVersion ?? 1) <= schemaVersion;
}

export type LedgerBackupPayload = {
  format: typeof LEDGER_BACKUP_FORMAT;
  formatVersion: typeof LEDGER_BACKUP_FORMAT_VERSION;
  schemaVersion: number;
  createdAt: string;
  appVersion: string;
  tables: Record<string, BackupRow[]>;
  counts: Record<string, number>;
};

export type LedgerBackupDocument = LedgerBackupPayload & {
  integrity: {
    algorithm: 'SHA-256';
    digest: string;
  };
};

export type LedgerRestoreResult = {
  restoredAt: string;
  schemaVersion: number;
  rowCount: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Backup contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  throw new Error('Backup contains an unsupported value.');
}

function toBackupRow(row: SqlRow): BackupRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (value === null || typeof value === 'string') return [key, value];
      if (typeof value === 'number' && Number.isFinite(value))
        return [key, value];
      throw new Error(`Backup column ${key} contains an unsupported value.`);
    }),
  );
}

function removeDeviceLocalConsent(
  table: string,
  rows: readonly BackupRow[],
): BackupRow[] {
  if (table !== 'experimental_feature_settings') {
    return rows.map(row => ({ ...row }));
  }
  return rows.map(row => ({
    ...row,
    // Notification-listener consent belongs to the current device and must
    // never travel with a ledger backup or be re-enabled by a restore.
    payment_notifications_enabled: 0,
  }));
}

function validatePayload(value: unknown): LedgerBackupPayload {
  if (!isObject(value)) throw new Error('Backup root is invalid.');
  if (value.format !== LEDGER_BACKUP_FORMAT)
    throw new Error('Backup format is not supported.');
  if (value.formatVersion !== LEDGER_BACKUP_FORMAT_VERSION) {
    throw new Error('Backup format version is not supported.');
  }
  if (
    !Number.isInteger(value.schemaVersion) ||
    Number(value.schemaVersion) <= 0
  ) {
    throw new Error('Backup schema version is invalid.');
  }
  if (
    typeof value.createdAt !== 'string' ||
    typeof value.appVersion !== 'string'
  ) {
    throw new Error('Backup metadata is invalid.');
  }
  canonicalUtcTimestamp(value.createdAt, 'backup.createdAt');
  if (!isObject(value.tables) || !isObject(value.counts)) {
    throw new Error('Backup table data is invalid.');
  }

  const schemaVersion = Number(value.schemaVersion);
  const actualNames = Object.keys(value.tables).sort();
  const actualCountNames = Object.keys(value.counts).sort();
  if (
    actualNames.some(name => !TABLE_NAMES.has(name)) ||
    actualCountNames.some(name => !TABLE_NAMES.has(name)) ||
    TABLES.some(
      table =>
        tableIsRequired(table, schemaVersion) &&
        (!actualNames.includes(table.name) ||
          !actualCountNames.includes(table.name)),
    )
  ) {
    throw new Error(
      'Backup table set is incomplete or contains unknown tables.',
    );
  }

  let totalRows = 0;
  const tables: Record<string, BackupRow[]> = {};
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const hasRows = Object.prototype.hasOwnProperty.call(
      value.tables,
      table.name,
    );
    const hasCount = Object.prototype.hasOwnProperty.call(
      value.counts,
      table.name,
    );
    if (!hasRows && !hasCount && !tableIsRequired(table, schemaVersion)) {
      const legacyRows = (table.legacyRows ?? []).map(row => ({ ...row }));
      tables[table.name] = legacyRows;
      counts[table.name] = legacyRows.length;
      continue;
    }
    const rows = value.tables[table.name];
    const count = value.counts[table.name];
    if (
      !Array.isArray(rows) ||
      !Number.isInteger(count) ||
      count !== rows.length
    ) {
      throw new Error(`Backup count for ${table.name} is invalid.`);
    }
    totalRows += rows.length;
    if (totalRows > MAX_BACKUP_ROWS)
      throw new Error('Backup contains too many rows.');
    tables[table.name] = rows.map((row, index) => {
      if (!isObject(row))
        throw new Error(`Backup row ${table.name}[${index}] is invalid.`);
      return toBackupRow(row as SqlRow);
    });
    counts[table.name] = count;
  }

  return {
    format: LEDGER_BACKUP_FORMAT,
    formatVersion: LEDGER_BACKUP_FORMAT_VERSION,
    schemaVersion,
    createdAt: value.createdAt,
    appVersion: value.appVersion,
    tables,
    counts,
  };
}

export function serializeLedgerBackupPayload(
  payload: LedgerBackupPayload,
): string {
  const validated = validatePayload(payload);
  const document: LedgerBackupDocument = {
    ...validated,
    integrity: {
      algorithm: 'SHA-256',
      digest: sha256(canonicalJson(validated)),
    },
  };
  const content = canonicalJson(document);
  if (utf8ByteLength(content) > MAX_LEDGER_BACKUP_BYTES) {
    throw new AppError(
      'BACKUP-SIZE-LIMIT',
      '账本备份超过 32 MiB 上限，请改用分批 CSV 导出。',
      { category: 'VALIDATION', retryable: false },
    );
  }
  return content;
}

export function parseLedgerBackupDocument(
  content: string,
): LedgerBackupDocument {
  if (
    content.length === 0 ||
    utf8ByteLength(content) > MAX_LEDGER_BACKUP_BYTES
  ) {
    throw new AppError(
      'BACKUP-SIZE-LIMIT',
      '账本备份超过 32 MiB 上限，请改用分批 CSV 导出。',
      { category: 'VALIDATION', retryable: false },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Backup file is not valid JSON.');
  }
  if (!isObject(parsed) || !isObject(parsed.integrity)) {
    throw new Error('Backup integrity metadata is missing.');
  }
  if (
    parsed.integrity.algorithm !== 'SHA-256' ||
    typeof parsed.integrity.digest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(parsed.integrity.digest)
  ) {
    throw new Error('Backup integrity metadata is invalid.');
  }

  const { integrity, ...payloadValue } = parsed;
  const payload = validatePayload(payloadValue);
  // Verify the exact payload that was signed. Validation may append empty
  // tables introduced after an older backup's schema version.
  const expectedDigest = sha256(canonicalJson(payloadValue));
  if (expectedDigest !== integrity.digest) {
    throw new Error('Backup integrity check failed.');
  }

  return {
    ...payload,
    integrity: { algorithm: 'SHA-256', digest: expectedDigest },
  };
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function liveColumns(
  executor: SqlExecutor,
  table: string,
): Promise<string[]> {
  const result = await executor.execute<{ name: string }>(
    `SELECT name FROM pragma_table_info(?) ORDER BY cid`,
    [table],
  );
  return result.rows.map(row => String(row.name));
}

async function insertRows(
  transaction: SqlExecutor,
  table: string,
  rows: BackupRow[],
): Promise<void> {
  const columns = await liveColumns(transaction, table);
  if (columns.length === 0)
    throw new Error(`Restore table ${table} is missing.`);
  for (const [index, row] of rows.entries()) {
    const unknown = Object.keys(row).filter(
      column => !columns.includes(column),
    );
    if (unknown.length > 0) {
      throw new Error(
        `Backup columns for ${table}[${index}] are newer than this app version.`,
      );
    }
  }
  if (rows.length === 0) return;

  for (const row of rows) {
    const restoredColumns = columns.filter(column =>
      Object.prototype.hasOwnProperty.call(row, column),
    );
    const statement = `INSERT INTO ${quoteIdentifier(table)} (${restoredColumns
      .map(quoteIdentifier)
      .join(', ')}) VALUES (${restoredColumns.map(() => '?').join(', ')})`;
    await transaction.execute(
      statement,
      restoredColumns.map(column => row[column] as SqlValue),
    );
  }
}

export class LedgerBackupRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async createBackupDocument(
    createdAt: string,
    appVersion: string,
  ): Promise<string> {
    const canonicalCreatedAt = canonicalUtcTimestamp(createdAt, 'createdAt');
    const versionResult = await this.database.execute<{ user_version: number }>(
      'SELECT user_version FROM pragma_user_version',
    );
    const schemaVersion = requiredNumber(
      versionResult.rows[0]!,
      'user_version',
    );
    const tables: Record<string, BackupRow[]> = {};
    const counts: Record<string, number> = {};

    await this.database.transaction(async transaction => {
      for (const table of TABLES) {
        if (!tableIsRequired(table, schemaVersion)) continue;
        const result = await transaction.execute(
          `SELECT * FROM ${quoteIdentifier(table.name)} ORDER BY ${table.orderBy}`,
        );
        const rows = removeDeviceLocalConsent(
          table.name,
          result.rows.map(toBackupRow),
        );
        tables[table.name] = rows;
        counts[table.name] = rows.length;
      }
    });

    return serializeLedgerBackupPayload({
      format: LEDGER_BACKUP_FORMAT,
      formatVersion: LEDGER_BACKUP_FORMAT_VERSION,
      schemaVersion,
      createdAt: canonicalCreatedAt,
      appVersion: appVersion.trim(),
      tables,
      counts,
    });
  }

  async restoreBackupDocument(
    content: string,
    restoredAt: string,
  ): Promise<LedgerRestoreResult> {
    const document = parseLedgerBackupDocument(content);
    const canonicalRestoredAt = canonicalUtcTimestamp(restoredAt, 'restoredAt');
    const versionResult = await this.database.execute<{ user_version: number }>(
      'SELECT user_version FROM pragma_user_version',
    );
    const currentSchemaVersion = requiredNumber(
      versionResult.rows[0]!,
      'user_version',
    );
    if (document.schemaVersion > currentSchemaVersion) {
      throw new Error(
        `Backup schema ${document.schemaVersion} is newer than app schema ${currentSchemaVersion}.`,
      );
    }

    await this.database.transaction(async transaction => {
      await transaction.execute('PRAGMA defer_foreign_keys = ON');
      for (const table of DELETE_ORDER.filter(candidate =>
        Object.prototype.hasOwnProperty.call(document.tables, candidate.name),
      )) {
        await transaction.execute(`DELETE FROM ${quoteIdentifier(table.name)}`);
      }
      for (const table of TABLES) {
        await insertRows(
          transaction,
          table.name,
          removeDeviceLocalConsent(table.name, document.tables[table.name]!),
        );
      }

      const foreignKeys = await transaction.execute(
        'SELECT * FROM pragma_foreign_key_check',
      );
      if (foreignKeys.rows.length > 0) {
        throw new Error('Backup restore failed foreign-key verification.');
      }
      const integrity = await transaction.execute<{ result: string }>(
        'SELECT integrity_check AS result FROM pragma_integrity_check',
      );
      if (integrity.rows[0]?.result !== 'ok') {
        throw new Error(
          'Backup restore failed database integrity verification.',
        );
      }
    });

    return {
      restoredAt: canonicalRestoredAt,
      schemaVersion: document.schemaVersion,
      rowCount: Object.values(document.counts).reduce(
        (sum, count) => sum + count,
        0,
      ),
    };
  }
}
