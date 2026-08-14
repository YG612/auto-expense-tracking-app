import type { TransactionType } from './Transaction';

export type RecurringCadence = 'WEEKLY' | 'MONTHLY';

export interface RecurringTemplate {
  id: string;
  name: string;
  type: Extract<TransactionType, 'EXPENSE' | 'INCOME'>;
  amountMinor: number;
  currency: 'CNY';
  categoryId: string;
  accountId: string;
  note?: string;
  cadence: RecurringCadence;
  nextOccurrenceAt: string;
  monthlyAnchorDay?: number;
  monthlyAnchorIsEndOfMonth?: boolean;
  enabled: boolean;
  lastGeneratedAt?: string;
  createdAt: string;
  updatedAt: string;
}
