import { createRepositories } from '../../database';
import { openMigratedTestDatabase } from './testDatabase';

const createdAt = '2026-08-13T12:00:00.000Z';

async function seedUserLedgerData(
  database: Awaited<ReturnType<typeof openMigratedTestDatabase>>,
) {
  await database.execute(
    `INSERT INTO projects (
       id, name, currency, is_archived, created_at, updated_at
     ) VALUES ('project-user', '旅行', 'CNY', 0, ?, ?)`,
    [createdAt, createdAt],
  );
  await database.execute(
    `INSERT INTO tags (id, name, created_at, updated_at)
     VALUES ('tag-user', '出差', ?, ?)`,
    [createdAt, createdAt],
  );
  await database.execute(
    `INSERT INTO merchants (
       id, canonical_name, normalized_name, aliases_json, created_at, updated_at
     ) VALUES ('merchant-user', '示例商户', '示例商户', '[]', ?, ?)`,
    [createdAt, createdAt],
  );
  await database.execute(
    `INSERT INTO transactions (
       id, type, amount_minor, currency, occurred_at, category_id, account_id,
       merchant_id, project_id, source, original_text, confirmation_status,
       duplicate_status, created_at, updated_at, deleted_at, sync_status
     ) VALUES (
       'transaction-confirmed', 'EXPENSE', 3200, 'CNY', ?,
       'category-expense-food-lunch', 'account-wechat', 'merchant-user',
       'project-user', 'TEXT', '午饭32元', 'CONFIRMED', 'NONE', ?, ?, NULL,
       'LOCAL_ONLY'
     )`,
    [createdAt, createdAt, createdAt],
  );
  await database.execute(
    `INSERT INTO transactions (
       id, type, amount_minor, currency, occurred_at, account_id, source,
       confirmation_status, duplicate_status, created_at, updated_at,
       deleted_at, sync_status, requires_review,
       review_reason_codes_json
     ) VALUES (
       'transaction-pending', 'EXPENSE', 800, 'CNY', ?, 'account-cash',
       'MANUAL', 'PENDING', 'NONE', ?, ?, NULL, 'LOCAL_ONLY', 1,
       '["MISSING_CATEGORY"]'
     )`,
    [createdAt, createdAt, createdAt],
  );
  await database.execute(
    `INSERT INTO transactions (
       id, type, amount_minor, currency, occurred_at, account_id, source,
       confirmation_status, duplicate_status, created_at, updated_at,
       deleted_at, sync_status
     ) VALUES (
       'transaction-deleted', 'EXPENSE', 500, 'CNY', ?, 'account-cash',
       'MANUAL', 'CONFIRMED', 'NONE', ?, ?, ?, 'LOCAL_ONLY'
     )`,
    [createdAt, createdAt, createdAt, createdAt],
  );
  await database.execute(
    `INSERT INTO transaction_tags (transaction_id, tag_id)
     VALUES ('transaction-confirmed', 'tag-user')`,
  );
  await database.execute(
    `INSERT INTO user_rules (
       id, rule_type, pattern, category_id, priority, enabled, usage_count,
       created_at, updated_at
     ) VALUES (
       'rule-user', 'MERCHANT', '示例商户', 'category-expense-food-lunch',
       10, 1, 0, ?, ?
     )`,
    [createdAt, createdAt],
  );
  await database.execute(
    `INSERT INTO classification_feedback (
       id, transaction_id, corrected_category_id, source_text,
       merchant_raw_name, created_at
     ) VALUES (
       'feedback-user', 'transaction-confirmed',
       'category-expense-food-lunch', '午饭32元', '示例商户', ?
     )`,
    [createdAt],
  );
  await database.execute(
    `INSERT INTO budgets (
       id, period_type, year, month, limit_minor, currency,
       created_at, updated_at
     ) VALUES ('budget-user', 'MONTHLY', 2026, 8, 100000, 'CNY', ?, ?)`,
    [createdAt, createdAt],
  );
  await database.execute(
    `INSERT INTO import_records (
       id, source, file_name, parsed_count, imported_count,
       duplicate_count, failed_count, created_at
     ) VALUES ('import-user', 'CSV', 'ledger.csv', 1, 1, 0, 0, ?)`,
    [createdAt],
  );
  await database.execute(
    `INSERT INTO recurring_templates (
       id, name, type, amount_minor, currency, category_id, account_id,
       cadence, next_occurrence_at, confirmation_policy, enabled,
       created_at, updated_at
     ) VALUES (
       'recurring-user', '每周午餐', 'EXPENSE', 2500, 'CNY',
       'category-expense-food-lunch', 'account-wechat', 'WEEKLY', ?,
       'DRAFT', 1, ?, ?
     )`,
    [createdAt, createdAt, createdAt],
  );
  await database.execute(
    `INSERT INTO learned_rule_suppressions (rule_type, pattern, suppressed_at)
     VALUES ('MERCHANT', '已删除规则', ?)`,
    [createdAt],
  );
  await database.execute(
    `INSERT INTO import_mapping_templates (
       id, name, mapping_json, created_at, updated_at
     ) VALUES ('mapping-user', '旧账本', ?, ?, ?)`,
    [
      JSON.stringify({ occurredAt: '日期', amount: '金额' }),
      createdAt,
      createdAt,
    ],
  );
}

describe('LedgerMaintenanceRepository', () => {
  it('summarizes and atomically deletes all user-owned ledger data', async () => {
    const database = await openMigratedTestDatabase();

    try {
      await seedUserLedgerData(database);
      const repositories = createRepositories(database);

      await expect(
        repositories.ledgerMaintenance.getDataSummary(),
      ).resolves.toEqual({
        confirmedCount: 1,
        pendingCount: 1,
        recycleBinCount: 1,
        projectCount: 1,
        tagCount: 1,
        merchantCount: 1,
        budgetCount: 1,
        ruleCount: 1,
        feedbackCount: 1,
        importRecordCount: 1,
        recurringTemplateCount: 1,
        importMappingTemplateCount: 1,
        productValueEventCount: 0,
      });

      await expect(
        repositories.ledgerMaintenance.deleteAllUserData(
          '2026-08-13T13:00:00.000Z',
        ),
      ).resolves.toMatchObject({
        confirmedCount: 1,
        pendingCount: 1,
        recycleBinCount: 1,
        deletedAt: '2026-08-13T13:00:00.000Z',
      });

      await expect(
        repositories.ledgerMaintenance.getDataSummary(),
      ).resolves.toEqual({
        confirmedCount: 0,
        pendingCount: 0,
        recycleBinCount: 0,
        projectCount: 0,
        tagCount: 0,
        merchantCount: 0,
        budgetCount: 0,
        ruleCount: 0,
        feedbackCount: 0,
        importRecordCount: 0,
        recurringTemplateCount: 0,
        importMappingTemplateCount: 0,
        productValueEventCount: 0,
      });

      const referenceData = await database.execute<{
        categories: number;
        accounts: number;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM categories WHERE is_system = 1) AS categories,
           (SELECT COUNT(*) FROM accounts) AS accounts`,
      );
      expect(referenceData.rows[0]?.categories).toBeGreaterThan(100);
      expect(referenceData.rows[0]?.accounts).toBe(7);

      const settings = await repositories.personalizationSettings.get();
      expect(settings).toEqual({
        learningEnabled: true,
        retainOriginalText: true,
        localInsightsEnabled: true,
        updatedAt: '2026-08-13T13:00:00.000Z',
      });
    } finally {
      database.close();
    }
  });

  it('rolls back earlier deletes when any table deletion fails', async () => {
    const database = await openMigratedTestDatabase();

    try {
      await seedUserLedgerData(database);
      const repositories = createRepositories(database);
      await database.execute(
        `CREATE TRIGGER prevent_transaction_delete
         BEFORE DELETE ON transactions
         BEGIN
           SELECT RAISE(ABORT, 'simulated delete failure');
         END`,
      );

      await expect(
        repositories.ledgerMaintenance.deleteAllUserData(
          '2026-08-13T13:00:00.000Z',
        ),
      ).rejects.toThrow();

      await expect(
        repositories.ledgerMaintenance.getDataSummary(),
      ).resolves.toMatchObject({
        confirmedCount: 1,
        pendingCount: 1,
        recycleBinCount: 1,
        feedbackCount: 1,
        ruleCount: 1,
      });
      const links = await database.execute<{ count: number }>(
        'SELECT COUNT(*) AS count FROM transaction_tags',
      );
      expect(links.rows[0]?.count).toBe(1);
    } finally {
      database.close();
    }
  });
});
