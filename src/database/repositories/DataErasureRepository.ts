import type { DatabaseConnection, SqlExecutor } from '../types';
import { canonicalUtcTimestamp } from './transactionWriteIntegrity';

const DEFAULT_ACCOUNTS = [
  ['account-wechat', '微信'],
  ['account-alipay', '支付宝'],
  ['account-cash', '现金'],
  ['account-bank-card', '银行卡'],
  ['account-credit-card', '信用卡'],
  ['account-huabei', '花呗'],
  ['account-other', '其他账户'],
] as const;

export const ERASED_USER_DATA_TABLES = [
  'model_shadow_observations',
  'classification_feedback',
  'transaction_tags',
  'recognized_operation_receipts',
  'agent_operation_receipts',
  'payment_notification_imports',
  'transactions',
  'recurring_templates',
  'budgets',
  'import_records',
  'import_mapping_templates',
  'learned_rule_suppressions',
  'user_rules',
  'merchants',
  'projects',
  'tags',
] as const;

export type DataErasureResult = {
  erasedAt: string;
  deletedRows: number;
  verifiedEmptyTables: number;
};

async function deleteAll(
  executor: SqlExecutor,
  table: (typeof ERASED_USER_DATA_TABLES)[number],
): Promise<number> {
  const result = await executor.execute(`DELETE FROM ${table}`);
  return result.rowsAffected;
}

async function verifyEmpty(
  executor: SqlExecutor,
  table: (typeof ERASED_USER_DATA_TABLES)[number],
): Promise<void> {
  const result = await executor.execute<{ remaining: number }>(
    `SELECT COUNT(*) AS remaining FROM ${table}`,
  );
  if (result.rows[0]?.remaining !== 0) {
    throw new Error(`Data erasure verification failed for ${table}.`);
  }
}

export class DataErasureRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async eraseAllUserData(erasedAt: string): Promise<DataErasureResult> {
    const canonicalErasedAt = canonicalUtcTimestamp(erasedAt, 'erasedAt');
    return this.database.transaction(async transaction => {
      let deletedRows = 0;
      for (const table of ERASED_USER_DATA_TABLES) {
        deletedRows += await deleteAll(transaction, table);
      }

      const customChildCategories = await transaction.execute(
        'DELETE FROM categories WHERE is_system = 0 AND parent_id IS NOT NULL',
      );
      const customPrimaryCategories = await transaction.execute(
        'DELETE FROM categories WHERE is_system = 0',
      );
      const customAccounts = await transaction.execute(
        `DELETE FROM accounts
          WHERE id NOT IN (${DEFAULT_ACCOUNTS.map(() => '?').join(', ')})`,
        DEFAULT_ACCOUNTS.map(([id]) => id),
      );
      deletedRows +=
        customChildCategories.rowsAffected +
        customPrimaryCategories.rowsAffected +
        customAccounts.rowsAffected;

      for (const [id, name] of DEFAULT_ACCOUNTS) {
        const reset = await transaction.execute(
          `UPDATE accounts
              SET name = ?, opening_balance_minor = NULL,
                  current_balance_minor = NULL, is_hidden = 0, updated_at = ?
            WHERE id = ?`,
          [name, canonicalErasedAt, id],
        );
        if (reset.rowsAffected !== 1) {
          throw new Error(`Default account ${id} is missing.`);
        }
      }

      const personalization = await transaction.execute(
        `UPDATE personalization_settings
            SET learning_enabled = 1, retain_original_text = 1, updated_at = ?
          WHERE id = 1`,
        [canonicalErasedAt],
      );
      const experiments = await transaction.execute(
        `UPDATE experimental_feature_settings
            SET payment_notifications_enabled = 0, image_ocr_enabled = 0,
                updated_at = ?
          WHERE id = 1`,
        [canonicalErasedAt],
      );
      const privacy = await transaction.execute(
        `UPDATE privacy_settings
            SET app_lock_enabled = 0, hide_amounts = 0,
                lock_timeout_seconds = 0, onboarding_completed = 0,
                first_backup_reminder_dismissed = 0, last_backup_at = NULL,
                updated_at = ?
          WHERE id = 1`,
        [canonicalErasedAt],
      );
      if (
        personalization.rowsAffected !== 1 ||
        experiments.rowsAffected !== 1 ||
        privacy.rowsAffected !== 1
      ) {
        throw new Error('Data erasure could not reset application settings.');
      }

      for (const table of ERASED_USER_DATA_TABLES) {
        await verifyEmpty(transaction, table);
      }
      const remainingCustomData = await transaction.execute<{
        custom_categories: number;
        custom_accounts: number;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM categories WHERE is_system = 0)
             AS custom_categories,
           (SELECT COUNT(*) FROM accounts
             WHERE id NOT IN (${DEFAULT_ACCOUNTS.map(() => '?').join(', ')}))
             AS custom_accounts`,
        DEFAULT_ACCOUNTS.map(([id]) => id),
      );
      if (
        remainingCustomData.rows[0]?.custom_categories !== 0 ||
        remainingCustomData.rows[0]?.custom_accounts !== 0
      ) {
        throw new Error(
          'Data erasure verification found custom reference data.',
        );
      }

      return {
        erasedAt: canonicalErasedAt,
        deletedRows,
        verifiedEmptyTables: ERASED_USER_DATA_TABLES.length,
      };
    });
  }
}
