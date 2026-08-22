import {
  createRepositories,
  ERASED_USER_DATA_TABLES,
  type DatabaseConnection,
} from '../../database';
import { openMigratedTestDatabase } from './testDatabase';

const now = '2026-08-22T10:00:00.000Z';

async function seedUserData(database: DatabaseConnection): Promise<void> {
  await database.transaction(async transaction => {
    await transaction.execute(
      `INSERT INTO categories (
         id, type, parent_id, system_key, name, sort_order, is_system,
         is_hidden, created_at, updated_at
       ) VALUES
         ('custom-category', 'EXPENSE', NULL, NULL, '自定义分类', 999, 0, 0, ?, ?),
         ('custom-subcategory', 'EXPENSE', 'custom-category', NULL, '自定义子类', 0, 0, 0, ?, ?)`,
      [now, now, now, now],
    );
    await transaction.execute(
      `INSERT INTO accounts (
         id, name, type, currency, include_in_net_worth, sort_order,
         is_hidden, created_at, updated_at
       ) VALUES ('custom-account', '私人账户', 'OTHER', 'CNY', 1, 999, 0, ?, ?)`,
      [now, now],
    );
    await transaction.execute(
      `UPDATE accounts
          SET name = '私人微信名', opening_balance_minor = 100,
              current_balance_minor = 200, is_hidden = 1
        WHERE id = 'account-wechat'`,
    );
    await transaction.execute(
      `INSERT INTO projects (
         id, name, currency, is_archived, created_at, updated_at
       ) VALUES ('project-erase', '私人项目', 'CNY', 0, ?, ?)`,
      [now, now],
    );
    await transaction.execute(
      `INSERT INTO merchants (
         id, canonical_name, normalized_name, aliases_json, created_at, updated_at
       ) VALUES ('merchant-erase', '私人商户', '私人商户', '[]', ?, ?)`,
      [now, now],
    );
    await transaction.execute(
      `INSERT INTO tags (id, name, created_at, updated_at)
       VALUES ('tag-erase', '私人标签', ?, ?)`,
      [now, now],
    );
    await transaction.execute(
      `INSERT INTO import_records (
         id, source, file_name, parsed_count, imported_count, duplicate_count,
         failed_count, created_at
       ) VALUES ('import-erase', 'CSV', 'private.csv', 1, 1, 0, 0, ?)`,
      [now],
    );
    await transaction.execute(
      `INSERT INTO transactions (
         id, type, amount_minor, currency, occurred_at, category_id, account_id,
         merchant_id, project_id, note, source, source_reference_id,
         original_text, confidence, confirmation_status, duplicate_status,
         import_record_id, created_at, updated_at, sync_status
       ) VALUES (
         'transaction-erase', 'EXPENSE', 1234, 'CNY', ?,
         'custom-category', 'custom-account', 'merchant-erase', 'project-erase',
         '私人备注', 'TEXT', 'erase-source', '私人原始文字', 0.9,
         'CONFIRMED', 'NONE', 'import-erase', ?, ?, 'LOCAL_ONLY'
       )`,
      [now, now, now],
    );
    await transaction.execute(
      `INSERT INTO transaction_tags (transaction_id, tag_id)
       VALUES ('transaction-erase', 'tag-erase')`,
    );
    await transaction.execute(
      `INSERT INTO user_rules (
         id, rule_type, pattern, priority, enabled, usage_count,
         created_at, updated_at
       ) VALUES ('rule-erase', 'MERCHANT', '私人商户', 1, 1, 0, ?, ?)`,
      [now, now],
    );
    await transaction.execute(
      `INSERT INTO classification_feedback (
         id, transaction_id, source_text, merchant_raw_name, created_at
       ) VALUES ('feedback-erase', 'transaction-erase', '私人原文', '私人商户', ?)`,
      [now],
    );
    await transaction.execute(
      `INSERT INTO budgets (
         id, period_type, year, month, category_id, limit_minor, currency,
         created_at, updated_at
       ) VALUES ('budget-erase', 'MONTHLY', 2026, 8, 'custom-category', 10000, 'CNY', ?, ?)`,
      [now, now],
    );
    await transaction.execute(
      `INSERT INTO recurring_templates (
         id, name, type, amount_minor, currency, category_id, account_id,
         cadence, next_occurrence_at, enabled, created_at, updated_at
       ) VALUES (
         'recurring-erase', '私人周期账', 'EXPENSE', 100, 'CNY',
         'custom-category', 'custom-account', 'MONTHLY', ?, 1, ?, ?
       )`,
      [now, now, now],
    );
    await transaction.execute(
      `INSERT INTO import_mapping_templates (
         id, name, mapping_json, created_at, updated_at
       ) VALUES ('mapping-erase', '私人映射', '{}', ?, ?)`,
      [now, now],
    );
    await transaction.execute(
      `INSERT INTO learned_rule_suppressions (rule_type, pattern, suppressed_at)
       VALUES ('MERCHANT', '私人商户', ?)`,
      [now],
    );
    await transaction.execute(
      `INSERT INTO recognized_operation_receipts (
         source, source_reference_id, payload_hash, transaction_id,
         confirmation_status, state, committed_at
       ) VALUES ('VOICE', 'voice-erase', 'hash-erase', 'transaction-erase',
         'CONFIRMED', 'COMMITTED', ?)`,
      [now],
    );
    await transaction.execute(
      `INSERT INTO agent_operation_receipts (
         caller_id, idempotency_key, operation, payload_hash, state,
         transaction_ids_json, committed_at
       ) VALUES ('caller-erase', 'key-erase', 'CREATE_PENDING_BILL',
         'payload-hash-erase', 'COMMITTED', '["transaction-erase"]', ?)`,
      [now],
    );
    await transaction.execute(
      `INSERT INTO payment_notification_imports (
         id, batch_hash, candidate_count, imported_count, created_at
       ) VALUES ('notification-erase', 'batch-erase', 1, 1, ?)`,
      [now],
    );
    await transaction.execute(
      `INSERT INTO model_shadow_observations (
         id, transaction_id, model_id, model_version, taxonomy_version,
         predicted_category_key, final_category_key, matched,
         calibrated_confidence, latency_ms, created_at
       ) VALUES (
         'shadow-erase', 'transaction-erase', 'model', '1', 1,
         'expense.food', 'expense.food', 1, 0.9, 10, ?
       )`,
      [now],
    );
    await transaction.execute(
      `UPDATE personalization_settings
          SET learning_enabled = 0, retain_original_text = 0, updated_at = ?`,
      [now],
    );
    await transaction.execute(
      `UPDATE experimental_feature_settings
          SET payment_notifications_enabled = 1, image_ocr_enabled = 1,
              updated_at = ?`,
      [now],
    );
    await transaction.execute(
      `UPDATE privacy_settings
          SET app_lock_enabled = 1, hide_amounts = 1,
              lock_timeout_seconds = 60, onboarding_completed = 1,
              first_backup_reminder_dismissed = 1, last_backup_at = ?,
              updated_at = ?`,
      [now, now],
    );
  });
}

describe('DataErasureRepository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
    await seedUserData(database);
  });

  afterEach(() => database.close());

  it('atomically deletes every user-data family and verifies the empty result', async () => {
    const repositories = createRepositories(database);
    const result = await repositories.dataErasure.eraseAllUserData(
      '2026-08-22T11:00:00.000Z',
    );
    expect(result).toMatchObject({
      erasedAt: '2026-08-22T11:00:00.000Z',
      verifiedEmptyTables: ERASED_USER_DATA_TABLES.length,
    });
    expect(result.deletedRows).toBeGreaterThanOrEqual(
      ERASED_USER_DATA_TABLES.length,
    );

    for (const table of ERASED_USER_DATA_TABLES) {
      const count = await database.execute<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${table}`,
      );
      expect(count.rows[0]?.count).toBe(0);
    }
    const customReferences = await database.execute<{
      custom_categories: number;
      custom_accounts: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM categories WHERE is_system = 0) AS custom_categories,
         (SELECT COUNT(*) FROM accounts WHERE id = 'custom-account') AS custom_accounts`,
    );
    expect(customReferences.rows).toEqual([
      { custom_categories: 0, custom_accounts: 0 },
    ]);
    await expect(
      repositories.personalizationSettings.get(),
    ).resolves.toMatchObject({
      learningEnabled: true,
      retainOriginalText: true,
    });
    await expect(
      repositories.experimentalFeatures.get(),
    ).resolves.toMatchObject({
      paymentNotificationsEnabled: false,
      imageOcrEnabled: false,
    });
    await expect(repositories.privacySettings.get()).resolves.toMatchObject({
      appLockEnabled: false,
      hideAmounts: false,
      onboardingCompleted: false,
      firstBackupReminderDismissed: false,
      lastBackupAt: undefined,
    });
    const wechat = await database.execute<{
      name: string;
      opening_balance_minor: number | null;
      current_balance_minor: number | null;
      is_hidden: number;
    }>(
      `SELECT name, opening_balance_minor, current_balance_minor, is_hidden
         FROM accounts WHERE id = 'account-wechat'`,
    );
    expect(wechat.rows).toEqual([
      {
        name: '微信',
        opening_balance_minor: null,
        current_balance_minor: null,
        is_hidden: 0,
      },
    ]);
  });

  it('rolls back all earlier deletions when any delete step fails', async () => {
    await database.execute(
      `CREATE TRIGGER reject_transaction_erasure
       BEFORE DELETE ON transactions
       BEGIN
         SELECT RAISE(ABORT, 'injected erasure failure');
       END`,
    );
    const repositories = createRepositories(database);

    await expect(
      repositories.dataErasure.eraseAllUserData('2026-08-22T11:00:00.000Z'),
    ).rejects.toThrow('injected erasure failure');
    await expect(
      repositories.transactions.findById('transaction-erase'),
    ).resolves.toBeDefined();
    const shadow = await database.execute<{ count: number }>(
      'SELECT COUNT(*) AS count FROM model_shadow_observations',
    );
    expect(shadow.rows[0]?.count).toBe(1);
    await expect(repositories.privacySettings.get()).resolves.toMatchObject({
      appLockEnabled: true,
      hideAmounts: true,
    });
  });
});
