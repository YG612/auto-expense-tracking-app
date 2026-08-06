import type { TransactionType } from './Transaction';

export const RULE_TYPES = [
  'MERCHANT',
  'KEYWORD',
  'TEXT_PATTERN',
  'ACCOUNT',
  'TIME_PATTERN',
] as const;

export type RuleType = (typeof RULE_TYPES)[number];

export const RULE_ORIGINS = ['USER_CREATED', 'LEARNED_MERCHANT'] as const;

export type RuleOrigin = (typeof RULE_ORIGINS)[number];

export interface UserRule {
  id: string;
  ruleType: RuleType;
  /** Existing rows and callers that omit origin are treated as USER_CREATED. */
  origin?: RuleOrigin;
  pattern: string;
  transactionType?: TransactionType;
  categoryId?: string;
  subcategoryId?: string;
  accountId?: string;
  priority: number;
  enabled: boolean;
  usageCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}
