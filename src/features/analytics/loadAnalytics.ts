import type { Repositories, TransactionSummary } from '../../database';
import {
  buildDailyExpenseSeries,
  buildMonthlyTrend,
  changeMonth,
  getMonthRange,
  startOfLocalDay,
  summarizeMonthlyAnalytics,
  type DailyExpense,
  type MonthlyAnalytics,
  type MonthlyTrendPoint,
} from '../../domain/services/analytics';
import {
  buildFinancialInsights,
  type FinancialInsight,
} from '../../domain/services/financialInsights';

export type HomeDashboard = {
  monthly: MonthlyAnalytics;
  lastSevenDays: DailyExpense[];
  recentTransactions: TransactionSummary[];
  pendingCount: number;
};

export type AnalyticsDashboard = {
  monthly: MonthlyAnalytics;
  previousMonth: MonthlyAnalytics;
  monthlyTrend: MonthlyTrendPoint[];
  insights: FinancialInsight[];
};

const COUNTED_FILTERS = {
  confirmationStatus: 'CONFIRMED',
  duplicateStatus: 'NONE',
} as const;

export async function loadHomeDashboard(
  repositories: Repositories,
  now: Date,
): Promise<HomeDashboard> {
  const range = getMonthRange(now);
  const today = startOfLocalDay(now);
  const sevenDayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 6,
  );
  const tomorrow = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
  );
  const [monthTransactions, budgets, sevenDayTransactions, recent, pending] =
    await Promise.all([
      repositories.transactions.listSummaries({
        occurredFrom: range.start.toISOString(),
        occurredBefore: range.end.toISOString(),
        ...COUNTED_FILTERS,
      }),
      repositories.budgets.listForMonth(range.year, range.month),
      repositories.transactions.listSummaries({
        occurredFrom: sevenDayStart.toISOString(),
        occurredBefore: tomorrow.toISOString(),
        ...COUNTED_FILTERS,
      }),
      repositories.transactions.listSummaries({
        limit: 5,
        ...COUNTED_FILTERS,
      }),
      repositories.transactions.countPending(),
    ]);

  return {
    monthly: summarizeMonthlyAnalytics(monthTransactions, budgets, now),
    lastSevenDays: buildDailyExpenseSeries(
      sevenDayTransactions,
      sevenDayStart,
      7,
    ),
    recentTransactions: recent,
    pendingCount: pending,
  };
}

export async function loadAnalyticsDashboard(
  repositories: Repositories,
  selectedMonth: Date,
): Promise<AnalyticsDashboard> {
  const currentRange = getMonthRange(selectedMonth);
  const queryStart = getMonthRange(changeMonth(selectedMonth, -5)).start;
  const [transactions, budgets, personalization] = await Promise.all([
    repositories.transactions.listSummaries({
      occurredFrom: queryStart.toISOString(),
      occurredBefore: currentRange.end.toISOString(),
      ...COUNTED_FILTERS,
    }),
    repositories.budgets.listForMonth(currentRange.year, currentRange.month),
    repositories.personalizationSettings.get(),
  ]);

  const monthly = summarizeMonthlyAnalytics(
    transactions,
    budgets,
    selectedMonth,
  );
  return {
    monthly,
    previousMonth: summarizeMonthlyAnalytics(
      transactions,
      [],
      changeMonth(selectedMonth, -1),
    ),
    monthlyTrend: buildMonthlyTrend(transactions, selectedMonth, 6),
    insights: personalization.localInsightsEnabled
      ? buildFinancialInsights({
          transactions,
          budget: monthly.budget,
          selectedMonth,
        })
      : [],
  };
}
