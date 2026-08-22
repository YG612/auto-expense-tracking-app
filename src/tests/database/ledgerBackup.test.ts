import {
  canonicalJson,
  configureDatabase,
  createRepositories,
  parseLedgerBackupDocument,
  serializeLedgerBackupPayload,
  runMigrations,
  type LedgerBackupPayload,
} from '../../database';
import { MIGRATIONS } from '../../database/migrations/runMigrations';
import { sha256 } from '../../utils/sha256';
import { openMigratedTestDatabase, openTestDatabase } from './testDatabase';

const createdAt = '2026-08-13T10:00:00.000Z';

async function seedBackupLedger(
  database: Awaited<ReturnType<typeof openMigratedTestDatabase>>,
  schemaVersion = 12,
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
  if (schemaVersion >= 7) {
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
  if (schemaVersion >= 9) {
    await database.execute(
      `INSERT INTO recurring_templates (
         id, name, type, amount_minor, currency, category_id, account_id,
         cadence, next_occurrence_at, enabled, created_at, updated_at
       ) VALUES (
         'recurring-backup', '固定午餐', 'EXPENSE', 2500, 'CNY',
         'category-expense-food-lunch', 'account-wechat', 'WEEKLY', ?, 1, ?, ?
       )`,
      [createdAt, createdAt, createdAt],
    );
  }
}

async function seedVersionedBackupLedger(
  database: Awaited<ReturnType<typeof openTestDatabase>>,
  schemaVersion: number,
): Promise<void> {
  await seedBackupLedger(database, schemaVersion);
  await database.execute(
    `UPDATE personalization_settings
        SET learning_enabled = 0, retain_original_text = 0, updated_at = ?`,
    [createdAt],
  );
  await database.execute(
    `INSERT INTO recognized_operation_receipts (
       source, source_reference_id, payload_hash, transaction_id,
       confirmation_status, state, committed_at
     ) VALUES (
       'VOICE', 'backup-voice', 'backup-voice-hash', 'transaction-backup',
       'CONFIRMED', 'COMMITTED', ?
     )`,
    [createdAt],
  );
  if (schemaVersion >= 7) {
    await database.execute(
      `INSERT INTO import_records (
         id, source, file_name, parsed_count, imported_count, duplicate_count,
         failed_count, created_at
       ) VALUES ('backup-import', 'CSV', 'backup.csv', 1, 1, 0, 0, ?)`,
      [createdAt],
    );
    await database.execute(
      `UPDATE transactions SET import_record_id = 'backup-import'
        WHERE id = 'transaction-backup'`,
    );
  }
  if (schemaVersion >= 8) {
    await database.execute(
      `UPDATE privacy_settings
          SET hide_amounts = 1, onboarding_completed = 1, updated_at = ?`,
      [createdAt],
    );
  }
  if (schemaVersion >= 9) {
    await database.execute(
      `INSERT INTO budgets (
         id, period_type, year, month, category_id, limit_minor, currency,
         created_at, updated_at
       ) VALUES (
         'backup-budget', 'MONTHLY', 2026, 8,
         'category-expense-food', 10000, 'CNY', ?, ?
       )`,
      [createdAt, createdAt],
    );
  }
  if (schemaVersion >= 10) {
    await database.execute(
      `UPDATE experimental_feature_settings
          SET payment_notifications_enabled = 1, image_ocr_enabled = 1,
              updated_at = ?`,
      [createdAt],
    );
    await database.execute(
      `INSERT INTO payment_notification_imports (
         id, batch_hash, candidate_count, imported_count, created_at
       ) VALUES ('backup-notification', 'backup-batch', 1, 1, ?)`,
      [createdAt],
    );
  }
  if (schemaVersion >= 11) {
    await database.execute(
      `INSERT INTO agent_operation_receipts (
         caller_id, idempotency_key, operation, payload_hash, state,
         transaction_ids_json, committed_at
       ) VALUES (
         'backup-caller', 'backup-key', 'CREATE_PENDING_BILL',
         'backup-payload-hash', 'COMMITTED', '["transaction-backup"]', ?
       )`,
      [createdAt],
    );
  }
  if (schemaVersion >= 12) {
    await database.execute(
      `INSERT INTO model_shadow_observations (
         id, transaction_id, model_id, model_version, taxonomy_version,
         predicted_category_key, final_category_key, matched,
         calibrated_confidence, latency_ms, created_at
       ) VALUES (
         'backup-shadow', 'transaction-backup', 'model', '1', 1,
         'expense.food', 'expense.food', 1, 0.9, 10, ?
       )`,
      [createdAt],
    );
  }
}

describe('LedgerBackupRepository', () => {
  it.each([6, 7, 8, 9, 10, 11, 12])(
    'creates and restores a populated v%i backup into v12',
    async schemaVersion => {
      const source = openTestDatabase();
      const destination = await openMigratedTestDatabase();
      try {
        await configureDatabase(source);
        await runMigrations(source, MIGRATIONS.slice(0, schemaVersion));
        await seedVersionedBackupLedger(source, schemaVersion);
        const content = await createRepositories(
          source,
        ).ledgerBackup.createBackupDocument(
          '2026-08-22T11:00:00.000Z',
          '1.0.7',
        );
        const parsedDocument = parseLedgerBackupDocument(content);
        expect(parsedDocument.schemaVersion).toBe(schemaVersion);
        if (schemaVersion >= 10) {
          expect(
            parsedDocument.tables.experimental_feature_settings?.[0]
              ?.payment_notifications_enabled,
          ).toBe(0);
        }

        const repositories = createRepositories(destination);
        await expect(
          repositories.ledgerBackup.restoreBackupDocument(
            content,
            '2026-08-22T12:00:00.000Z',
          ),
        ).resolves.toMatchObject({ schemaVersion });
        await expect(
          repositories.transactions.findById('transaction-backup'),
        ).resolves.toMatchObject({
          amountMinor: 4567,
          categoryId: 'category-expense-food-lunch',
          accountId: 'account-wechat',
          originalText: '午饭45.67',
          ...(schemaVersion >= 7 ? { importRecordId: 'backup-import' } : {}),
        });
        await expect(
          repositories.transactionTags.listForTransaction('transaction-backup'),
        ).resolves.toEqual([
          expect.objectContaining({ id: 'tag-backup', name: '出差' }),
        ]);
        await expect(
          repositories.personalizationSettings.get(),
        ).resolves.toMatchObject({
          learningEnabled: false,
          retainOriginalText: false,
        });
        await expect(repositories.privacySettings.get()).resolves.toMatchObject(
          {
            hideAmounts: schemaVersion >= 8,
            onboardingCompleted: true,
          },
        );
        await expect(
          repositories.experimentalFeatures.get(),
        ).resolves.toMatchObject({
          paymentNotificationsEnabled: false,
          imageOcrEnabled: schemaVersion >= 10,
        });
        const versionedRows = await destination.execute<{
          mappings: number;
          recurring: number;
          notifications: number;
          agent_receipts: number;
          shadow_observations: number;
        }>(
          `SELECT
             (SELECT COUNT(*) FROM import_mapping_templates) AS mappings,
             (SELECT COUNT(*) FROM recurring_templates) AS recurring,
             (SELECT COUNT(*) FROM payment_notification_imports)
               AS notifications,
             (SELECT COUNT(*) FROM agent_operation_receipts) AS agent_receipts,
             (SELECT COUNT(*) FROM model_shadow_observations)
               AS shadow_observations`,
        );
        expect(versionedRows.rows).toEqual([
          {
            mappings: schemaVersion >= 7 ? 1 : 0,
            recurring: schemaVersion >= 9 ? 1 : 0,
            notifications: schemaVersion >= 10 ? 1 : 0,
            agent_receipts: schemaVersion >= 11 ? 1 : 0,
            shadow_observations: schemaVersion >= 12 ? 1 : 0,
          },
        ]);
        const foreignKeys = await destination.execute(
          'SELECT * FROM pragma_foreign_key_check',
        );
        expect(foreignKeys.rows).toEqual([]);
      } finally {
        source.close();
        destination.close();
      }
    },
  );

  it('does not export or restore device-local payment notification consent', async () => {
    const database = await openMigratedTestDatabase();

    try {
      const repositories = createRepositories(database);
      await repositories.experimentalFeatures.update(
        { paymentNotificationsEnabled: true, imageOcrEnabled: true },
        '2026-08-22T10:00:00.000Z',
      );
      const exported = parseLedgerBackupDocument(
        await repositories.ledgerBackup.createBackupDocument(
          '2026-08-22T11:00:00.000Z',
          '1.0.7',
        ),
      );
      expect(
        exported.tables.experimental_feature_settings?.[0]
          ?.payment_notifications_enabled,
      ).toBe(0);
      expect(
        exported.tables.experimental_feature_settings?.[0]?.image_ocr_enabled,
      ).toBe(1);

      exported.tables.experimental_feature_settings![0]!.payment_notifications_enabled = 1;
      const payload = { ...exported } as Partial<typeof exported>;
      delete payload.integrity;
      const olderBackupWithConsent = serializeLedgerBackupPayload(
        payload as LedgerBackupPayload,
      );
      await repositories.experimentalFeatures.update(
        { paymentNotificationsEnabled: false, imageOcrEnabled: false },
        '2026-08-22T11:30:00.000Z',
      );

      await repositories.ledgerBackup.restoreBackupDocument(
        olderBackupWithConsent,
        '2026-08-22T12:00:00.000Z',
      );
      await expect(
        repositories.experimentalFeatures.get(),
      ).resolves.toMatchObject({
        paymentNotificationsEnabled: false,
        imageOcrEnabled: true,
      });
    } finally {
      database.close();
    }
  });

  it('creates a checksummed versioned document and restores it atomically', async () => {
    const database = await openMigratedTestDatabase();

    try {
      await seedBackupLedger(database);
      const repositories = createRepositories(database);
      await repositories.personalizationSettings.setLearningEnabled(
        false,
        '2026-08-13T10:05:00.000Z',
      );
      await repositories.privacySettings.update(
        { hideAmounts: true, onboardingCompleted: true },
        '2026-08-13T10:06:00.000Z',
      );

      const content = await repositories.ledgerBackup.createBackupDocument(
        '2026-08-13T11:00:00.000Z',
        '1.0.7',
      );
      const document = parseLedgerBackupDocument(content);
      expect(document).toMatchObject({
        format: 'qingji-ai-ledger-backup',
        formatVersion: 1,
        schemaVersion: 12,
        createdAt: '2026-08-13T11:00:00.000Z',
        appVersion: '1.0.7',
        integrity: { algorithm: 'SHA-256' },
      });
      expect(document.integrity.digest).toMatch(/^[a-f0-9]{64}$/u);
      expect(document.counts.transactions).toBe(1);
      expect(document.counts.transaction_tags).toBe(1);
      expect(document.counts.import_mapping_templates).toBe(1);
      expect(document.counts.privacy_settings).toBe(1);
      expect(document.counts.recurring_templates).toBe(1);

      await database.transaction(async transaction => {
        await transaction.execute('DELETE FROM transaction_tags');
        await transaction.execute('DELETE FROM transactions');
        await transaction.execute('DELETE FROM import_mapping_templates');
        await transaction.execute('DELETE FROM recurring_templates');
        await transaction.execute("DELETE FROM tags WHERE id = 'tag-backup'");
        await transaction.execute(
          'UPDATE personalization_settings SET learning_enabled = 1',
        );
        await transaction.execute(
          'UPDATE privacy_settings SET hide_amounts = 0, onboarding_completed = 0',
        );
      });
      await expect(
        repositories.ledgerBackup.restoreBackupDocument(
          content,
          '2026-08-13T12:00:00.000Z',
        ),
      ).resolves.toMatchObject({
        restoredAt: '2026-08-13T12:00:00.000Z',
        schemaVersion: 12,
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
      await expect(repositories.privacySettings.get()).resolves.toMatchObject({
        hideAmounts: true,
        onboardingCompleted: true,
      });
      await expect(repositories.recurringTemplates.list()).resolves.toEqual([
        expect.objectContaining({ id: 'recurring-backup', name: '固定午餐' }),
      ]);
    } finally {
      database.close();
    }
  });

  it('restores a pre-v7 backup that does not contain appended tables', async () => {
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
      delete legacyPayload.tables!.privacy_settings;
      delete legacyPayload.counts!.privacy_settings;
      delete legacyPayload.tables!.recurring_templates;
      delete legacyPayload.counts!.recurring_templates;
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
      expect(
        parseLedgerBackupDocument(legacyBackup).tables.privacy_settings,
      ).toEqual([expect.objectContaining({ onboarding_completed: 1 })]);
      expect(
        parseLedgerBackupDocument(legacyBackup).tables.recurring_templates,
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
      await expect(repositories.privacySettings.get()).resolves.toMatchObject({
        appLockEnabled: false,
        hideAmounts: false,
        onboardingCompleted: true,
      });
      await expect(repositories.recurringTemplates.list()).resolves.toEqual([]);
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
