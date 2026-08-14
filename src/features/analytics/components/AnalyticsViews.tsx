import type { ReactNode } from 'react';
import {
  type DimensionValue,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { formatPrivateAmount } from '../../../domain/services/amountPrivacy';
import type {
  BudgetProgress,
  CategoryAmount,
  DailyExpense,
  MonthlyAnalytics,
  MonthlyTrendPoint,
} from '../../../domain/services/analytics';
import type { FinancialInsight } from '../../../domain/services/financialInsights';
import {
  colors,
  control,
  radius,
  shadows,
  spacing,
  typography,
} from '../../../theme/tokens';

export function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

function Metric({
  label,
  value,
  tone,
  hideAmounts,
}: {
  label: string;
  value: number;
  tone: 'expense' | 'income';
  hideAmounts: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.65}
        numberOfLines={1}
        style={[
          styles.metricValue,
          tone === 'expense' ? styles.expenseText : styles.incomeText,
        ]}
      >
        {formatPrivateAmount(value, hideAmounts)}
      </Text>
    </View>
  );
}

export function MonthlySummary({
  report,
  hideAmounts,
}: {
  report: MonthlyAnalytics;
  hideAmounts: boolean;
}) {
  return (
    <View style={styles.summaryCard}>
      <View pointerEvents="none" style={styles.summaryGlowLarge} />
      <View pointerEvents="none" style={styles.summaryGlowSmall} />
      <Text style={styles.balanceLabel}>本月结余</Text>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        numberOfLines={1}
        style={styles.balanceValue}
      >
        {formatPrivateAmount(report.balanceMinor, hideAmounts)}
      </Text>
      {report.reimbursementMinor === 0 ? null : (
        <Text style={styles.reimbursementText}>
          结余含报销回款{' '}
          {formatPrivateAmount(report.reimbursementMinor, hideAmounts)}
        </Text>
      )}
      <View style={styles.metricRow}>
        <Metric
          hideAmounts={hideAmounts}
          label="本月支出"
          tone="expense"
          value={report.expenseMinor}
        />
        <View style={styles.metricDivider} />
        <Metric
          hideAmounts={hideAmounts}
          label="本月收入"
          tone="income"
          value={report.incomeMinor}
        />
      </View>
    </View>
  );
}

function percentWidth(value: number): DimensionValue {
  return `${Math.max(0, Math.min(100, value))}%`;
}

function barHeight(height: number): { height: number } {
  return { height };
}

export function CategoryRanking({
  categories,
  emptyText,
  onSelect,
  limit,
  hideAmounts,
}: {
  categories: readonly CategoryAmount[];
  emptyText: string;
  onSelect?: (category: CategoryAmount) => void;
  limit?: number;
  hideAmounts: boolean;
}) {
  const rows = limit === undefined ? categories : categories.slice(0, limit);

  if (rows.length === 0) {
    return <Text style={styles.emptyText}>{emptyText}</Text>;
  }

  return (
    <View style={styles.rankingList}>
      {rows.map((category, index) => (
        <Pressable
          accessibilityRole={onSelect === undefined ? undefined : 'button'}
          disabled={onSelect === undefined}
          key={category.categoryId ?? `${category.name}-${index}`}
          onPress={() => onSelect?.(category)}
          style={styles.rankingRow}
        >
          <View style={styles.rankIdentity}>
            <Text style={styles.rankNumber}>{index + 1}</Text>
            <Text style={styles.rankIcon}>{category.icon ?? '•'}</Text>
            <View style={styles.rankMain}>
              <View style={styles.rankTextRow}>
                <Text numberOfLines={1} style={styles.rankName}>
                  {category.name}
                </Text>
                <Text style={styles.rankPercentage}>
                  {category.percentage.toFixed(1)}%
                </Text>
              </View>
              <View style={styles.rankTrack}>
                <View
                  style={[
                    styles.rankFill,
                    { width: percentWidth(category.percentage) },
                  ]}
                />
              </View>
            </View>
          </View>
          <Text style={styles.rankAmount}>
            {formatPrivateAmount(category.amountMinor, hideAmounts)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function DailyExpenseChart({
  days,
  hideAmounts,
}: {
  days: readonly DailyExpense[];
  hideAmounts: boolean;
}) {
  const max = Math.max(...days.map(day => Math.abs(day.amountMinor)), 0);

  if (max === 0) {
    return <Text style={styles.emptyText}>这段时间还没有消费支出。</Text>;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.dailyChart}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {days.map(day => {
        const height =
          day.amountMinor === 0
            ? 0
            : Math.max(4, Math.round((Math.abs(day.amountMinor) / max) * 84));
        const isRefundDay = day.amountMinor < 0;

        return (
          <View
            accessible
            accessibilityLabel={`${day.label}净支出${formatPrivateAmount(day.amountMinor, hideAmounts)}`}
            key={day.date}
            style={styles.dayColumn}
          >
            <View style={styles.barArea}>
              <View
                style={[
                  styles.dayBar,
                  isRefundDay && styles.refundBar,
                  { height },
                ]}
              />
            </View>
            <Text style={styles.dayLabel}>{day.label}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

export function BudgetOverview({
  budget,
  hideAmounts,
}: {
  budget: BudgetProgress | undefined;
  hideAmounts: boolean;
}) {
  if (budget === undefined) {
    return (
      <View style={styles.budgetEmpty}>
        <Text style={styles.emptyTitle}>本月尚未设置预算</Text>
        <Text style={styles.emptyText}>
          可在“设置 → 月度预算”中设置总预算和分类预算。
        </Text>
      </View>
    );
  }

  const percentage = Math.round(budget.progress * 100);

  return (
    <View style={styles.budgetContent}>
      <View style={styles.budgetTop}>
        <View>
          <Text style={styles.budgetCaption}>
            {budget.source === 'TOTAL' ? '月度总预算' : '分类预算合计'}
          </Text>
          <Text style={styles.budgetValue}>
            {budget.isOver ? '已超出' : '还可用'}{' '}
            {formatPrivateAmount(Math.abs(budget.remainingMinor), hideAmounts)}
          </Text>
        </View>
        <Text style={[styles.budgetPercent, budget.isOver && styles.overText]}>
          {percentage}%
        </Text>
      </View>
      <View style={styles.budgetTrack}>
        <View
          style={[
            styles.budgetFill,
            budget.isOver && styles.overFill,
            { width: percentWidth(percentage) },
          ]}
        />
      </View>
      <Text style={styles.budgetMeta}>
        已用 {formatPrivateAmount(budget.spentMinor, hideAmounts)} / 预算{' '}
        {formatPrivateAmount(budget.limitMinor, hideAmounts)}
      </Text>
      {budget.categories.slice(0, 3).map(category => (
        <View key={category.categoryId} style={styles.categoryBudgetRow}>
          <Text numberOfLines={1} style={styles.categoryBudgetName}>
            {category.name}
          </Text>
          <Text style={category.isOver ? styles.overText : styles.budgetMeta}>
            {Math.round(category.progress * 100)}%
          </Text>
        </View>
      ))}
    </View>
  );
}

export function MonthlyTrendChart({
  points,
  hideAmounts,
}: {
  points: readonly MonthlyTrendPoint[];
  hideAmounts: boolean;
}) {
  const max = Math.max(
    ...points.flatMap(point => [
      Math.abs(point.expenseMinor),
      Math.abs(point.incomeMinor),
    ]),
    0,
  );

  if (max === 0) {
    return <Text style={styles.emptyText}>最近六个月还没有收支数据。</Text>;
  }

  return (
    <View style={styles.monthlyChart}>
      {points.map(point => (
        <View
          accessible
          accessibilityLabel={`${point.label}收入${formatPrivateAmount(point.incomeMinor, hideAmounts)}，支出${formatPrivateAmount(point.expenseMinor, hideAmounts)}`}
          key={point.key}
          style={styles.monthColumn}
        >
          <View style={styles.monthBars}>
            <View
              style={[
                styles.monthBar,
                styles.incomeBar,
                barHeight(
                  point.incomeMinor === 0
                    ? 0
                    : Math.max(
                        3,
                        Math.round((Math.abs(point.incomeMinor) / max) * 78),
                      ),
                ),
              ]}
            />
            <View
              style={[
                styles.monthBar,
                styles.expenseBar,
                point.expenseMinor < 0 && styles.refundBar,
                barHeight(
                  point.expenseMinor === 0
                    ? 0
                    : Math.max(
                        3,
                        Math.round((Math.abs(point.expenseMinor) / max) * 78),
                      ),
                ),
              ]}
            />
          </View>
          <Text style={styles.monthLabel}>{point.label}</Text>
        </View>
      ))}
      <View style={styles.legendRow}>
        <Text style={styles.incomeLegend}>● 收入</Text>
        <Text style={styles.expenseLegend}>● 支出</Text>
      </View>
    </View>
  );
}

export function FinancialInsightList({
  insights,
  hideAmounts,
  onSelect,
}: {
  insights: readonly FinancialInsight[];
  hideAmounts: boolean;
  onSelect?: (insight: FinancialInsight) => void;
}) {
  if (insights.length === 0) {
    return <Text style={styles.emptyText}>暂时没有需要处理的本地洞察。</Text>;
  }
  return (
    <View style={styles.insightList}>
      {insights.map(insight => (
        <FinancialInsightCard
          hideAmounts={hideAmounts}
          insight={insight}
          key={insight.id}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

function FinancialInsightCard({
  insight,
  hideAmounts,
  onSelect,
}: {
  insight: FinancialInsight;
  hideAmounts: boolean;
  onSelect?: (insight: FinancialInsight) => void;
}) {
  const calculation =
    hideAmounts && insight.calculationContainsAmount
      ? '具体金额已隐藏'
      : insight.calculation;
  const amount =
    insight.amountMinor === undefined
      ? undefined
      : formatPrivateAmount(insight.amountMinor, hideAmounts);
  const evidence = `可追溯到 ${insight.transactionIds.length} 笔已确认账目`;

  return (
    <Pressable
      accessibilityLabel={[
        insight.title,
        amount,
        insight.detail,
        calculation,
        evidence,
      ]
        .filter((value): value is string => value !== undefined)
        .join('，')}
      accessibilityRole={onSelect === undefined ? undefined : 'button'}
      disabled={onSelect === undefined}
      onPress={() => onSelect?.(insight)}
      style={styles.insightCard}
    >
      <View style={styles.insightHeader}>
        <Text style={styles.insightTitle}>{insight.title}</Text>
        {amount === undefined ? null : (
          <Text style={styles.insightAmount}>{amount}</Text>
        )}
      </View>
      <Text style={styles.insightDetail}>{insight.detail}</Text>
      <Text style={styles.insightCalculation}>{calculation}</Text>
      <Text style={styles.insightEvidence}>{evidence}</Text>
    </Pressable>
  );
}

export function TextAction({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.textActionButton}
    >
      <Text style={styles.textAction}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionCard: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    ...shadows.card,
  },
  insightList: { gap: spacing.sm },
  insightCard: {
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  insightTitle: {
    minWidth: 0,
    flex: 1,
    color: colors.ink,
    fontSize: typography.bodyLarge,
    fontWeight: '900',
  },
  insightAmount: { color: colors.brand, fontSize: 14, fontWeight: '900' },
  insightDetail: { color: colors.inkSecondary, fontSize: 12, lineHeight: 18 },
  insightCalculation: {
    color: colors.inkMuted,
    fontSize: 11,
    lineHeight: 17,
  },
  insightEvidence: { color: colors.brand, fontSize: 11, fontWeight: '700' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: typography.title,
    fontWeight: '800',
  },
  summaryCard: {
    overflow: 'hidden',
    borderRadius: radius.xl,
    backgroundColor: colors.brand,
    padding: spacing.xl,
    ...shadows.card,
  },
  summaryGlowLarge: {
    position: 'absolute',
    top: -70,
    right: -48,
    width: 180,
    height: 180,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  summaryGlowSmall: {
    position: 'absolute',
    right: 58,
    bottom: -54,
    width: 112,
    height: 112,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  balanceLabel: {
    color: colors.onBrandMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  balanceValue: {
    marginTop: 4,
    color: colors.white,
    fontSize: typography.display,
    fontWeight: '900',
  },
  reimbursementText: {
    marginTop: 4,
    color: colors.onBrandSubtle,
    fontSize: 12,
  },
  metricRow: {
    flexDirection: 'row',
    marginTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.28)',
    paddingTop: 16,
  },
  metric: { minWidth: 0, flex: 1, gap: 4 },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    marginHorizontal: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  metricLabel: { color: colors.onBrandMuted, fontSize: 13 },
  metricValue: { color: colors.white, fontSize: 19, fontWeight: '800' },
  expenseText: { color: colors.expenseOnBrand },
  incomeText: { color: colors.incomeOnBrand },
  rankingList: { gap: spacing.md },
  rankingRow: {
    minHeight: control.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rankIdentity: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rankNumber: {
    width: 18,
    color: colors.inkMuted,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  rankIcon: { width: 24, fontSize: 18, textAlign: 'center' },
  rankMain: { minWidth: 0, flex: 1, gap: 6 },
  rankTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  rankName: { flex: 1, color: colors.inkSecondary, fontWeight: '700' },
  rankPercentage: { color: colors.inkMuted, fontSize: 12 },
  rankTrack: {
    height: 5,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: colors.brandMuted,
  },
  rankFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  rankAmount: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  emptyTitle: { color: colors.inkSecondary, fontWeight: '800' },
  emptyText: { color: colors.inkMuted, lineHeight: 21 },
  dailyChart: { minWidth: '100%', gap: 8, paddingTop: 4 },
  dayColumn: { width: 38, alignItems: 'center', gap: 6 },
  barArea: { height: 88, justifyContent: 'flex-end' },
  dayBar: { width: 15, borderRadius: 5, backgroundColor: colors.expense },
  refundBar: { backgroundColor: colors.income },
  dayLabel: { color: colors.inkMuted, fontSize: 10 },
  budgetEmpty: { gap: 6 },
  budgetContent: { gap: 10 },
  budgetTop: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  budgetCaption: { color: colors.inkMuted, fontSize: 12 },
  budgetValue: {
    marginTop: 3,
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  budgetPercent: { color: colors.brand, fontSize: 20, fontWeight: '900' },
  budgetTrack: {
    height: 9,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: colors.brandMuted,
  },
  budgetFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  overFill: { backgroundColor: colors.expense },
  overText: { color: colors.expenseText, fontWeight: '800' },
  budgetMeta: { color: colors.inkMuted, fontSize: 12 },
  categoryBudgetRow: { flexDirection: 'row', justifyContent: 'space-between' },
  categoryBudgetName: {
    flex: 1,
    color: colors.inkSecondary,
    fontSize: 12,
  },
  monthlyChart: {
    minHeight: 118,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  monthColumn: { flex: 1, alignItems: 'center', gap: 5 },
  monthBars: {
    height: 82,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  monthBar: { width: 7, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  incomeBar: { backgroundColor: colors.income },
  expenseBar: { backgroundColor: colors.expense },
  monthLabel: { color: colors.inkMuted, fontSize: 10 },
  legendRow: {
    position: 'absolute',
    top: -4,
    right: 0,
    flexDirection: 'row',
    gap: 10,
  },
  incomeLegend: { color: colors.incomeText, fontSize: 10 },
  expenseLegend: { color: colors.expenseText, fontSize: 10 },
  textActionButton: {
    minWidth: control.minTouchTarget,
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  textAction: { color: colors.brand, fontSize: 13, fontWeight: '800' },
});
