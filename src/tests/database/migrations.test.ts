import {
  configureDatabase,
  createRepositories,
  runMigrations,
  type DatabaseConnection,
  type Migration,
} from '../../database';
import { summarizeMonthlyAnalytics } from '../../domain/services/analytics';
import { openTestDatabase } from './testDatabase';
import { MIGRATIONS } from '../../database/migrations/runMigrations';

const createdAt = '2026-07-20T00:00:00.000Z';

async function seedVersionedLedger(
  database: DatabaseConnection,
  version: number,
): Promise<void> {
  await database.execute(
    `INSERT INTO transactions (
       id, revision, type, amount_minor, currency, occurred_at, category_id,
       account_id, source, source_reference_id, original_text, confidence,
       confirmation_status, duplicate_status, requires_review,
       review_reason_codes_json, created_at, updated_at, sync_status
     ) VALUES (
       'matrix-transaction', 3, 'EXPENSE', 1234, 'CNY', ?,
       'category-expense-food', 'account-wechat', 'TEXT', 'matrix-source',
       '午饭12.34', 0.95, 'CONFIRMED', 'NONE', 0, '[]', ?, ?, 'LOCAL_ONLY'
     )`,
    [createdAt, createdAt, createdAt],
  );
  await database.execute(
    `INSERT INTO recognized_operation_receipts (
       source, source_reference_id, payload_hash, transaction_id,
       confirmation_status, state, committed_at
     ) VALUES (
       'VOICE', 'matrix-voice', 'matrix-hash', 'matrix-transaction',
       'CONFIRMED', 'COMMITTED', ?
     )`,
    [createdAt],
  );
  await database.execute(
    `UPDATE personalization_settings
        SET learning_enabled = 0, retain_original_text = 0, updated_at = ?`,
    [createdAt],
  );

  if (version >= 7) {
    await database.execute(
      `INSERT INTO import_records (
         id, source, file_name, parsed_count, imported_count, duplicate_count,
         failed_count, created_at
       ) VALUES ('matrix-import', 'CSV', 'matrix.csv', 1, 1, 0, 0, ?)`,
      [createdAt],
    );
    await database.execute(
      `UPDATE transactions SET import_record_id = 'matrix-import'
        WHERE id = 'matrix-transaction'`,
    );
    await database.execute(
      `INSERT INTO import_mapping_templates (
         id, name, mapping_json, created_at, updated_at
       ) VALUES ('matrix-mapping', '矩阵映射', '{}', ?, ?)`,
      [createdAt, createdAt],
    );
  }
  if (version >= 8) {
    await database.execute(
      `UPDATE privacy_settings
          SET hide_amounts = 1, onboarding_completed = 1, updated_at = ?`,
      [createdAt],
    );
  }
  if (version >= 9) {
    await database.execute(
      `INSERT INTO budgets (
         id, period_type, year, month, category_id, limit_minor, currency,
         created_at, updated_at
       ) VALUES (
         'matrix-budget', 'MONTHLY', 2026, 7,
         'category-expense-food', 5000, 'CNY', ?, ?
       )`,
      [createdAt, createdAt],
    );
    await database.execute(
      `INSERT INTO recurring_templates (
         id, name, type, amount_minor, currency, category_id, account_id,
         cadence, next_occurrence_at, enabled, created_at, updated_at
       ) VALUES (
         'matrix-recurring', '矩阵周期账', 'EXPENSE', 500, 'CNY',
         'category-expense-food', 'account-wechat', 'MONTHLY', ?, 1, ?, ?
       )`,
      [createdAt, createdAt, createdAt],
    );
  }
  if (version >= 10) {
    await database.execute(
      `UPDATE experimental_feature_settings
          SET payment_notifications_enabled = 1, image_ocr_enabled = 1,
              updated_at = ?`,
      [createdAt],
    );
    await database.execute(
      `INSERT INTO payment_notification_imports (
         id, batch_hash, candidate_count, imported_count, created_at
       ) VALUES ('matrix-notification', 'matrix-batch', 1, 1, ?)`,
      [createdAt],
    );
  }
  if (version >= 11) {
    await database.execute(
      `INSERT INTO agent_operation_receipts (
         caller_id, idempotency_key, operation, payload_hash, state,
         transaction_ids_json, committed_at
       ) VALUES (
         'matrix-caller', 'matrix-key', 'CREATE_PENDING_BILL',
         'matrix-payload-hash', 'COMMITTED', '["matrix-transaction"]', ?
       )`,
      [createdAt],
    );
  }
}

describe('database migrations', () => {
  it('creates the documented schema and is repeatable', async () => {
    const database = openTestDatabase();

    try {
      await configureDatabase(database);

      await expect(
        runMigrations(database, undefined, () => '2026-07-20T00:00:00.000Z'),
      ).resolves.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      await expect(runMigrations(database)).resolves.toEqual([]);

      const tables = await database.execute<{ name: string }>(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name ASC`,
      );

      expect(tables.rows.map(row => row.name)).toEqual([
        'accounts',
        'agent_operation_receipts',
        'budgets',
        'categories',
        'classification_feedback',
        'experimental_feature_settings',
        'import_mapping_templates',
        'import_records',
        'learned_rule_suppressions',
        'merchants',
        'model_shadow_observations',
        'payment_notification_imports',
        'personalization_settings',
        'privacy_settings',
        'projects',
        'recognized_operation_receipts',
        'recurring_templates',
        'schema_migrations',
        'tags',
        'transaction_tags',
        'transactions',
        'user_rules',
      ]);

      const userVersion = await database.execute<{ user_version: number }>(
        'SELECT user_version FROM pragma_user_version',
      );
      expect(userVersion.rows[0]?.user_version).toBe(12);

      const privacySettings = await database.execute<{
        onboarding_completed: number;
      }>('SELECT onboarding_completed FROM privacy_settings WHERE id = 1');
      expect(privacySettings.rows[0]?.onboarding_completed).toBe(0);

      const seededReferenceData = await database.execute<{
        category_count: number;
        account_count: number;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM categories) AS category_count,
           (SELECT COUNT(*) FROM accounts) AS account_count`,
      );
      expect(seededReferenceData.rows[0]?.category_count).toBeGreaterThan(100);
      expect(seededReferenceData.rows[0]?.account_count).toBe(7);

      const lunch = await database.execute<{
        id: string;
        name: string;
        parent_id: string;
      }>(
        `SELECT id, name, parent_id
         FROM categories
         WHERE system_key = 'expense.food.lunch'`,
      );
      expect(lunch.rows).toEqual([
        {
          id: 'category-expense-food-lunch',
          name: '午餐',
          parent_id: 'category-expense-food',
        },
      ]);

      const foreignKeys = await database.execute<{ foreign_keys: number }>(
        'SELECT foreign_keys FROM pragma_foreign_keys',
      );
      expect(foreignKeys.rows[0]?.foreign_keys).toBe(1);
      const synchronous = await database.execute<{ synchronous: number }>(
        'SELECT synchronous FROM pragma_synchronous',
      );
      expect(synchronous.rows[0]?.synchronous).toBe(2);
    } finally {
      database.close();
    }
  });

  it('rolls back a failed migration atomically', async () => {
    const database = openTestDatabase();

    try {
      await configureDatabase(database);

      const failingMigration: Migration = {
        version: 2,
        name: 'failing_test_migration',
        statements: [
          'CREATE TABLE should_be_rolled_back (id TEXT PRIMARY KEY) STRICT',
          'THIS IS NOT VALID SQL',
        ],
      };

      await expect(
        runMigrations(database, [
          {
            version: 1,
            name: 'test_base',
            statements: ['SELECT 1'],
          },
          failingMigration,
        ]),
      ).rejects.toThrow();

      const table = await database.execute<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM sqlite_master
         WHERE type = 'table' AND name = 'should_be_rolled_back'`,
      );
      expect(table.rows[0]?.count).toBe(0);
    } finally {
      database.close();
    }
  });

  it('upgrades pre-personalization data with safe defaults', async () => {
    const database = openTestDatabase();

    try {
      await configureDatabase(database);
      await runMigrations(database, MIGRATIONS.slice(0, 2));
      await database.execute(
        `INSERT INTO transactions (
           id, type, amount_minor, currency, occurred_at, source,
           confirmation_status, duplicate_status, created_at, updated_at,
           sync_status
         ) VALUES (?, 'EXPENSE', 1000, 'CNY', ?, 'MANUAL',
                   'CONFIRMED', 'NONE', ?, ?, 'LOCAL_ONLY')`,
        ['legacy-transaction', createdAt, createdAt, createdAt],
      );
      await database.execute(
        `INSERT INTO user_rules (
           id, rule_type, pattern, priority, enabled, usage_count,
           created_at, updated_at
         ) VALUES ('legacy-rule', 'MERCHANT', '一鸣', 50, 1, 0, ?, ?)`,
        [createdAt, createdAt],
      );
      await database.execute(
        `INSERT INTO classification_feedback (
           id, transaction_id, corrected_category_id,
           merchant_raw_name, created_at
         ) VALUES (
           'legacy-feedback', 'legacy-transaction',
           'category-expense-food', '一鸣', ?
         )`,
        [createdAt],
      );

      await expect(runMigrations(database)).resolves.toEqual([
        3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
      await expect(runMigrations(database)).resolves.toEqual([]);

      const rule = await database.execute<{ origin: string }>(
        `SELECT origin FROM user_rules WHERE id = 'legacy-rule'`,
      );
      const feedback = await database.execute<{ learning_status: string }>(
        `SELECT learning_status
         FROM classification_feedback
         WHERE id = 'legacy-feedback'`,
      );
      const settings = await database.execute<{
        learning_enabled: number;
        retain_original_text: number;
      }>(
        `SELECT learning_enabled, retain_original_text
         FROM personalization_settings
         WHERE id = 1`,
      );
      const privacySettings = await database.execute<{
        onboarding_completed: number;
      }>('SELECT onboarding_completed FROM privacy_settings WHERE id = 1');
      const legacyTransaction = await database.execute<{
        revision: number;
        requires_review: number;
        review_reason_codes_json: string;
      }>(
        `SELECT revision, requires_review, review_reason_codes_json
         FROM transactions WHERE id = 'legacy-transaction'`,
      );

      expect(rule.rows[0]?.origin).toBe('USER_CREATED');
      expect(feedback.rows[0]?.learning_status).toBe('PENDING');
      expect(settings.rows[0]?.learning_enabled).toBe(1);
      expect(settings.rows[0]?.retain_original_text).toBe(1);
      expect(privacySettings.rows[0]?.onboarding_completed).toBe(1);
      expect(legacyTransaction.rows[0]).toEqual({
        revision: 1,
        requires_review: 0,
        review_reason_codes_json: '[]',
      });
    } finally {
      database.close();
    }
  });

  it('upgrades a deployed version 3 ledger without rewriting existing rows', async () => {
    const database = openTestDatabase();

    try {
      await configureDatabase(database);
      await runMigrations(database, MIGRATIONS.slice(0, 3));
      await database.execute(
        `INSERT INTO transactions (
           id, type, amount_minor, currency, occurred_at, source,
           original_text, confirmation_status, duplicate_status,
           created_at, updated_at, sync_status
         ) VALUES (
           'version-3-row', 'INCOME', 8800, 'CNY', ?, 'TEXT',
           'legacy private text', 'CONFIRMED', 'NONE', ?, ?, 'LOCAL_ONLY'
         )`,
        [createdAt, createdAt, createdAt],
      );

      await expect(runMigrations(database)).resolves.toEqual([
        4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
      await expect(runMigrations(database)).resolves.toEqual([]);
      const row = await database.execute<{
        amount_minor: number;
        original_text: string;
        revision: number;
      }>(
        `SELECT amount_minor, original_text, revision
         FROM transactions
         WHERE id = 'version-3-row'`,
      );
      const settings = await database.execute<{
        retain_original_text: number;
      }>(
        `SELECT retain_original_text
         FROM personalization_settings
         WHERE id = 1`,
      );

      expect(row.rows).toEqual([
        {
          amount_minor: 8800,
          original_text: 'legacy private text',
          revision: 1,
        },
      ]);
      expect(settings.rows[0]?.retain_original_text).toBe(1);
    } finally {
      database.close();
    }
  });

  it('conservatively marks deployed pending rows when upgrading version 4', async () => {
    const database = openTestDatabase();

    try {
      await configureDatabase(database);
      await runMigrations(database, MIGRATIONS.slice(0, 4));
      await database.execute(
        `INSERT INTO transactions (
           id, revision, type, amount_minor, currency, occurred_at, source,
           confirmation_status, duplicate_status, created_at, updated_at,
           sync_status
         ) VALUES (
           'legacy-pending', 1, 'EXPENSE', 2500, 'CNY', ?, 'TEXT',
           'PENDING', 'NONE', ?, ?, 'LOCAL_ONLY'
         )`,
        [createdAt, createdAt, createdAt],
      );

      await expect(runMigrations(database)).resolves.toEqual([
        5, 6, 7, 8, 9, 10, 11, 12,
      ]);
      await expect(runMigrations(database)).resolves.toEqual([]);

      const row = await database.execute<{
        requires_review: number;
        review_reason_codes_json: string;
      }>(
        `SELECT requires_review, review_reason_codes_json
         FROM transactions
         WHERE id = 'legacy-pending'`,
      );
      expect(row.rows).toEqual([
        {
          requires_review: 1,
          review_reason_codes_json: '["LEGACY_PENDING_UNCLASSIFIED"]',
        },
      ]);
    } finally {
      database.close();
    }
  });

  it('backfills confirmed and pending VOICE origins when upgrading version 5', async () => {
    const database = openTestDatabase();

    try {
      await configureDatabase(database);
      await runMigrations(database, MIGRATIONS.slice(0, 5));
      await database.execute(
        `INSERT INTO transactions (
           id, revision, type, amount_minor, currency, occurred_at, source,
           source_reference_id, confirmation_status, duplicate_status,
           requires_review, review_reason_codes_json,
           created_at, updated_at, sync_status
         ) VALUES
           ('legacy-voice-confirmed', 1, 'EXPENSE', 1000, 'CNY', ?, 'VOICE',
            'speech:legacy-confirmed:0', 'CONFIRMED', 'NONE', 0, '[]',
            ?, ?, 'LOCAL_ONLY'),
           ('legacy-voice-pending', 1, 'EXPENSE', 2000, 'CNY', ?, 'VOICE',
            'speech:legacy-pending:0', 'PENDING', 'NONE', 1,
            '["LEGACY_PENDING_UNCLASSIFIED"]', ?, ?, 'LOCAL_ONLY')`,
        [createdAt, createdAt, createdAt, createdAt, createdAt, createdAt],
      );

      await expect(runMigrations(database)).resolves.toEqual([
        6, 7, 8, 9, 10, 11, 12,
      ]);
      const receipts = await database.execute<{
        source_reference_id: string;
        confirmation_status: string;
        payload_hash: string;
      }>(
        `SELECT source_reference_id, confirmation_status, payload_hash
           FROM recognized_operation_receipts
          ORDER BY source_reference_id ASC`,
      );
      expect(receipts.rows).toEqual([
        {
          source_reference_id: 'speech:legacy-confirmed:0',
          confirmation_status: 'CONFIRMED',
          payload_hash: 'legacy-unbound:legacy-voice-confirmed',
        },
        {
          source_reference_id: 'speech:legacy-pending:0',
          confirmation_status: 'PENDING',
          payload_hash: 'legacy-unbound:legacy-voice-pending',
        },
      ]);
    } finally {
      database.close();
    }
  });

  it.each([6, 7, 8, 9, 10, 11])(
    'upgrades a populated version %i ledger to v12 without changing financial facts',
    async startVersion => {
      const database = openTestDatabase();
      try {
        await configureDatabase(database);
        await runMigrations(database, MIGRATIONS.slice(0, startVersion));
        await seedVersionedLedger(database, startVersion);

        await expect(runMigrations(database)).resolves.toEqual(
          Array.from(
            { length: 12 - startVersion },
            (_, index) => startVersion + index + 1,
          ),
        );
        await expect(runMigrations(database)).resolves.toEqual([]);

        const repositories = createRepositories(database);
        const transactions = await repositories.transactions.listSummaries({
          confirmationStatus: 'CONFIRMED',
        });
        const budgets = await repositories.budgets.listForMonth(2026, 7);
        const analytics = summarizeMonthlyAnalytics(
          transactions,
          budgets,
          new Date(2026, 6, 20, 12),
        );
        expect(transactions).toEqual([
          expect.objectContaining({
            id: 'matrix-transaction',
            revision: 3,
            amountMinor: 1234,
            categoryId: 'category-expense-food',
            categoryName: '餐饮',
            accountId: 'account-wechat',
            originalText: '午饭12.34',
          }),
        ]);
        expect(analytics.expenseMinor).toBe(1234);
        expect(analytics.expenseCategories[0]).toMatchObject({
          categoryId: 'category-expense-food',
          amountMinor: 1234,
        });
        if (startVersion >= 9) {
          expect(analytics.budget).toMatchObject({
            source: 'CATEGORY_TOTAL',
            limitMinor: 5000,
            spentMinor: 1234,
          });
        } else {
          expect(analytics.budget).toBeUndefined();
        }

        const preserved = await database.execute<{
          voice_receipts: number;
          mappings: number;
          recurring: number;
          notifications: number;
          agent_receipts: number;
          shadow_observations: number;
        }>(
          `SELECT
             (SELECT COUNT(*) FROM recognized_operation_receipts)
               AS voice_receipts,
             (SELECT COUNT(*) FROM import_mapping_templates) AS mappings,
             (SELECT COUNT(*) FROM recurring_templates) AS recurring,
             (SELECT COUNT(*) FROM payment_notification_imports)
               AS notifications,
             (SELECT COUNT(*) FROM agent_operation_receipts) AS agent_receipts,
             (SELECT COUNT(*) FROM model_shadow_observations)
               AS shadow_observations`,
        );
        expect(preserved.rows).toEqual([
          {
            voice_receipts: 1,
            mappings: startVersion >= 7 ? 1 : 0,
            recurring: startVersion >= 9 ? 1 : 0,
            notifications: startVersion >= 10 ? 1 : 0,
            agent_receipts: startVersion >= 11 ? 1 : 0,
            shadow_observations: 0,
          },
        ]);
        await expect(
          repositories.personalizationSettings.get(),
        ).resolves.toMatchObject({
          learningEnabled: false,
          retainOriginalText: false,
        });
        await expect(repositories.privacySettings.get()).resolves.toMatchObject(
          {
            onboardingCompleted: true,
            hideAmounts: startVersion >= 8,
          },
        );
        const foreignKeys = await database.execute(
          'SELECT * FROM pragma_foreign_key_check',
        );
        expect(foreignKeys.rows).toEqual([]);
      } finally {
        database.close();
      }
    },
  );
});
