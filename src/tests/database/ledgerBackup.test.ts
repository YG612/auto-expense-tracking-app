import {
  canonicalJson,
  createRepositories,
  parseLedgerBackupDocument,
  serializeLedgerBackupPayload,
  type LedgerBackupPayload,
} from '../../database';
import { sha256 } from '../../utils/sha256';
import { openMigratedTestDatabase } from './testDatabase';

const createdAt = '2026-08-13T10:00:00.000Z';

async function seedBackupLedger(
  database: Awaited<ReturnType<typeof openMigratedTestDatabase>>,
) {
  await database.execute(
    `INSERT INTO tags (id, name, created_at, updated_at)
     VALUES ('tag-backup', '出差', ?, ?)`,
    [createdAt, createdAt],
  );
  await database.execute(
    `INSERT INTO transactions (
       id, type, amount_minor, currency, occurred_at, category_id, account_id,
       merchant_raw_name, note, source, source_reference_id, original_text,
       confidence, confirmation_status, duplicate_status, created_at,
       updated_at, sync_status
     ) VALUES (
       'transaction-backup', 'EXPENSE', 4567, 'CNY', ?,
       'category-expense-food-lunch', 'account-wechat', '示例商户',
       '午餐凭证', 'TEXT', 'backup-source', '午饭45.67', 0.95,
       'CONFIRMED', 'NONE', ?, ?, 'LOCAL_ONLY'
     )`,
    [createdAt, createdAt, createdAt],
  );
  await database.execute(
    `INSERT INTO transaction_tags (transaction_id, tag_id)
     VALUES ('transaction-backup', 'tag-backup')`,
  );
  await database.execute(
    `INSERT INTO import_mapping_templates (
       id, name, mapping_json, created_at, updated_at
     ) VALUES ('mapping-backup', '通用账单', ?, ?, ?)`,
    [
      JSON.stringify({ occurredAt: '交易时间', amount: '金额' }),
      createdAt,
      createdAt,
    ],
  );
}

describe('LedgerBackupRepository', () => {
  it('creates a checksummed versioned document and restores it atomically', async () => {
    const database = await openMigratedTestDatabase();

    try {
      await seedBackupLedger(database);
      const repositories = createRepositories(database);
      await repositories.personalizationSettings.setLearningEnabled(
        false,
        '2026-08-13T10:05:00.000Z',
      );

      const content = await repositories.ledgerBackup.createBackupDocument(
        '2026-08-13T11:00:00.000Z',
        '1.0.7',
      );
      const document = parseLedgerBackupDocument(content);
      expect(document).toMatchObject({
        format: 'qingji-ai-ledger-backup',
        formatVersion: 1,
        schemaVersion: 7,
        createdAt: '2026-08-13T11:00:00.000Z',
        appVersion: '1.0.7',
        integrity: { algorithm: 'SHA-256' },
      });
      expect(document.integrity.digest).toMatch(/^[a-f0-9]{64}$/u);
      expect(document.counts.transactions).toBe(1);
      expect(document.counts.transaction_tags).toBe(1);
      expect(document.counts.import_mapping_templates).toBe(1);

      await database.transaction(async transaction => {
        await transaction.execute('DELETE FROM transaction_tags');
        await transaction.execute('DELETE FROM transactions');
        await transaction.execute('DELETE FROM import_mapping_templates');
        await transaction.execute("DELETE FROM tags WHERE id = 'tag-backup'");
        await transaction.execute(
          'UPDATE personalization_settings SET learning_enabled = 1',
        );
      });
      await expect(
        repositories.ledgerBackup.restoreBackupDocument(
          content,
          '2026-08-13T12:00:00.000Z',
        ),
      ).resolves.toMatchObject({
        restoredAt: '2026-08-13T12:00:00.000Z',
        schemaVersion: 7,
      });

      const restored =
        await repositories.transactions.findById('transaction-backup');
      expect(restored).toMatchObject({
        id: 'transaction-backup',
        amountMinor: 4567,
        originalText: '午饭45.67',
      });
      await expect(
        repositories.transactionTags.listForTransaction('transaction-backup'),
      ).resolves.toEqual([
        expect.objectContaining({ id: 'tag-backup', name: '出差' }),
      ]);
      await expect(
        repositories.personalizationSettings.get(),
      ).resolves.toMatchObject({ learningEnabled: false });
      await expect(repositories.importMappingTemplates.list()).resolves.toEqual(
        [expect.objectContaining({ id: 'mapping-backup', name: '通用账单' })],
      );
    } finally {
      database.close();
    }
  });

  it('restores a pre-v7 backup that does not contain an appended table', async () => {
    const database = await openMigratedTestDatabase();

    try {
      await seedBackupLedger(database);
      const repositories = createRepositories(database);
      const document = parseLedgerBackupDocument(
        await repositories.ledgerBackup.createBackupDocument(
          '2026-08-13T11:00:00.000Z',
          '1.0.7',
        ),
      );
      const legacyPayload = {
        ...document,
        schemaVersion: 6,
        tables: { ...document.tables },
        counts: { ...document.counts },
      } as Partial<typeof document>;
      delete legacyPayload.integrity;
      delete legacyPayload.tables!.import_mapping_templates;
      delete legacyPayload.counts!.import_mapping_templates;
      const payload = legacyPayload as LedgerBackupPayload;
      const legacyBackup = canonicalJson({
        ...payload,
        integrity: {
          algorithm: 'SHA-256',
          digest: sha256(canonicalJson(payload)),
        },
      });

      expect(
        parseLedgerBackupDocument(legacyBackup).tables.import_mapping_templates,
      ).toEqual([]);
      await expect(
        repositories.ledgerBackup.restoreBackupDocument(
          legacyBackup,
          '2026-08-13T12:00:00.000Z',
        ),
      ).resolves.toMatchObject({ schemaVersion: 6 });
      await expect(repositories.importMappingTemplates.list()).resolves.toEqual(
        [],
      );
    } finally {
      database.close();
    }
  });

  it('restores an older schema backup when the live schema adds a defaulted column', async () => {
    const database = await openMigratedTestDatabase();

    try {
      await seedBackupLedger(database);
      const repository = createRepositories(database).ledgerBackup;
      const original = parseLedgerBackupDocument(
        await repository.createBackupDocument(
          '2026-08-13T11:00:00.000Z',
          '1.0.7',
        ),
      );
      const payload = { ...original, schemaVersion: 5 } as Partial<
        typeof original
      >;
      delete payload.integrity;
      const olderBackup = serializeLedgerBackupPayload(
        payload as LedgerBackupPayload,
      );

      await database.execute(
        'ALTER TABLE transactions ADD COLUMN future_flag INTEGER NOT NULL DEFAULT 7',
      );
      await database.execute('PRAGMA user_version = 7');

      await expect(
        repository.restoreBackupDocument(
          olderBackup,
          '2026-08-13T12:00:00.000Z',
        ),
      ).resolves.toMatchObject({ schemaVersion: 5 });
      const restored = await database.execute<{
        id: string;
        future_flag: number;
      }>(
        "SELECT id, future_flag FROM transactions WHERE id = 'transaction-backup'",
      );
      expect(restored.rows).toEqual([
        { id: 'transaction-backup', future_flag: 7 },
      ]);
    } finally {
      database.close();
    }
  });

  it('rejects tampering before opening a restore transaction', async () => {
    const database = await openMigratedTestDatabase();

    try {
      await seedBackupLedger(database);
      const repository = createRepositories(database).ledgerBackup;
      const content = await repository.createBackupDocument(
        '2026-08-13T11:00:00.000Z',
        '1.0.7',
      );
      const tampered = content.replace('午饭45.67', '晚饭45.67');

      expect(() => parseLedgerBackupDocument(tampered)).toThrow(
        'integrity check failed',
      );
      await expect(
        repository.restoreBackupDocument(tampered, '2026-08-13T12:00:00.000Z'),
      ).rejects.toThrow('integrity check failed');

      const count = await database.execute<{ count: number }>(
        'SELECT COUNT(*) AS count FROM transactions',
      );
      expect(count.rows[0]?.count).toBe(1);
    } finally {
      database.close();
    }
  });

  it('rolls back the original ledger when a validly checksummed backup violates constraints', async () => {
    const database = await openMigratedTestDatabase();

    try {
      await seedBackupLedger(database);
      const repository = createRepositories(database).ledgerBackup;
      const content = await repository.createBackupDocument(
        '2026-08-13T11:00:00.000Z',
        '1.0.7',
      );
      const document = parseLedgerBackupDocument(content);
      document.tables.transactions![0]!.account_id = 'missing-account';
      const payload = { ...document } as Partial<typeof document>;
      delete payload.integrity;
      const invalidBackup = serializeLedgerBackupPayload(
        payload as LedgerBackupPayload,
      );

      await expect(
        repository.restoreBackupDocument(
          invalidBackup,
          '2026-08-13T12:00:00.000Z',
        ),
      ).rejects.toThrow();

      const original = await database.execute<{
        id: string;
        account_id: string;
      }>(
        `SELECT id, account_id FROM transactions
         WHERE id = 'transaction-backup'`,
      );
      expect(original.rows).toEqual([
        { id: 'transaction-backup', account_id: 'account-wechat' },
      ]);
    } finally {
      database.close();
    }
  });
});
