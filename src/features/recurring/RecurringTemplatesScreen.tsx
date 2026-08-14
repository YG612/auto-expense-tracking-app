import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRepositories } from '../../app/DatabaseProvider';
import type {
  Account,
  Category,
  RecurringCadence,
  RecurringConfirmationPolicy,
  RecurringTemplate,
} from '../../domain/entities';
import { safeErrorMessage } from '../../domain/errors/AppError';
import {
  formatAmountMinor,
  parseAmountToMinor,
} from '../../domain/services/manualTransaction';
import {
  SelectionModal,
  type SelectionOption,
} from '../manual-bookkeeping/components/SelectionModal';
import {
  colors,
  radius,
  shadows,
  spacing,
  typography,
} from '../../theme/tokens';
import { createId } from '../../utils/createId';

type ModalKind = 'CATEGORY' | 'ACCOUNT';

export function RecurringTemplatesScreen() {
  const repositories = useRepositories();
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [cadence, setCadence] = useState<RecurringCadence>('MONTHLY');
  const [policy, setPolicy] = useState<RecurringConfirmationPolicy>('DRAFT');
  const [categoryId, setCategoryId] = useState<string>();
  const [accountId, setAccountId] = useState<string>();
  const [modal, setModal] = useState<ModalKind>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedTemplates, loadedCategories, loadedAccounts] =
        await Promise.all([
          repositories.recurringTemplates.list(),
          repositories.categories.listVisible(type),
          repositories.accounts.listVisibleByUsage(),
        ]);
      setTemplates(loadedTemplates);
      setCategories(loadedCategories);
      setAccounts(loadedAccounts);
      setCategoryId(current =>
        loadedCategories.some(category => category.id === current)
          ? current
          : undefined,
      );
      setAccountId(current => current ?? loadedAccounts[0]?.id);
    } catch (loadError) {
      setError(
        safeErrorMessage(
          loadError,
          '读取周期记账设置失败。',
          'RECURRING-LOAD-UNEXPECTED',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [repositories, type]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const categoryOptions = useMemo<SelectionOption[]>(() => {
    const parentIds = new Set(
      categories.flatMap(category =>
        category.parentId === undefined ? [] : [category.parentId],
      ),
    );
    const byId = new Map(categories.map(category => [category.id, category]));
    return categories
      .filter(category => !parentIds.has(category.id))
      .map(category => ({
        id: category.id,
        label: category.name,
        detail: byId.get(category.parentId ?? '')?.name,
        icon: category.icon,
      }));
  }, [categories]);
  const accountOptions = accounts.map(account => ({
    id: account.id,
    label: account.name,
  }));
  const selectedCategory = categoryOptions.find(item => item.id === categoryId);
  const selectedAccount = accountOptions.find(item => item.id === accountId);

  const create = async () => {
    const amountMinor = parseAmountToMinor(amount);
    if (
      name.trim().length === 0 ||
      amountMinor === undefined ||
      categoryId === undefined ||
      accountId === undefined
    ) {
      setError('请填写名称、有效金额、分类和账户。');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const now = new Date().toISOString();
      await repositories.recurringTemplates.create({
        id: createId('recurring-template'),
        name,
        type,
        amountMinor,
        currency: 'CNY',
        categoryId,
        accountId,
        cadence,
        nextOccurrenceAt: now,
        confirmationPolicy: policy,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
      await repositories.recurringTemplates.materializeDue(now);
      setName('');
      setAmount('');
      setTemplates(await repositories.recurringTemplates.list());
    } catch (saveError) {
      setError(
        safeErrorMessage(
          saveError,
          '保存周期记账失败。',
          'RECURRING-SAVE-UNEXPECTED',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (template: RecurringTemplate, enabled: boolean) => {
    try {
      await repositories.recurringTemplates.setEnabled(
        template.id,
        enabled,
        new Date().toISOString(),
      );
      setTemplates(await repositories.recurringTemplates.list());
    } catch (toggleError) {
      setError(
        safeErrorMessage(
          toggleError,
          '无法更改周期状态。',
          'RECURRING-TOGGLE-UNEXPECTED',
        ),
      );
    }
  };

  const remove = (template: RecurringTemplate) => {
    Alert.alert('删除周期模板？', '已生成的交易不会被删除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除模板',
        style: 'destructive',
        onPress: async () => {
          await repositories.recurringTemplates.delete(template.id);
          setTemplates(await repositories.recurringTemplates.list());
        },
      },
    ]);
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={styles.title}>
            周期账默认先确认
          </Text>
          <Text style={styles.body}>
            到期时生成一笔候选；只有你明确选择“自动入账”后才会跳过待确认。首次保存会从今天生成。
          </Text>
        </View>
        <View style={styles.card}>
          <TextInput
            accessibilityLabel="周期名称"
            maxLength={120}
            onChangeText={setName}
            placeholder="例如：房租"
            placeholderTextColor={colors.placeholder}
            style={styles.input}
            value={name}
          />
          <TextInput
            accessibilityLabel="周期金额"
            keyboardType="decimal-pad"
            onChangeText={setAmount}
            placeholder="金额（元）"
            placeholderTextColor={colors.placeholder}
            style={styles.input}
            value={amount}
          />
          <View style={styles.options}>
            {(['EXPENSE', 'INCOME'] as const).map(value => (
              <Option
                key={value}
                label={value === 'EXPENSE' ? '支出' : '收入'}
                onPress={() => setType(value)}
                selected={type === value}
              />
            ))}
          </View>
          <View style={styles.options}>
            {(['WEEKLY', 'MONTHLY'] as const).map(value => (
              <Option
                key={value}
                label={value === 'WEEKLY' ? '每周' : '每月'}
                onPress={() => setCadence(value)}
                selected={cadence === value}
              />
            ))}
          </View>
          <Pressable onPress={() => setModal('CATEGORY')} style={styles.select}>
            <Text style={styles.selectLabel}>分类</Text>
            <Text style={styles.selectValue}>
              {selectedCategory?.label ?? '请选择'}
            </Text>
          </Pressable>
          <Pressable onPress={() => setModal('ACCOUNT')} style={styles.select}>
            <Text style={styles.selectLabel}>账户</Text>
            <Text style={styles.selectValue}>
              {selectedAccount?.label ?? '请选择'}
            </Text>
          </Pressable>
          <Text style={styles.optionCaption}>到期策略</Text>
          <View style={styles.options}>
            <Option
              label="生成待确认"
              onPress={() => setPolicy('DRAFT')}
              selected={policy === 'DRAFT'}
            />
            <Option
              label="自动入账"
              onPress={() => setPolicy('AUTO')}
              selected={policy === 'AUTO'}
            />
          </View>
          {policy === 'AUTO' ? (
            <Text style={styles.warning}>
              自动入账不会逐笔询问。建议只用于金额、分类和账户长期稳定的固定项目。
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={create}
            style={[styles.button, saving && styles.disabled]}
          >
            <Text style={styles.buttonText}>保存并生成首次记录</Text>
          </Pressable>
        </View>

        {error === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <Text style={styles.sectionLabel}>已有模板</Text>
        {loading ? (
          <ActivityIndicator color={colors.brand} />
        ) : templates.length === 0 ? (
          <Text style={styles.empty}>还没有周期模板。</Text>
        ) : (
          templates.map(template => (
            <View key={template.id} style={styles.templateRow}>
              <View style={styles.templateCopy}>
                <Text style={styles.templateTitle}>{template.name}</Text>
                <Text style={styles.body}>
                  {formatAmountMinor(template.amountMinor)} ·{' '}
                  {template.cadence === 'WEEKLY' ? '每周' : '每月'} ·{' '}
                  {template.confirmationPolicy === 'DRAFT'
                    ? '待确认'
                    : '自动入账'}
                </Text>
                <Pressable onPress={() => remove(template)}>
                  <Text style={styles.deleteText}>删除模板</Text>
                </Pressable>
              </View>
              <Switch
                accessibilityLabel={`${template.name}启用状态`}
                onValueChange={enabled => toggle(template, enabled)}
                value={template.enabled}
              />
            </View>
          ))
        )}
      </ScrollView>
      <SelectionModal
        onChange={ids => {
          if (modal === 'CATEGORY') setCategoryId(ids[0]);
          else setAccountId(ids[0]);
          setModal(undefined);
        }}
        onClose={() => setModal(undefined)}
        options={modal === 'CATEGORY' ? categoryOptions : accountOptions}
        selectedIds={
          modal === 'CATEGORY'
            ? categoryId === undefined
              ? []
              : [categoryId]
            : accountId === undefined
              ? []
              : [accountId]
        }
        title={modal === 'CATEGORY' ? '选择分类' : '选择账户'}
        visible={modal !== undefined}
      />
    </SafeAreaView>
  );
}

function Option({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.option, selected && styles.optionSelected]}
    >
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  intro: { gap: spacing.xs },
  title: {
    color: colors.ink,
    fontSize: typography.pageTitle,
    fontWeight: '900',
  },
  body: { color: colors.inkSecondary, fontSize: 12, lineHeight: 19 },
  card: {
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    ...shadows.card,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    color: colors.ink,
    paddingHorizontal: spacing.md,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  option: {
    minHeight: 42,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  optionSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  optionText: { color: colors.inkSecondary, fontWeight: '700' },
  optionTextSelected: { color: colors.brand, fontWeight: '900' },
  optionCaption: { color: colors.inkMuted, fontSize: 12, fontWeight: '800' },
  select: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  selectLabel: { color: colors.inkSecondary },
  selectValue: { color: colors.brand, fontWeight: '800' },
  warning: {
    borderRadius: radius.sm,
    backgroundColor: colors.warningSoft,
    color: colors.warningText,
    fontSize: 12,
    lineHeight: 18,
    padding: spacing.sm,
  },
  button: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  buttonText: { color: colors.white, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  error: { color: colors.expenseText, lineHeight: 20 },
  sectionLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: '900' },
  empty: { color: colors.inkMuted, textAlign: 'center', padding: spacing.lg },
  templateRow: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  templateCopy: { minWidth: 0, flex: 1, gap: 3 },
  templateTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  deleteText: { color: colors.expenseText, fontSize: 12, fontWeight: '800' },
});
