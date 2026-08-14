import type { DatabaseConnection } from '../types';
import { AccountRepository } from './AccountRepository';
import { BudgetRepository } from './BudgetRepository';
import { CategoryRepository } from './CategoryRepository';
import { ClassificationFeedbackRepository } from './ClassificationFeedbackRepository';
import { ImportRecordRepository } from './ImportRecordRepository';
import { ExperimentalFeatureSettingsRepository } from './ExperimentalFeatureSettingsRepository';
import { MerchantRepository } from './MerchantRepository';
import { PersonalizationSettingsRepository } from './PersonalizationSettingsRepository';
import { ProjectRepository } from './ProjectRepository';
import { PaymentNotificationImportRepository } from './PaymentNotificationImportRepository';
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
    experimentalFeatures: new ExperimentalFeatureSettingsRepository(database),
    importRecords: new ImportRecordRepository(database),
    merchants: new MerchantRepository(database),
    personalizationSettings: new PersonalizationSettingsRepository(database),
    projects: new ProjectRepository(database),
    paymentNotificationImports: new PaymentNotificationImportRepository(
      database,
    ),
    tags: new TagRepository(database),
    transactions: new TransactionRepository(database),
    transactionTags: new TransactionTagRepository(database),
    userRules: new UserRuleRepository(database),
  } as const;
}

export type Repositories = ReturnType<typeof createRepositories>;
