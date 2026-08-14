import type { DatabaseConnection, SqlRow } from '../types';
import { requiredNumber } from './mappingHelpers';
import { canonicalUtcTimestamp } from './transactionWriteIntegrity';

const DEFAULT_ACCOUNT_IDS = [
  'account-wechat',
  'account-alipay',
  'account-cash',
  'account-bank-card',
  'account-credit-card',
  'account-huabei',
  'account-other',
] as const;

type LedgerDataSummaryRow = SqlRow & {
  confirmed_count: number;
  pending_count: number;
  recycle_bin_count: number;
  project_count: number;
  tag_count: number;
  merchant_count: number;
  budget_count: number;
  rule_count: number;
  feedback_count: number;
  import_record_count: number;
  recurring_template_count: number;
  import_mapping_template_count: number;
  product_value_event_count: number;
};

export type LedgerDataSummary = {
  confirmedCount: number;
  pendingCount: number;
  recycleBinCount: number;
  projectCount: number;
  tagCount: number;
  merchantCount: number;
  budgetCount: number;
  ruleCount: number;
  feedbackCount: number;
  importRecordCount: number;
  recurringTemplateCount: number;
  importMappingTemplateCount: number;
  productValueEventCount: number;
};

export type DeleteAllUserDataResult = LedgerDataSummary & {
  deletedAt: string;
};

/**
 * Owns destructive whole-ledger maintenance. Feature code must not reproduce
 * this SQL: the complete scope and transaction boundary are security policy.
 */
export class LedgerMaintenanceRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async getDataSummary(): Promise<LedgerDataSummary> {
    const result = await this.database.execute<LedgerDataSummaryRow>(
      `SELECT
         (SELECT COUNT(*) FROM transactions
          WHERE confirmation_status = 'CONFIRMED' AND deleted_at IS NULL)
           AS confirmed_count,
         (SELECT COUNT(*) FROM transactions
          WHERE confirmation_status = 'PENDING' AND deleted_at IS NULL)
           AS pending_count,
         (SELECT COUNT(*) FROM transactions WHERE deleted_at IS NOT NULL)
           AS recycle_bin_count,
         (SELECT COUNT(*) FROM projects) AS project_count,
         (SELECT COUNT(*) FROM tags) AS tag_count,
         (SELECT COUNT(*) FROM merchants) AS merchant_count,
         (SELECT COUNT(*) FROM budgets) AS budget_count,
         (SELECT COUNT(*) FROM user_rules) AS rule_count,
         (SELECT COUNT(*) FROM classification_feedback) AS feedback_count,
         (SELECT COUNT(*) FROM import_records) AS import_record_count,
         (SELECT COUNT(*) FROM recurring_templates) AS recurring_template_count,
         (SELECT COUNT(*) FROM import_mapping_templates)
           AS import_mapping_template_count,
         (SELECT COUNT(*) FROM product_value_events) AS product_value_event_count`,
    );
    const row = result.rows[0];

    if (row === undefined) {
      throw new Error('Ledger data summary query returned no row.');
    }

    return {
      confirmedCount: requiredNumber(row, 'confirmed_count'),
      pendingCount: requiredNumber(row, 'pending_count'),
      recycleBinCount: requiredNumber(row, 'recycle_bin_count'),
      projectCount: requiredNumber(row, 'project_count'),
      tagCount: requiredNumber(row, 'tag_count'),
      merchantCount: requiredNumber(row, 'merchant_count'),
      budgetCount: requiredNumber(row, 'budget_count'),
      ruleCount: requiredNumber(row, 'rule_count'),
      feedbackCount: requiredNumber(row, 'feedback_count'),
      importRecordCount: requiredNumber(row, 'import_record_count'),
      recurringTemplateCount: requiredNumber(row, 'recurring_template_count'),
      importMappingTemplateCount: requiredNumber(
        row,
        'import_mapping_template_count',
      ),
      productValueEventCount: requiredNumber(row, 'product_value_event_count'),
    };
  }

  async deleteAllUserData(deletedAt: string): Promise<DeleteAllUserDataResult> {
    const canonicalDeletedAt = canonicalUtcTimestamp(deletedAt, 'deletedAt');
    const before = await this.getDataSummary();
    const defaultAccountPlaceholders = DEFAULT_ACCOUNT_IDS.map(() => '?').join(
      ', ',
    );

    await this.database.transaction(async transaction => {
      // Child and audit tables come first. Receipts deliberately do not have a
      // transaction FK, but deletion must cover them to prevent retained voice
      // identifiers from surviving a user-requested full erase.
      await transaction.execute('DELETE FROM transaction_tags');
      await transaction.execute('DELETE FROM classification_feedback');
      await transaction.execute('DELETE FROM recognized_operation_receipts');
      await transaction.execute('DELETE FROM product_value_events');
      await transaction.execute('DELETE FROM transactions');
      await transaction.execute('DELETE FROM user_rules');
      await transaction.execute('DELETE FROM learned_rule_suppressions');
      await transaction.execute('DELETE FROM budgets');
      await transaction.execute('DELETE FROM recurring_templates');
      await transaction.execute('DELETE FROM import_mapping_templates');
      await transaction.execute('DELETE FROM import_records');
      await transaction.execute('DELETE FROM merchants');
      await transaction.execute('DELETE FROM tags');
      await transaction.execute('DELETE FROM projects');
      await transaction.execute('DELETE FROM categories WHERE is_system = 0');
      await transaction.execute(
        `DELETE FROM accounts
         WHERE id NOT IN (${defaultAccountPlaceholders})`,
        DEFAULT_ACCOUNT_IDS,
      );

      const settings = await transaction.execute(
        `UPDATE personalization_settings
         SET learning_enabled = 1,
             retain_original_text = 1,
             local_insights_enabled = 1,
             updated_at = ?
         WHERE id = 1`,
        [canonicalDeletedAt],
      );

      if (settings.rowsAffected !== 1) {
        throw new Error('Personalization settings row is missing.');
      }
      const privacySettings = await transaction.execute(
        `UPDATE privacy_settings
         SET app_lock_enabled = 0,
             hide_amounts = 0,
             lock_timeout_seconds = 0,
             first_backup_reminder_dismissed = 0,
             last_backup_at = NULL,
             updated_at = ?
         WHERE id = 1`,
        [canonicalDeletedAt],
      );
      if (privacySettings.rowsAffected !== 1) {
        throw new Error('Privacy settings row is missing.');
      }
    });

    return { ...before, deletedAt: canonicalDeletedAt };
  }
}
