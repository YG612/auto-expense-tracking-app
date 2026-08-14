import type { DatabaseConnection } from '../types';
import { AccountRepository } from './AccountRepository';
import { BudgetRepository } from './BudgetRepository';
import { CategoryRepository } from './CategoryRepository';
import { ClassificationFeedbackRepository } from './ClassificationFeedbackRepository';
import { ImportRecordRepository } from './ImportRecordRepository';
import { LedgerBackupRepository } from './LedgerBackupRepository';
import { LedgerExportRepository } from './LedgerExportRepository';
import { MerchantRepository } from './MerchantRepository';
import { PersonalizationSettingsRepository } from './PersonalizationSettingsRepository';
import { ProjectRepository } from './ProjectRepository';
import { TagRepository } from './TagRepository';
import { TransactionRepository } from './TransactionRepository';
import { TransactionTagRepository } from './TransactionTagRepository';
import { UserRuleRepository } from './UserRuleRepository';

export function createRepositories(database: DatabaseConnection) {
  return {
    accounts: new AccountRepository(database),
    budgets: new BudgetRepository(database),
    categories: new CategoryRepository(database),
    classificationFeedback: new ClassificationFeedbackRepository(database),
    importRecords: new ImportRecordRepository(database),
    ledgerBackup: new LedgerBackupRepository(database),
    ledgerExport: new LedgerExportRepository(database),
    merchants: new MerchantRepository(database),
    personalizationSettings: new PersonalizationSettingsRepository(database),
    projects: new ProjectRepository(database),
    tags: new TagRepository(database),
    transactions: new TransactionRepository(database),
    transactionTags: new TransactionTagRepository(database),
    userRules: new UserRuleRepository(database),
  } as const;
}

export type Repositories = ReturnType<typeof createRepositories>;
