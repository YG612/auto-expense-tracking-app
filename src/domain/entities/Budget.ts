export const BUDGET_PERIOD_TYPES = ['MONTHLY'] as const;

export type BudgetPeriodType = (typeof BUDGET_PERIOD_TYPES)[number];

export interface Budget {
  id: string;
  periodType: BudgetPeriodType;
  year: number;
  month: number;
  categoryId?: string;
  limitMinor: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}
