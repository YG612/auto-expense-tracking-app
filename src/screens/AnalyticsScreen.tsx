import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRepositories } from '../app/DatabaseProvider';
import { safeErrorMessage } from '../domain/errors/AppError';
import { changeMonth, type CategoryAmount } from '../domain/services/analytics';
import { formatAmountMinor } from '../domain/services/manualTransaction';
import {
  BudgetOverview,
  CategoryRanking,
  DailyExpenseChart,
  MonthlySummary,
  MonthlyTrendChart,
  SectionCard,
} from '../features/analytics/components/AnalyticsViews';
import {
  loadAnalyticsDashboard,
  type AnalyticsDashboard,
} from '../features/analytics/loadAnalytics';
import {
  colors,
  control,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme/tokens';

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
  }).format(date);
}

function ComparisonRow({
  label,
  current,
  previous,
  increaseIsPositive,
}: {
  label: string;
  current: number;
  previous: number;
  increaseIsPositive: boolean;
}) {
  const difference = current - previous;
  const isPositive = difference === 0 || difference > 0 === increaseIsPositive;

  return (
    <View style={styles.comparisonRow}>
      <View>
        <Text style={styles.comparisonLabel}>{label}</Text>
        <Text style={styles.comparisonCurrent}>
          {formatAmountMinor(current)}
        </Text>
      </View>
      <View style={styles.comparisonDifference}>
        <Text style={styles.comparisonCaption}>较上月</Text>
        <Text
          style={[
            styles.comparisonDelta,
            isPositive ? styles.goodDelta : styles.badDelta,
          ]}
        >
          {difference > 0 ? '+' : ''}
          {formatAmountMinor(difference)}
        </Text>
      </View>
    </View>
  );
}

export function AnalyticsScreen() {
  const repositories = useRepositories();
  const navigation = useNavigation();
  const [selectedMonth, setSelectedMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [dashboard, setDashboard] = useState<AnalyticsDashboard>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [reloadToken, setReloadToken] = useState(0);
  const latestReloadToken = useRef(reloadToken);
  latestReloadToken.current = reloadToken;

  useFocusEffect(
    useCallback(() => {
      const requestReloadToken = reloadToken;
      let active = true;
      const isLatestRequest = () =>
        active && requestReloadToken === latestReloadToken.current;
      setLoading(true);
      setError(undefined);

      loadAnalyticsDashboard(repositories, selectedMonth)
        .then(result => {
          if (isLatestRequest()) {
            setDashboard(result);
          }
        })
        .catch(loadError => {
          if (isLatestRequest()) {
            setError(
              safeErrorMessage(
                loadError,
                '读取分析数据失败。',
                'ANALYTICS-LOAD-UNEXPECTED',
              ),
            );
          }
        })
        .finally(() => {
          if (isLatestRequest()) {
            setLoading(false);
          }
        });

      return () => {
        active = false;
      };
    }, [reloadToken, repositories, selectedMonth]),
  );

  const selectMonth = (offset: number) => {
    setLoading(true);
    setDashboard(undefined);
    setSelectedMonth(current => changeMonth(current, offset));
  };

  const openCategory = (category: CategoryAmount) => {
    navigation.navigate('Main', {
      screen: 'Transactions',
      params: {
        monthStart: selectedMonth.toISOString(),
        categoryId: category.categoryId,
        requestKey: `${Date.now()}`,
      },
    });
  };

  if (dashboard === undefined && loading) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.centered}>
        <ActivityIndicator color={colors.brand} size="large" />
        <Text style={styles.muted}>正在计算月度统计…</Text>
      </SafeAreaView>
    );
  }

  if (dashboard === undefined) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.centered}>
        <Text accessibilityRole="alert" style={styles.errorTitle}>
          分析数据暂时无法读取
        </Text>
        <Text style={styles.muted}>{error ?? '未知错误'}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setReloadToken(value => value + 1)}
          style={styles.retryButton}
        >
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            onRefresh={() => setReloadToken(value => value + 1)}
            refreshing={loading}
            tintColor={colors.brand}
          />
        }
      >
        <View style={styles.monthPicker}>
          <Pressable
            accessibilityLabel="上个月"
            accessibilityRole="button"
            onPress={() => selectMonth(-1)}
            style={styles.monthButton}
          >
            <Text style={styles.monthButtonText}>‹</Text>
          </Pressable>
          <View style={styles.monthIdentity}>
            <Text style={styles.monthCaption}>月度分析</Text>
            <Text accessibilityRole="header" style={styles.monthTitle}>
              {monthLabel(selectedMonth)}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="下个月"
            accessibilityRole="button"
            onPress={() => selectMonth(1)}
            style={styles.monthButton}
          >
            <Text style={styles.monthButtonText}>›</Text>
          </Pressable>
        </View>

        {error === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setReloadToken(value => value + 1)}
            style={styles.errorBanner}
          >
            <Text style={styles.errorBannerText}>{error}，点此重试。</Text>
          </Pressable>
        )}

        <MonthlySummary report={dashboard.monthly} />

        <SectionCard title="与上月对比">
          <View style={styles.comparisonList}>
            <ComparisonRow
              current={dashboard.monthly.expenseMinor}
              increaseIsPositive={false}
              label="支出"
              previous={dashboard.previousMonth.expenseMinor}
            />
            <ComparisonRow
              current={dashboard.monthly.incomeMinor}
              increaseIsPositive
              label="收入"
              previous={dashboard.previousMonth.incomeMinor}
            />
            <ComparisonRow
              current={dashboard.monthly.balanceMinor}
              increaseIsPositive
              label="结余"
              previous={dashboard.previousMonth.balanceMinor}
            />
          </View>
        </SectionCard>

        <SectionCard title="近六个月收支趋势">
          <MonthlyTrendChart points={dashboard.monthlyTrend} />
        </SectionCard>

        <SectionCard title="每日净支出">
          <DailyExpenseChart days={dashboard.monthly.dailyExpenses} />
        </SectionCard>

        <SectionCard title="支出分类排行">
          <CategoryRanking
            categories={dashboard.monthly.expenseCategories}
            emptyText="本月还没有可统计的消费支出。"
            onSelect={openCategory}
          />
        </SectionCard>

        <SectionCard title="收入来源">
          <CategoryRanking
            categories={dashboard.monthly.incomeSources}
            emptyText="本月还没有普通收入。"
          />
        </SectionCard>

        <SectionCard title="预算完成度">
          <BudgetOverview budget={dashboard.monthly.budget} />
        </SectionCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.canvas,
    padding: spacing.xl,
  },
  monthPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    ...shadows.card,
  },
  monthButton: {
    width: control.minTouchTarget,
    height: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  monthButtonText: { color: colors.brand, fontSize: 30, lineHeight: 32 },
  monthIdentity: { alignItems: 'center' },
  monthCaption: { color: colors.inkMuted, fontSize: 11, fontWeight: '700' },
  monthTitle: { color: colors.ink, fontSize: 21, fontWeight: '900' },
  comparisonList: { gap: spacing.xs },
  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  comparisonLabel: { color: colors.inkMuted, fontSize: typography.caption },
  comparisonCurrent: {
    color: colors.ink,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
  },
  comparisonDifference: { alignItems: 'flex-end' },
  comparisonCaption: { color: colors.inkMuted, fontSize: 10 },
  comparisonDelta: { fontSize: 13, fontWeight: '800' },
  goodDelta: { color: colors.incomeText },
  badDelta: { color: colors.expenseText },
  errorBanner: {
    borderRadius: radius.sm,
    backgroundColor: colors.expenseSoft,
    padding: 10,
  },
  errorBannerText: {
    color: colors.expenseText,
    fontSize: typography.caption,
  },
  errorTitle: { color: colors.expenseText, fontSize: 20, fontWeight: '800' },
  muted: { color: colors.inkMuted, lineHeight: 21, textAlign: 'center' },
  retryButton: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  retryText: { color: colors.white, fontWeight: '800' },
});
