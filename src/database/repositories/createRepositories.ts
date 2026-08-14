import type { DatabaseConnection } from '../types';
import { AccountRepository } from './AccountRepository';
import { BudgetRepository } from './BudgetRepository';
import { CategoryRepository } from './CategoryRepository';
import { ClassificationFeedbackRepository } from './ClassificationFeedbackRepository';
import { ImportRecordRepository } from './ImportRecordRepository';
import { ImportMappingTemplateRepository } from './ImportMappingTemplateRepository';
import { LedgerMaintenanceRepository } from './LedgerMaintenanceRepository';
import { LedgerExportRepository } from './LedgerExportRepository';
import { LedgerBackupRepository } from './LedgerBackupRepository';
import { MerchantRepository } from './MerchantRepository';
import { PersonalizationSettingsRepository } from './PersonalizationSettingsRepository';
import { ProjectRepository } from './ProjectRepository';
import { PrivacySettingsRepository } from './PrivacySettingsRepository';
import { ProductValueMetricsRepository } from './ProductValueMetricsRepository';
import { TagRepository } from './TagRepository';
import { StatementImportRepository } from './StatementImportRepository';
import { RecurringTemplateRepository } from './RecurringTemplateRepository';
import { TransactionRepository } from './TransactionRepository';
import { TransactionTagRepository } from './TransactionTagRepository';
import { UserRuleRepository } from './UserRuleRepository';

export function createRepositories(database: DatabaseConnection) {
  return {
    accounts: new AccountRepository(database),
    budgets: new BudgetRepository(database),
    categories: new CategoryRepository(database),
    classificationFeedback: new ClassificationFeedbackRepository(database),
    importMappingTemplates: new ImportMappingTemplateRepository(database),
    importRecords: new ImportRecordRepository(database),
    ledgerBackup: new LedgerBackupRepository(database),
    ledgerExport: new LedgerExportRepository(database),
    ledgerMaintenance: new LedgerMaintenanceRepository(database),
    merchants: new MerchantRepository(database),
    personalizationSettings: new PersonalizationSettingsRepository(database),
    projects: new ProjectRepository(database),
    privacySettings: new PrivacySettingsRepository(database),
    productValueMetrics: new ProductValueMetricsRepository(database),
    statementImport: new StatementImportRepository(database),
    recurringTemplates: new RecurringTemplateRepository(database),
    tags: new TagRepository(database),
    transactions: new TransactionRepository(database),
    transactionTags: new TransactionTagRepository(database),
    userRules: new UserRuleRepository(database),
  } as const;
}

export type Repositories = ReturnType<typeof createRepositories>;
