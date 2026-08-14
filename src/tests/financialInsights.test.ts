import { buildFinancialInsights } from '../domain/services/financialInsights';

function expense(
  id: string,
  occurredAt: string,
  amountMinor: number,
  categoryName = '餐饮',
  merchantRawName?: string,
) {
  return {
    id,
    type: 'EXPENSE',
    occurredAt,
    amountMinor,
    categoryId: `category-${categoryName}`,
    categoryName,
    merchantRawName,
  };
}

describe('local financial insights', () => {
  it('produces traceable, bounded observations without predictive claims', () => {
    const transactions = [
      expense('rise-june', '2026-06-05T00:00:00.000Z', 10_000),
      expense('rise-july', '2026-07-05T00:00:00.000Z', 20_000),
      expense('rise-august', '2026-08-05T00:00:00.000Z', 40_000),
      expense('small-1', '2026-08-06T00:00:00.000Z', 1_000, '交通'),
      expense('small-2', '2026-08-07T00:00:00.000Z', 1_200, '交通'),
      expense('large', '2026-08-08T00:00:00.000Z', 150_000, '购物'),
      expense('sub-1', '2026-06-15T00:00:00.000Z', 9_900, '娱乐', '视频会员'),
      expense('sub-2', '2026-07-15T00:00:00.000Z', 9_900, '娱乐', '视频会员'),
      expense('sub-3', '2026-08-14T00:00:00.000Z', 9_900, '娱乐', '视频会员'),
    ];
    const insights = buildFinancialInsights({
      transactions,
      budget: {
        source: 'TOTAL',
        limitMinor: 250_000,
        spentMinor: 225_000,
        remainingMinor: 25_000,
        progress: 0.9,
        isOver: false,
        categories: [],
      },
      selectedMonth: new Date(2026, 7, 1),
      now: new Date(2026, 7, 14),
    });

    expect(insights.map(insight => insight.kind)).toEqual(
      expect.arrayContaining([
        'BUDGET_DEVIATION',
        'SAFE_TO_SPEND',
        'CATEGORY_RISING',
        'LARGE_EXPENSE',
        'SUBSCRIPTION_CANDIDATE',
      ]),
    );
    expect(insights).toHaveLength(5);
    for (const insight of insights) {
      expect(insight.calculation.length).toBeGreaterThan(0);
      expect(insight.transactionIds.length).toBeGreaterThan(0);
      expect(insight.detail).not.toMatch(/一定|保证|预测准确/u);
    }
    expect(
      insights.find(insight => insight.kind === 'CATEGORY_RISING'),
    ).toMatchObject({ calculationContainsAmount: true });
    expect(
      insights.find(insight => insight.kind === 'BUDGET_DEVIATION'),
    ).toMatchObject({ calculationContainsAmount: false });
  });

  it('stays quiet when evidence is sparse and no budget exists', () => {
    expect(
      buildFinancialInsights({
        transactions: [expense('only', '2026-08-08T00:00:00.000Z', 2_000)],
        selectedMonth: new Date(2026, 7, 1),
        now: new Date(2026, 7, 14),
      }),
    ).toEqual([]);
  });
});
