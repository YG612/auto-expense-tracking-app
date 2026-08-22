import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons/static';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRepositories } from '../../app/DatabaseProvider';
import type { Budget, Category } from '../../domain/entities';
import { safeErrorMessage } from '../../domain/errors/AppError';
import { parseAmountToMinor } from '../../domain/services/manualTransaction';
import {
  colors,
  radius,
  shadows,
  spacing,
  typography,
} from '../../theme/tokens';
import { createId } from '../../utils/createId';

type MonthScope = { year: number; month: number };

function shiftedMonth(scope: MonthScope, offset: number): MonthScope {
  const value = new Date(scope.year, scope.month - 1 + offset, 1);
  return { year: value.getFullYear(), month: value.getMonth() + 1 };
}

function amountText(limitMinor: number | undefined): string {
  if (limitMinor === undefined) return '';
  return `${Math.floor(limitMinor / 100)}.${String(limitMinor % 100).padStart(2, '0')}`;
}

export function buildMonthlyBudgets(input: {
  scope: MonthScope;
  fields: Readonly<Record<string, string>>;
  categoryIds: readonly string[];
  now: string;
}): Budget[] {
  const budgets: Budget[] = [];
  const keys = ['TOTAL', ...new Set(input.categoryIds)];
  for (const key of keys) {
    const text = input.fields[key] ?? '';
    const normalized = text.trim();
    if (normalized.length === 0) continue;
    const limitMinor = parseAmountToMinor(normalized);
    if (limitMinor === undefined) {
      throw new Error('预算金额须大于 0，且最多保留两位小数。');
    }
    budgets.push({
      id: createId('budget'),
      periodType: 'MONTHLY',
      year: input.scope.year,
      month: input.scope.month,
      categoryId: key === 'TOTAL' ? undefined : key,
      limitMinor,
      currency: 'CNY',
      createdAt: input.now,
      updatedAt: input.now,
    });
  }
  return budgets;
}

export function BudgetSettingsScreen() {
  const repositories = useRepositories();
  const initial = useMemo(
    () => ({
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
    }),
    [],
  );
  const [scope, setScope] = useState<MonthScope>(initial);
  const [categories, setCategories] = useState<Category[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({ TOTAL: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [loadedCategories, budgets] = await Promise.all([
        repositories.categories.listVisible('EXPENSE'),
        repositories.budgets.listForMonth(scope.year, scope.month),
      ]);
      const nextFields: Record<string, string> = { TOTAL: '' };
      for (const budget of budgets.filter(item => item.currency === 'CNY')) {
        nextFields[budget.categoryId ?? 'TOTAL'] = amountText(
          budget.limitMinor,
        );
      }
      setCategories(
        loadedCategories.filter(category => category.parentId === undefined),
      );
      setFields(nextFields);
    } catch (loadError) {
      setError(
        safeErrorMessage(
          loadError,
          '读取预算设置失败。',
          'BUDGET-SETTINGS-LOAD-UNEXPECTED',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [repositories, scope.month, scope.year]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const budgets = buildMonthlyBudgets({
        scope,
        fields,
        categoryIds: categories.map(category => category.id),
        now: new Date().toISOString(),
      });
      await repositories.budgets.replaceForMonth(
        scope.year,
        scope.month,
        'CNY',
        budgets,
      );
      setNotice('预算已保存在本机，首页、分析和本地洞察会立即使用。');
      await load();
    } catch (saveError) {
      setError(
        safeErrorMessage(
          saveError,
          '保存预算失败，请检查金额。',
          'BUDGET-SETTINGS-SAVE-UNEXPECTED',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const input = (key: string, label: string) => (
    <View key={key} style={styles.budgetRow}>
      <Text numberOfLines={2} style={styles.budgetLabel}>
        {label}
      </Text>
      <View style={styles.amountField}>
        <Text style={styles.currency}>¥</Text>
        <TextInput
          accessibilityLabel={`${label}预算`}
          editable={!saving}
          keyboardType="decimal-pad"
          maxLength={14}
          onChangeText={value =>
            setFields(current => ({ ...current, [key]: value }))
          }
          placeholder="未设置"
          placeholderTextColor={colors.inkMuted}
          style={styles.amountInput}
          value={fields[key] ?? ''}
        />
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <MaterialDesignIcons color={colors.brand} name="target" size={32} />
          <View style={styles.heroCopy}>
            <Text accessibilityRole="header" style={styles.title}>
              给每个月留出边界
            </Text>
            <Text style={styles.description}>
              总预算用于整体进度；分类预算帮助定位偏离。留空即不设置，不会自动延续或预测消费。
            </Text>
          </View>
        </View>

        <View style={styles.monthPicker}>
          <Pressable
            accessibilityLabel="上个月"
            accessibilityRole="button"
            onPress={() => setScope(current => shiftedMonth(current, -1))}
            style={styles.monthButton}
          >
            <MaterialDesignIcons
              color={colors.brand}
              name="chevron-left"
              size={28}
            />
          </Pressable>
          <Text style={styles.monthText}>
            {scope.year} 年 {scope.month} 月
          </Text>
          <Pressable
            accessibilityLabel="下个月"
            accessibilityRole="button"
            onPress={() => setScope(current => shiftedMonth(current, 1))}
            style={styles.monthButton}
          >
            <MaterialDesignIcons
              color={colors.brand}
              name="chevron-right"
              size={28}
            />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.brand} style={styles.loading} />
        ) : (
          <>
            <Text style={styles.sectionLabel}>月度总预算</Text>
            <View style={styles.card}>{input('TOTAL', '全部支出')}</View>
            <Text style={styles.sectionLabel}>分类预算（可选）</Text>
            <View style={styles.card}>
              {categories.map(category => input(category.id, category.name))}
            </View>
          </>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={loading || saving}
          onPress={save}
          style={[styles.saveButton, (loading || saving) && styles.disabled]}
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveText}>保存本月预算</Text>
          )}
        </Pressable>
        {notice === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.notice}>
            {notice}
          </Text>
        )}
        {error === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: {
    gap: spacing.sm,
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  hero: {
    flexDirection: 'row',
    gap: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    ...shadows.card,
  },
  heroCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  title: { color: colors.ink, fontSize: typography.title, fontWeight: '900' },
  description: { color: colors.inkSecondary, fontSize: 13, lineHeight: 20 },
  monthPicker: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  monthText: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  loading: { minHeight: 160 },
  sectionLabel: {
    marginTop: spacing.sm,
    color: colors.inkMuted,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  card: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  budgetRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  budgetLabel: { minWidth: 0, flex: 1, color: colors.ink, fontWeight: '700' },
  amountField: {
    width: 142,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.sm,
  },
  currency: { color: colors.inkMuted, fontWeight: '800' },
  amountInput: {
    minHeight: 46,
    flex: 1,
    color: colors.ink,
    textAlign: 'right',
  },
  saveButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  saveText: { color: colors.white, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  notice: {
    borderRadius: radius.md,
    backgroundColor: colors.incomeSoft,
    color: colors.incomeText,
    lineHeight: 20,
    padding: spacing.md,
  },
  error: {
    borderRadius: radius.md,
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    lineHeight: 20,
    padding: spacing.md,
  },
});
