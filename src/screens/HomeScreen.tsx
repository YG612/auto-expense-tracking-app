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
import { usePrivacySettings } from '../app/PrivacyGate';
import { safeErrorMessage } from '../domain/errors/AppError';
import type { TransactionSummary } from '../database';
import { formatPrivateAmount } from '../domain/services/amountPrivacy';
import type { CategoryAmount } from '../domain/services/analytics';
import {
  BudgetOverview,
  CategoryRanking,
  DailyExpenseChart,
  MonthlySummary,
  SectionCard,
  TextAction,
} from '../features/analytics/components/AnalyticsViews';
import {
  loadHomeDashboard,
  type HomeDashboard,
} from '../features/analytics/loadAnalytics';
import {
  transactionAmountTone,
  transactionCategoryLabel,
  transactionTitle,
} from '../features/transactions/transactionPresentation';
import {
  colors,
  control,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme/tokens';

function monthTitle(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
  }).format(date);
}

function recentTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function RecentTransactionRow({
  transaction,
  onPress,
  hideAmounts,
}: {
  transaction: TransactionSummary;
  onPress: () => void;
  hideAmounts: boolean;
}) {
  const tone = transactionAmountTone(transaction.type);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.recentRow}
    >
      <View style={styles.recentIcon}>
        <Text style={styles.recentIconText}>
          {transactionCategoryLabel(transaction).slice(0, 1)}
        </Text>
      </View>
      <View style={styles.recentIdentity}>
        <Text numberOfLines={1} style={styles.recentTitle}>
          {transactionTitle(transaction)}
        </Text>
        <Text numberOfLines={1} style={styles.recentMeta}>
          {transactionCategoryLabel(transaction)} ·{' '}
          {recentTime(transaction.occurredAt)}
        </Text>
      </View>
      <Text
        style={[
          styles.recentAmount,
          tone === 'negative' && styles.negativeAmount,
          tone === 'positive' && styles.positiveAmount,
        ]}
      >
        {tone === 'negative' ? '−' : tone === 'positive' ? '+' : ''}
        {formatPrivateAmount(transaction.amountMinor, hideAmounts)}
      </Text>
    </Pressable>
  );
}

export function HomeScreen() {
  const repositories = useRepositories();
  const privacy = usePrivacySettings();
  const navigation = useNavigation();
  const [dashboard, setDashboard] = useState<HomeDashboard>();
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

      repositories.recurringTemplates
        .materializeDue(new Date().toISOString())
        .then(() => loadHomeDashboard(repositories, new Date()))
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
                '读取首页统计失败。',
                'HOME-LOAD-UNEXPECTED',
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
    }, [reloadToken, repositories]),
  );

  const openTransactions = (category?: CategoryAmount) => {
    const monthStart = dashboard?.monthly.range.start.toISOString();
    navigation.navigate('Main', {
      screen: 'Transactions',
      params: {
        monthStart,
        categoryId: category?.categoryId,
        requestKey: `${Date.now()}`,
      },
    });
  };

  const dismissBackupReminder = async () => {
    try {
      await privacy.updateSettings({ firstBackupReminderDismissed: true });
    } catch (dismissError) {
      setError(
        safeErrorMessage(
          dismissError,
          '暂时无法关闭备份提醒。',
          'HOME-BACKUP-REMINDER-UNEXPECTED',
        ),
      );
    }
  };

  if (dashboard === undefined && loading) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.centered}>
        <ActivityIndicator color={colors.brand} size="large" />
        <Text style={styles.muted}>正在汇总本地账本…</Text>
      </SafeAreaView>
    );
  }

  if (dashboard === undefined) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.centered}>
        <Text accessibilityRole="alert" style={styles.errorTitle}>
          首页统计暂时无法读取
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
        <View style={styles.pageHeader}>
          <View>
            <View style={styles.eyebrowRow}>
              <View style={styles.brandDot} />
              <Text style={styles.eyebrow}>轻记 AI · 本地账本</Text>
            </View>
            <Text accessibilityRole="header" style={styles.pageTitle}>
              {monthTitle(dashboard.monthly.range.start)}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Pending')}
            style={styles.pendingButton}
          >
            <Text style={styles.pendingCount}>{dashboard.pendingCount}</Text>
            <Text style={styles.pendingLabel}>待确认</Text>
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

        {dashboard.recentTransactions.length > 0 &&
        privacy.settings.lastBackupAt === undefined &&
        !privacy.settings.firstBackupReminderDismissed ? (
          <View style={styles.backupReminder}>
            <View style={styles.backupReminderCopy}>
              <Text style={styles.backupReminderTitle}>保护你的第一笔账</Text>
              <Text style={styles.backupReminderText}>
                本地账本不会自动同步。现在创建一份带口令的加密备份，设备意外时更安心。
              </Text>
            </View>
            <View style={styles.backupReminderActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.navigate('DataManagement')}
                style={styles.backupAction}
              >
                <Text style={styles.backupActionText}>立即备份</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={dismissBackupReminder}
                style={styles.backupDismiss}
              >
                <Text style={styles.backupDismissText}>暂不提醒</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <MonthlySummary
          hideAmounts={privacy.settings.hideAmounts}
          report={dashboard.monthly}
        />

        <View style={styles.quickActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('ManualEntry', undefined)}
            style={styles.primaryAction}
          >
            <Text style={styles.primaryActionText}>＋ 记一笔</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('Main', { screen: 'SmartEntry' })
            }
            style={styles.secondaryAction}
          >
            <Text style={styles.secondaryActionText}>智能记账入口</Text>
          </Pressable>
        </View>

        <SectionCard title="预算进度">
          <BudgetOverview
            budget={dashboard.monthly.budget}
            hideAmounts={privacy.settings.hideAmounts}
          />
        </SectionCard>

        <SectionCard title="最近 7 天支出">
          <DailyExpenseChart
            days={dashboard.lastSevenDays}
            hideAmounts={privacy.settings.hideAmounts}
          />
        </SectionCard>

        <SectionCard
          action={
            <TextAction
              label="查看分析"
              onPress={() =>
                navigation.navigate('Main', { screen: 'Analytics' })
              }
            />
          }
          title="本月分类排行"
        >
          <CategoryRanking
            categories={dashboard.monthly.expenseCategories}
            emptyText="本月还没有可统计的消费支出。"
            hideAmounts={privacy.settings.hideAmounts}
            limit={5}
            onSelect={openTransactions}
          />
        </SectionCard>

        <SectionCard
          action={
            <TextAction label="全部流水" onPress={() => openTransactions()} />
          }
          title="最近交易"
        >
          {dashboard.recentTransactions.length === 0 ? (
            <Text style={styles.muted}>还没有交易，先记下第一笔吧。</Text>
          ) : (
            <View style={styles.recentList}>
              {dashboard.recentTransactions.map(transaction => (
                <RecentTransactionRow
                  hideAmounts={privacy.settings.hideAmounts}
                  key={transaction.id}
                  onPress={() =>
                    navigation.navigate('ManualEntry', {
                      transactionId: transaction.id,
                    })
                  }
                  transaction={transaction}
                />
              ))}
            </View>
          )}
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
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xxs,
    paddingBottom: spacing.xxs,
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  eyebrow: {
    color: colors.inkSecondary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  pageTitle: {
    marginTop: 5,
    color: colors.ink,
    fontSize: typography.pageTitle,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  pendingButton: {
    minWidth: 68,
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.brandMuted,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...shadows.card,
  },
  pendingCount: { color: colors.brand, fontSize: 19, fontWeight: '900' },
  pendingLabel: { color: colors.inkMuted, fontSize: 11, fontWeight: '700' },
  quickActions: { flexDirection: 'row', gap: spacing.sm },
  primaryAction: {
    minHeight: 52,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    paddingVertical: spacing.sm,
    ...shadows.card,
  },
  primaryActionText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryAction: {
    minHeight: 52,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brandMuted,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    paddingVertical: spacing.sm,
  },
  secondaryActionText: {
    color: colors.brandPressed,
    fontSize: 14,
    fontWeight: '800',
  },
  errorBanner: {
    borderRadius: radius.sm,
    backgroundColor: colors.expenseSoft,
    padding: spacing.sm,
  },
  errorBannerText: {
    color: colors.expenseText,
    fontSize: typography.caption,
  },
  backupReminder: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.brandMuted,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
    padding: spacing.md,
  },
  backupReminderCopy: { gap: 4 },
  backupReminderTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  backupReminderText: {
    color: colors.inkSecondary,
    fontSize: 12,
    lineHeight: 19,
  },
  backupReminderActions: { flexDirection: 'row', gap: spacing.sm },
  backupAction: {
    minHeight: control.minTouchTarget,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  backupActionText: { color: colors.white, fontWeight: '900' },
  backupDismiss: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  backupDismissText: { color: colors.inkSecondary, fontWeight: '800' },
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
  recentList: { gap: 2 },
  recentRow: {
    minHeight: control.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  recentIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  recentIconText: { color: colors.brand, fontSize: 14, fontWeight: '900' },
  recentIdentity: { minWidth: 0, flex: 1, gap: 3 },
  recentTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  recentMeta: { color: colors.inkMuted, fontSize: 11 },
  recentAmount: {
    color: colors.inkSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  negativeAmount: { color: colors.expenseText },
  positiveAmount: { color: colors.incomeText },
});
