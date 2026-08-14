import { render } from '@testing-library/react-native';

import type { FinancialInsight } from '../domain/services/financialInsights';
import { FinancialInsightList } from '../features/analytics/components/AnalyticsViews';

const insight: FinancialInsight = {
  id: 'category-rising-food',
  kind: 'CATEGORY_RISING',
  title: '餐饮连续三个月上涨',
  detail: '仅描述历史变化。',
  calculation: '100元 → 200元 → 400元',
  calculationContainsAmount: true,
  amountMinor: 40_000,
  transactionIds: ['one', 'two', 'three'],
};

describe('FinancialInsightList amount privacy', () => {
  it('removes exact calculation amounts from visible and accessibility text', async () => {
    const screen = await render(
      <FinancialInsightList hideAmounts insights={[insight]} />,
    );

    expect(screen.getByText('具体金额已隐藏')).toBeTruthy();
    expect(screen.queryByText(insight.calculation)).toBeNull();
    const card = screen.getByLabelText(/餐饮连续三个月上涨/u);
    expect(card.props.accessibilityLabel).toContain('具体金额已隐藏');
    expect(card.props.accessibilityLabel).not.toMatch(/100元|200元|400元/u);
  });

  it('keeps non-amount calculations visible in hidden mode', async () => {
    const screen = await render(
      <FinancialInsightList
        hideAmounts
        insights={[
          {
            ...insight,
            id: 'budget',
            kind: 'BUDGET_DEVIATION',
            calculation: '已确认支出 ÷ 月度预算 = 90%',
            calculationContainsAmount: false,
          },
        ]}
      />,
    );

    expect(screen.getByText('已确认支出 ÷ 月度预算 = 90%')).toBeTruthy();
  });
});
