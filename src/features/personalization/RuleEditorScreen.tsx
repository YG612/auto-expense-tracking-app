import type { StaticScreenProps } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { safeErrorMessage } from '../../domain/errors/AppError';
import { normalizeChineseTransactionText } from '../../classification/normalizers/normalizeText';
import type {
  Account,
  Category,
  RuleType,
  UserRule,
} from '../../domain/entities';
import { createId } from '../../utils/createId';
import {
  SelectionModal,
  type SelectionOption,
} from '../manual-bookkeeping/components/SelectionModal';

type EditableRuleType = Extract<RuleType, 'MERCHANT' | 'KEYWORD'>;

type Props = StaticScreenProps<
  | {
      ruleId?: string;
      ruleType?: EditableRuleType;
    }
  | undefined
>;

type ModalName = 'category' | 'account';

const KEYWORD_STOP_WORDS = new Set([
  '支付',
  '付款',
  '消费',
  '花了',
  '买了',
  '今天',
  '昨天',
  '金额',
  '一笔',
  '元',
  '块',
]);

function normalizePattern(value: string): string {
  return normalizeChineseTransactionText(value)
    .trim()
    .toLocaleLowerCase('zh-CN');
}

export function validateRulePattern(
  value: string,
  ruleType: EditableRuleType,
): string | undefined {
  const pattern = normalizePattern(value);
  if (pattern.length === 0) {
    return ruleType === 'MERCHANT' ? '请输入商户名称。' : '请输入关键词。';
  }
  if (pattern.length < 2) {
    return '规则内容至少需要 2 个字符，避免误匹配。';
  }
  if (ruleType === 'KEYWORD' && KEYWORD_STOP_WORDS.has(pattern)) {
    return '这个词过于通用，请使用更具体的消费关键词。';
  }
  return undefined;
}

function categoryOptions(categories: readonly Category[]): SelectionOption[] {
  const byId = new Map(categories.map(category => [category.id, category]));
  const parentIds = new Set(
    categories.flatMap(category =>
      category.parentId === undefined ? [] : [category.parentId],
    ),
  );

  return categories
    .filter(
      category =>
        category.parentId !== undefined || !parentIds.has(category.id),
    )
    .map(category => ({
      id: category.id,
      label: category.name,
      detail:
        category.parentId === undefined
          ? category.type === 'EXPENSE'
            ? '支出'
            : '收入'
          : `${category.type === 'EXPENSE' ? '支出' : '收入'} · ${
              byId.get(category.parentId)?.name ?? '其他'
            }`,
      icon:
        category.icon ??
        (category.parentId === undefined
          ? undefined
          : byId.get(category.parentId)?.icon),
    }));
}

function selectionLabel(
  options: readonly SelectionOption[],
  id: string | undefined,
  fallback: string,
): string {
  const option = options.find(item => item.id === id);
  return option === undefined
    ? fallback
    : option.detail === undefined
      ? option.label
      : `${option.detail} / ${option.label}`;
}

export function RuleEditorScreen({ route }: Props) {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const ruleId = route.params?.ruleId;
  const [existing, setExisting] = useState<UserRule>();
  const [ruleType, setRuleType] = useState<EditableRuleType>(
    route.params?.ruleType ?? 'MERCHANT',
  );
  const [pattern, setPattern] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>();
  const [accountId, setAccountId] = useState<string>();
  const [priorityText, setPriorityText] = useState('800');
  const [enabled, setEnabled] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeModal, setActiveModal] = useState<ModalName>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    Promise.all([
      repositories.categories.listVisibleByUsage('EXPENSE'),
      repositories.categories.listVisibleByUsage('INCOME'),
      repositories.accounts.listVisibleByUsage(),
      ruleId === undefined
        ? Promise.resolve(undefined)
        : repositories.userRules.findById(ruleId),
    ])
      .then(([expense, income, accountRows, rule]) => {
        if (!active) {
          return;
        }
        setCategories([...expense, ...income]);
        setAccounts(accountRows);
        if (ruleId !== undefined && rule === undefined) {
          setError('未找到这条规则，可能已被删除。');
          return;
        }
        if (rule !== undefined) {
          if (rule.ruleType !== 'MERCHANT' && rule.ruleType !== 'KEYWORD') {
            setError('当前版本只支持编辑商户规则和关键词规则。');
            return;
          }
          setExisting(rule);
          setRuleType(rule.ruleType);
          setPattern(rule.pattern);
          setSelectedCategoryId(rule.subcategoryId ?? rule.categoryId);
          setAccountId(rule.accountId);
          setPriorityText(String(rule.priority));
          setEnabled(rule.enabled);
        }
      })
      .catch(loadError => {
        if (active) {
          setError(
            safeErrorMessage(
              loadError,
              '读取规则失败。',
              'RULE-LOAD-UNEXPECTED',
            ),
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [repositories, ruleId]);

  const availableCategoryOptions = useMemo(
    () => categoryOptions(categories),
    [categories],
  );
  const accountOptions = useMemo(
    () =>
      accounts.map(account => ({
        id: account.id,
        label: account.name,
        icon: account.icon,
      })),
    [accounts],
  );

  const save = async () => {
    const patternError = validateRulePattern(pattern, ruleType);
    if (patternError !== undefined) {
      setError(patternError);
      return;
    }
    if (selectedCategoryId === undefined && accountId === undefined) {
      setError('请至少设置一个分类或账户结果。');
      return;
    }
    const priority = Number(priorityText);
    if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
      setError('优先级必须是 0 到 1000 之间的整数。');
      return;
    }

    const normalizedPattern = normalizePattern(pattern);
    setSaving(true);
    setError(undefined);
    try {
      const duplicates = (await repositories.userRules.list()).filter(
        rule =>
          rule.id !== existing?.id &&
          rule.ruleType === ruleType &&
          normalizePattern(rule.pattern) === normalizedPattern,
      );
      if (duplicates.length > 0) {
        throw new Error('已有相同类型和内容的规则，请直接编辑原规则。');
      }

      const selectedCategory = categories.find(
        category => category.id === selectedCategoryId,
      );
      const parentCategory =
        selectedCategory?.parentId === undefined
          ? selectedCategory
          : categories.find(
              category => category.id === selectedCategory.parentId,
            );
      const now = new Date().toISOString();
      const rule: UserRule = {
        id: existing?.id ?? createId('rule'),
        ruleType,
        origin: 'USER_CREATED',
        pattern: pattern.trim(),
        transactionType: parentCategory?.type,
        categoryId: parentCategory?.id,
        subcategoryId:
          selectedCategory?.parentId === undefined
            ? undefined
            : selectedCategory?.id,
        accountId,
        priority,
        enabled,
        usageCount: existing?.usageCount ?? 0,
        lastUsedAt: existing?.lastUsedAt,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      if (existing === undefined) {
        await repositories.userRules.create(rule);
      } else {
        const updated = await repositories.userRules.update(rule);
        if (!updated) {
          throw new Error('规则不存在，可能已被删除。');
        }
      }

      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.navigate('RuleManagement');
      }
    } catch (saveError) {
      setError(
        safeErrorMessage(saveError, '保存规则失败。', 'RULE-SAVE-UNEXPECTED'),
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['bottom']} style={styles.centered}>
        <ActivityIndicator color="#2563EB" size="large" />
        <Text style={styles.muted}>正在读取规则…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {existing?.origin === 'LEARNED_MERCHANT' ? (
          <Text style={styles.learnedNotice}>
            这条规则由连续三次纠正形成。保存任何修改后，它将转为你主动维护的规则。
          </Text>
        ) : null}

        <View style={styles.field}>
          <Text style={styles.label}>规则类型</Text>
          <View style={styles.typeRow}>
            {(['MERCHANT', 'KEYWORD'] as const).map(value => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: ruleType === value }}
                key={value}
                onPress={() => setRuleType(value)}
                style={[
                  styles.typeButton,
                  ruleType === value && styles.selectedTypeButton,
                ]}
              >
                <Text
                  style={[
                    styles.typeText,
                    ruleType === value && styles.selectedTypeText,
                  ]}
                >
                  {value === 'MERCHANT' ? '商户' : '关键词'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>
            {ruleType === 'MERCHANT' ? '商户名称' : '关键词'}
            <Text style={styles.required}> *</Text>
          </Text>
          <TextInput
            accessibilityLabel={ruleType === 'MERCHANT' ? '商户名称' : '关键词'}
            autoCapitalize="none"
            maxLength={80}
            onChangeText={setPattern}
            placeholder={
              ruleType === 'MERCHANT' ? '例如：一鸣' : '例如：宠物粮'
            }
            placeholderTextColor="#94A3B8"
            style={styles.input}
            value={pattern}
          />
          <Text style={styles.hint}>
            {ruleType === 'MERCHANT'
              ? '商户规则按规范化后的完整名称匹配，不会误匹配名称更长的其他商户。'
              : '关键词按普通文本匹配，不执行正则表达式；请避免“支付、元”等通用词。'}
          </Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>建议分类</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveModal('category')}
            style={styles.selector}
          >
            <Text style={styles.selectorText}>
              {selectionLabel(
                availableCategoryOptions,
                selectedCategoryId,
                '不修改分类',
              )}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>建议账户（可选）</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveModal('account')}
            style={styles.selector}
          >
            <Text style={styles.selectorText}>
              {selectionLabel(accountOptions, accountId, '不修改账户')}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>优先级（0–1000）</Text>
          <TextInput
            accessibilityLabel="规则优先级"
            keyboardType="number-pad"
            maxLength={4}
            onChangeText={setPriorityText}
            style={styles.input}
            value={priorityText}
          />
          <Text style={styles.hint}>
            数值只用于同一来源层级内的冲突排序；明确输入和用户创建规则的来源层级不会被数值越级覆盖。
          </Text>
        </View>

        <View style={styles.enabledRow}>
          <View style={styles.enabledCopy}>
            <Text style={styles.label}>启用规则</Text>
            <Text style={styles.hint}>关闭后保留规则，但不会参与建议。</Text>
          </View>
          <Switch
            accessibilityLabel="启用规则"
            onValueChange={setEnabled}
            trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
            thumbColor={enabled ? '#2563EB' : '#F8FAFC'}
            value={enabled}
          />
        </View>

        {error === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={save}
          style={[styles.saveButton, saving && styles.disabled]}
        >
          {saving ? <ActivityIndicator color="#FFFFFF" /> : null}
          <Text style={styles.saveText}>
            {existing === undefined ? '创建规则' : '保存规则'}
          </Text>
        </Pressable>
      </ScrollView>

      <SelectionModal
        allowClear
        onChange={ids => setSelectedCategoryId(ids[0])}
        onClose={() => setActiveModal(undefined)}
        options={availableCategoryOptions}
        selectedIds={
          selectedCategoryId === undefined ? [] : [selectedCategoryId]
        }
        title="建议分类"
        visible={activeModal === 'category'}
      />
      <SelectionModal
        allowClear
        onChange={ids => setAccountId(ids[0])}
        onClose={() => setActiveModal(undefined)}
        options={accountOptions}
        selectedIds={accountId === undefined ? [] : [accountId]}
        title="建议账户"
        visible={activeModal === 'account'}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#F8FAFC',
  },
  content: { gap: 19, padding: 16, paddingBottom: 36 },
  learnedNotice: {
    borderRadius: 12,
    backgroundColor: '#F3E8FF',
    color: '#6B21A8',
    fontSize: 13,
    lineHeight: 20,
    padding: 13,
  },
  field: { gap: 8 },
  label: { color: '#334155', fontSize: 14, fontWeight: '800' },
  required: { color: '#DC2626' },
  typeRow: { flexDirection: 'row', gap: 9 },
  typeButton: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
  },
  selectedTypeButton: { borderColor: '#2563EB', backgroundColor: '#2563EB' },
  typeText: { color: '#475569', fontWeight: '800' },
  selectedTypeText: { color: '#FFFFFF' },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
    fontSize: 15,
    paddingHorizontal: 14,
  },
  hint: { color: '#64748B', fontSize: 12, lineHeight: 18 },
  selector: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
  },
  selectorText: { minWidth: 0, flex: 1, color: '#0F172A', fontSize: 15 },
  chevron: { color: '#94A3B8', fontSize: 28 },
  enabledRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    padding: 15,
  },
  enabledCopy: { minWidth: 0, flex: 1, gap: 4 },
  error: {
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    color: '#991B1B',
    lineHeight: 20,
    padding: 12,
  },
  saveButton: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: 15,
    backgroundColor: '#2563EB',
    padding: 14,
  },
  disabled: { opacity: 0.6 },
  saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  muted: { color: '#64748B' },
});
