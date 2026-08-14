import {
  configureDatabase,
  runMigrations,
  type Migration,
} from '../../database';
import { openTestDatabase } from './testDatabase';
import { MIGRATIONS } from '../../database/migrations/runMigrations';

const createdAt = '2026-07-20T00:00:00.000Z';

describe('database migrations', () => {
  it('creates the documented schema and is repeatable', async () => {
    const database = openTestDatabase();

    try {
      await configureDatabase(database);

      await expect(
        runMigrations(database, undefined, () => '2026-07-20T00:00:00.000Z'),
      ).resolves.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      await expect(runMigrations(database)).resolves.toEqual([]);

      const tables = await database.execute<{ name: string }>(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name ASC`,
      );

      expect(tables.rows.map(row => row.name)).toEqual([
        'accounts',
        'budgets',
        'categories',
        'classification_feedback',
        'import_mapping_templates',
        'import_records',
        'learned_rule_suppressions',
        'merchants',
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
      expect(userVersion.rows[0]?.user_version).toBe(9);

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
        3, 4, 5, 6, 7, 8, 9,
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
        4, 5, 6, 7, 8, 9,
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

      await expect(runMigrations(database)).resolves.toEqual([5, 6, 7, 8, 9]);
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

      await expect(runMigrations(database)).resolves.toEqual([6, 7, 8, 9]);
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
});
