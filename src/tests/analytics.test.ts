import type { Budget } from '../domain/entities';
import {
  buildDailyExpenseSeries,
  buildMonthlyTrend,
  summarizeMonthlyAnalytics,
  type AnalyticsTransaction,
} from '../domain/services/analytics';

const AUGUST = new Date(2026, 7, 15, 12);
const createdAt = new Date(2026, 7, 1, 8).toISOString();

function occurredAt(day: number, hour = 12): string {
  return new Date(2026, 7, day, hour).toISOString();
}

function transaction(
  overrides: Partial<AnalyticsTransaction> &
    Pick<AnalyticsTransaction, 'id' | 'type' | 'amountMinor'>,
): AnalyticsTransaction {
  return {
    currency: 'CNY',
    occurredAt: occurredAt(10),
    confirmationStatus: 'CONFIRMED',
    duplicateStatus: 'NONE',
    ...overrides,
  };
}

function budget(
  overrides: Partial<Budget> & Pick<Budget, 'id' | 'limitMinor'>,
): Budget {
  return {
    periodType: 'MONTHLY',
    year: 2026,
    month: 8,
    currency: 'CNY',
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

describe('monthly analytics', () => {
  it('implements acceptance test 19 without counting transfers or repayments', () => {
    const report = summarizeMonthlyAnalytics(
      [
        transaction({
          id: 'lunch',
          type: 'EXPENSE',
          amountMinor: 2500,
          categoryId: 'food',
          categoryName: '餐饮',
        }),
        transaction({
          id: 'transfer',
          type: 'TRANSFER',
          amountMinor: 50_000,
        }),
        transaction({
          id: 'repayment',
          type: 'REPAYMENT_OUT',
          amountMinor: 200_000,
        }),
        transaction({
          id: 'salary',
          type: 'INCOME',
          amountMinor: 800_000,
          categoryId: 'salary',
          categoryName: '工资',
        }),
      ],
      [],
      AUGUST,
    );

    expect(report.expenseMinor).toBe(2500);
    expect(report.incomeMinor).toBe(800_000);
    expect(report.balanceMinor).toBe(797_500);
    expect(report.expenseCategories).toEqual([
      expect.objectContaining({
        categoryId: 'food',
        name: '餐饮',
        amountMinor: 2500,
        percentage: 100,
      }),
    ]);
  });

  it('implements acceptance test 20 by applying a refund to the original category', () => {
    const report = summarizeMonthlyAnalytics(
      [
        transaction({
          id: 'dinner',
          type: 'EXPENSE',
          amountMinor: 5000,
          categoryId: 'food',
          categoryName: '餐饮',
        }),
        transaction({
          id: 'refund',
          type: 'REFUND',
          amountMinor: 2000,
          categoryId: 'refund-income-category',
          categoryName: '退款',
          categoryType: 'INCOME',
          relatedTransactionId: 'dinner',
          relatedCategoryId: 'food',
          relatedCategoryName: '餐饮',
        }),
      ],
      [],
      AUGUST,
    );

    expect(report.expenseMinor).toBe(3000);
    expect(report.incomeMinor).toBe(0);
    expect(report.balanceMinor).toBe(-3000);
    expect(report.expenseCategories).toEqual([
      expect.objectContaining({
        categoryId: 'food',
        name: '餐饮',
        amountMinor: 3000,
      }),
    ]);
  });

  it('excludes deleted, pending, rejected, possible-duplicate and merged rows', () => {
    const report = summarizeMonthlyAnalytics(
      [
        transaction({ id: 'valid', type: 'EXPENSE', amountMinor: 1000 }),
        transaction({
          id: 'deleted',
          type: 'EXPENSE',
          amountMinor: 2000,
          deletedAt: occurredAt(11),
        }),
        transaction({
          id: 'pending',
          type: 'EXPENSE',
          amountMinor: 3000,
          confirmationStatus: 'PENDING',
        }),
        transaction({
          id: 'rejected',
          type: 'EXPENSE',
          amountMinor: 4000,
          confirmationStatus: 'REJECTED',
        }),
        transaction({
          id: 'possible',
          type: 'EXPENSE',
          amountMinor: 5000,
          duplicateStatus: 'POSSIBLE',
        }),
        transaction({
          id: 'merged',
          type: 'EXPENSE',
          amountMinor: 6000,
          duplicateStatus: 'MERGED',
        }),
      ],
      [],
      AUGUST,
    );

    expect(report.expenseMinor).toBe(1000);
    expect(report.transactionCount).toBe(1);
  });

  it('keeps reimbursements separate from ordinary income while including them in balance', () => {
    const report = summarizeMonthlyAnalytics(
      [
        transaction({ id: 'expense', type: 'EXPENSE', amountMinor: 10_000 }),
        transaction({ id: 'income', type: 'INCOME', amountMinor: 30_000 }),
        transaction({
          id: 'reimbursement',
          type: 'REIMBURSEMENT',
          amountMinor: 4000,
        }),
        transaction({ id: 'borrow', type: 'BORROW_IN', amountMinor: 50_000 }),
        transaction({ id: 'lend', type: 'LEND_OUT', amountMinor: 20_000 }),
      ],
      [],
      AUGUST,
    );

    expect(report.expenseMinor).toBe(10_000);
    expect(report.incomeMinor).toBe(30_000);
    expect(report.reimbursementMinor).toBe(4000);
    expect(report.balanceMinor).toBe(24_000);
  });

  it('calculates total and category budget progress with integer minor units', () => {
    const report = summarizeMonthlyAnalytics(
      [
        transaction({
          id: 'food',
          type: 'EXPENSE',
          amountMinor: 12_000,
          categoryId: 'food',
          categoryName: '餐饮',
        }),
      ],
      [
        budget({ id: 'total', limitMinor: 10_000 }),
        budget({ id: 'food-budget', limitMinor: 8000, categoryId: 'food' }),
      ],
      AUGUST,
    );

    expect(report.budget).toMatchObject({
      source: 'TOTAL',
      limitMinor: 10_000,
      spentMinor: 12_000,
      remainingMinor: -2000,
      progress: 1.2,
      isOver: true,
    });
    expect(report.budget?.categories[0]).toMatchObject({
      categoryId: 'food',
      name: '餐饮',
      spentMinor: 12_000,
      remainingMinor: -4000,
      isOver: true,
    });
  });

  it('uses local month and day boundaries and builds a six-month trend', () => {
    const previousMonth = new Date(2026, 6, 31, 23, 59, 59).toISOString();
    const firstMoment = new Date(2026, 7, 1, 0, 0, 0).toISOString();
    const lastMoment = new Date(2026, 7, 31, 23, 59, 59).toISOString();
    const nextMonth = new Date(2026, 8, 1, 0, 0, 0).toISOString();
    const rows = [
      transaction({
        id: 'previous',
        type: 'EXPENSE',
        amountMinor: 100,
        occurredAt: previousMonth,
      }),
      transaction({
        id: 'first',
        type: 'EXPENSE',
        amountMinor: 200,
        occurredAt: firstMoment,
      }),
      transaction({
        id: 'last',
        type: 'EXPENSE',
        amountMinor: 300,
        occurredAt: lastMoment,
      }),
      transaction({
        id: 'next',
        type: 'EXPENSE',
        amountMinor: 400,
        occurredAt: nextMonth,
      }),
    ];
    const report = summarizeMonthlyAnalytics(rows, [], AUGUST);
    const firstTwoDays = buildDailyExpenseSeries(rows, new Date(2026, 7, 1), 2);
    const trend = buildMonthlyTrend(rows, AUGUST, 6);

    expect(report.expenseMinor).toBe(500);
    expect(firstTwoDays.map(day => day.amountMinor)).toEqual([200, 0]);
    expect(trend).toHaveLength(6);
    expect(trend.at(-1)).toMatchObject({ label: '8月', expenseMinor: 500 });
  });
});
