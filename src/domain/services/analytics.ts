import type { Budget, Transaction } from '../entities';

export const ANALYTICS_CURRENCY = 'CNY';

export type AnalyticsTransaction = Pick<
  Transaction,
  | 'id'
  | 'type'
  | 'amountMinor'
  | 'currency'
  | 'occurredAt'
  | 'categoryId'
  | 'relatedTransactionId'
  | 'confirmationStatus'
  | 'duplicateStatus'
  | 'deletedAt'
> & {
  categoryName?: string;
  categoryIcon?: string;
  categoryType?: 'EXPENSE' | 'INCOME';
  relatedCategoryId?: string;
  relatedCategoryName?: string;
  relatedCategoryIcon?: string;
};

export type MonthRange = {
  year: number;
  month: number;
  start: Date;
  end: Date;
};

export type CategoryAmount = {
  categoryId?: string;
  name: string;
  icon?: string;
  amountMinor: number;
  percentage: number;
};

export type DailyExpense = {
  date: string;
  label: string;
  amountMinor: number;
};

export type CategoryBudgetProgress = {
  categoryId: string;
  name: string;
  limitMinor: number;
  spentMinor: number;
  remainingMinor: number;
  progress: number;
  isOver: boolean;
};

export type BudgetProgress = {
  source: 'TOTAL' | 'CATEGORY_TOTAL';
  limitMinor: number;
  spentMinor: number;
  remainingMinor: number;
  progress: number;
  isOver: boolean;
  categories: CategoryBudgetProgress[];
};

export type MonthlyAnalytics = {
  range: MonthRange;
  expenseMinor: number;
  incomeMinor: number;
  reimbursementMinor: number;
  balanceMinor: number;
  transactionCount: number;
  expenseCategories: CategoryAmount[];
  incomeSources: CategoryAmount[];
  dailyExpenses: DailyExpense[];
  budget?: BudgetProgress;
};

export type MonthlyTrendPoint = {
  key: string;
  label: string;
  expenseMinor: number;
  incomeMinor: number;
  reimbursementMinor: number;
  balanceMinor: number;
};

type CategoryIdentity = {
  categoryId?: string;
  name: string;
  icon?: string;
};

type MutableCategoryTotal = CategoryIdentity & {
  amountMinor: number;
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;
}

export function getMonthRange(date: Date): MonthRange {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);

  return {
    year: start.getFullYear(),
    month: start.getMonth() + 1,
    start,
    end,
  };
}

export function changeMonth(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isAnalyticsEligible(
  transaction: AnalyticsTransaction,
): boolean {
  return (
    transaction.currency === ANALYTICS_CURRENCY &&
    transaction.deletedAt === undefined &&
    transaction.confirmationStatus === 'CONFIRMED' &&
    transaction.duplicateStatus === 'NONE'
  );
}

function inRange(
  transaction: AnalyticsTransaction,
  start: Date,
  end: Date,
): boolean {
  const timestamp = new Date(transaction.occurredAt).getTime();
  return (
    Number.isFinite(timestamp) &&
    timestamp >= start.getTime() &&
    timestamp < end.getTime()
  );
}

function expenseEffect(transaction: AnalyticsTransaction): number {
  if (transaction.type === 'EXPENSE') {
    return transaction.amountMinor;
  }

  if (transaction.type === 'REFUND') {
    return -transaction.amountMinor;
  }

  return 0;
}

function expenseCategory(transaction: AnalyticsTransaction): CategoryIdentity {
  if (transaction.type === 'REFUND') {
    if (transaction.relatedCategoryId !== undefined) {
      return {
        categoryId: transaction.relatedCategoryId,
        name: transaction.relatedCategoryName ?? '原支出分类',
        icon: transaction.relatedCategoryIcon,
      };
    }

    if (
      transaction.categoryType === 'EXPENSE' &&
      transaction.categoryId !== undefined
    ) {
      return {
        categoryId: transaction.categoryId,
        name: transaction.categoryName ?? '未分类',
        icon: transaction.categoryIcon,
      };
    }

    return { name: '未关联退款', icon: '↩' };
  }

  return {
    categoryId: transaction.categoryId,
    name: transaction.categoryName ?? '未分类',
    icon: transaction.categoryIcon,
  };
}

function incomeCategory(transaction: AnalyticsTransaction): CategoryIdentity {
  return {
    categoryId: transaction.categoryId,
    name: transaction.categoryName ?? '其他收入',
    icon: transaction.categoryIcon,
  };
}

function categoryKey(identity: CategoryIdentity): string {
  return identity.categoryId ?? `name:${identity.name}`;
}

function addCategoryAmount(
  totals: Map<string, MutableCategoryTotal>,
  identity: CategoryIdentity,
  amountMinor: number,
): void {
  const key = categoryKey(identity);
  const current = totals.get(key);

  if (current === undefined) {
    totals.set(key, { ...identity, amountMinor });
    return;
  }

  current.amountMinor += amountMinor;
}

function rankedCategoryAmounts(
  totals: ReadonlyMap<string, MutableCategoryTotal>,
): CategoryAmount[] {
  const positive = [...totals.values()]
    .filter(item => item.amountMinor > 0)
    .sort((left, right) => right.amountMinor - left.amountMinor);
  const basis = positive.reduce((sum, item) => sum + item.amountMinor, 0);

  return positive.map(item => ({
    ...item,
    percentage:
      basis === 0 ? 0 : Math.round((item.amountMinor / basis) * 1000) / 10,
  }));
}

function progressValue(spentMinor: number, limitMinor: number): number {
  if (limitMinor === 0) {
    return spentMinor === 0 ? 0 : 1;
  }

  return spentMinor / limitMinor;
}

function buildBudgetProgress(
  budgets: readonly Budget[],
  expenseMinor: number,
  expenseCategoryTotals: ReadonlyMap<string, MutableCategoryTotal>,
): BudgetProgress | undefined {
  const applicable = budgets.filter(
    budget =>
      budget.periodType === 'MONTHLY' && budget.currency === ANALYTICS_CURRENCY,
  );
  const totalBudget = applicable.find(
    budget => budget.categoryId === undefined,
  );
  const categoryBudgets = applicable.filter(
    (budget): budget is Budget & { categoryId: string } =>
      budget.categoryId !== undefined,
  );

  if (totalBudget === undefined && categoryBudgets.length === 0) {
    return undefined;
  }

  const categories = categoryBudgets
    .map(budget => {
      const category = expenseCategoryTotals.get(budget.categoryId);
      const spentMinor = Math.max(0, category?.amountMinor ?? 0);
      const remainingMinor = budget.limitMinor - spentMinor;

      return {
        categoryId: budget.categoryId,
        name: category?.name ?? '分类预算',
        limitMinor: budget.limitMinor,
        spentMinor,
        remainingMinor,
        progress: progressValue(spentMinor, budget.limitMinor),
        isOver: remainingMinor < 0,
      };
    })
    .sort((left, right) => right.progress - left.progress);

  const limitMinor =
    totalBudget?.limitMinor ??
    categories.reduce((sum, category) => sum + category.limitMinor, 0);
  const spentMinor =
    totalBudget === undefined
      ? categories.reduce((sum, category) => sum + category.spentMinor, 0)
      : Math.max(0, expenseMinor);
  const remainingMinor = limitMinor - spentMinor;

  return {
    source: totalBudget === undefined ? 'CATEGORY_TOTAL' : 'TOTAL',
    limitMinor,
    spentMinor,
    remainingMinor,
    progress: progressValue(spentMinor, limitMinor),
    isOver: remainingMinor < 0,
    categories,
  };
}

export function buildDailyExpenseSeries(
  transactions: readonly AnalyticsTransaction[],
  startDate: Date,
  dayCount: number,
): DailyExpense[] {
  const start = startOfLocalDay(startDate);
  const days = Array.from({ length: Math.max(0, dayCount) }, (_, index) => {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + index,
    );

    return {
      date: localDateKey(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      amountMinor: 0,
    };
  });
  const byDate = new Map(days.map(day => [day.date, day]));

  for (const transaction of transactions) {
    if (!isAnalyticsEligible(transaction)) {
      continue;
    }

    const date = new Date(transaction.occurredAt);
    if (!Number.isFinite(date.getTime())) {
      continue;
    }

    const day = byDate.get(localDateKey(date));
    if (day !== undefined) {
      day.amountMinor += expenseEffect(transaction);
    }
  }

  return days;
}

export function summarizeMonthlyAnalytics(
  transactions: readonly AnalyticsTransaction[],
  budgets: readonly Budget[],
  monthDate: Date,
): MonthlyAnalytics {
  const range = getMonthRange(monthDate);
  const eligible = transactions.filter(
    transaction =>
      isAnalyticsEligible(transaction) &&
      inRange(transaction, range.start, range.end),
  );
  let expenseMinor = 0;
  let incomeMinor = 0;
  let reimbursementMinor = 0;
  const expenseCategoryTotals = new Map<string, MutableCategoryTotal>();
  const incomeCategoryTotals = new Map<string, MutableCategoryTotal>();

  for (const transaction of eligible) {
    const expense = expenseEffect(transaction);
    if (expense !== 0) {
      expenseMinor += expense;
      addCategoryAmount(
        expenseCategoryTotals,
        expenseCategory(transaction),
        expense,
      );
    }

    if (transaction.type === 'INCOME') {
      incomeMinor += transaction.amountMinor;
      addCategoryAmount(
        incomeCategoryTotals,
        incomeCategory(transaction),
        transaction.amountMinor,
      );
    } else if (transaction.type === 'REIMBURSEMENT') {
      reimbursementMinor += transaction.amountMinor;
    }
  }

  const dayCount = new Date(range.year, range.month, 0).getDate();

  return {
    range,
    expenseMinor,
    incomeMinor,
    reimbursementMinor,
    balanceMinor: incomeMinor + reimbursementMinor - expenseMinor,
    transactionCount: eligible.length,
    expenseCategories: rankedCategoryAmounts(expenseCategoryTotals),
    incomeSources: rankedCategoryAmounts(incomeCategoryTotals),
    dailyExpenses: buildDailyExpenseSeries(eligible, range.start, dayCount),
    budget: buildBudgetProgress(budgets, expenseMinor, expenseCategoryTotals),
  };
}

export function buildMonthlyTrend(
  transactions: readonly AnalyticsTransaction[],
  endMonth: Date,
  monthCount: number,
): MonthlyTrendPoint[] {
  return Array.from({ length: Math.max(0, monthCount) }, (_, index) => {
    const month = changeMonth(endMonth, index - monthCount + 1);
    const report = summarizeMonthlyAnalytics(transactions, [], month);

    return {
      key: `${report.range.year}-${pad2(report.range.month)}`,
      label: `${report.range.month}月`,
      expenseMinor: report.expenseMinor,
      incomeMinor: report.incomeMinor,
      reimbursementMinor: report.reimbursementMinor,
      balanceMinor: report.balanceMinor,
    };
  });
}
