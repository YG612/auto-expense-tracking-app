import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRepositories } from '../../app/DatabaseProvider';
import { safeErrorMessage } from '../../domain/errors/AppError';
import type {
  Account,
  Category,
  RuleType,
  UserRule,
} from '../../domain/entities';
import { saveLedgerTextFile } from '../../native/LedgerFilePortal';

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  MERCHANT: '商户',
  KEYWORD: '关键词',
  TEXT_PATTERN: '文本模式',
  ACCOUNT: '账户',
  TIME_PATTERN: '时间模式',
};

function formatLastUsed(value: string | undefined): string {
  if (value === undefined) {
    return '尚未使用';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);
}

function targetLabel(
  rule: UserRule,
  categories: ReadonlyMap<string, Category>,
  accounts: ReadonlyMap<string, Account>,
): string {
  const parts: string[] = [];
  const category =
    rule.subcategoryId === undefined
      ? undefined
      : categories.get(rule.subcategoryId);
  const parent =
    rule.categoryId === undefined ? undefined : categories.get(rule.categoryId);

  if (category !== undefined) {
    parts.push(
      parent === undefined
        ? category.name
        : `${parent.name} / ${category.name}`,
    );
  } else if (parent !== undefined) {
    parts.push(parent.name);
  }
  if (rule.accountId !== undefined) {
    parts.push(accounts.get(rule.accountId)?.name ?? '未知账户');
  }
  if (parts.length === 0 && rule.transactionType !== undefined) {
    parts.push(rule.transactionType);
  }
  return parts.length === 0 ? '未设置结果' : parts.join(' · ');
}

export function RuleManagementScreen() {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const [rules, setRules] = useState<UserRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [managingLearning, setManagingLearning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [ruleRows, expense, income, accountRows] = await Promise.all([
        repositories.userRules.list(),
        repositories.categories.listVisibleByUsage('EXPENSE'),
        repositories.categories.listVisibleByUsage('INCOME'),
        repositories.accounts.listVisibleByUsage(),
      ]);
      setRules(ruleRows);
      setCategories([...expense, ...income]);
      setAccounts(accountRows);
    } catch (loadError) {
      setError(
        safeErrorMessage(
          loadError,
          '读取分类规则失败。',
          'RULE-LIST-UNEXPECTED',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [repositories]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const categoryById = useMemo(
    () => new Map(categories.map(category => [category.id, category])),
    [categories],
  );
  const accountById = useMemo(
    () => new Map(accounts.map(account => [account.id, account])),
    [accounts],
  );

  const toggleRule = async (rule: UserRule, enabled: boolean) => {
    setError(undefined);
    setRules(current =>
      current.map(item => (item.id === rule.id ? { ...item, enabled } : item)),
    );
    try {
      const updated = await repositories.userRules.setEnabled(
        rule.id,
        enabled,
        new Date().toISOString(),
      );
      if (!updated) {
        throw new Error('规则不存在，可能已被删除。');
      }
      await load();
    } catch (toggleError) {
      setError(
        safeErrorMessage(
          toggleError,
          '更新规则失败。',
          'RULE-TOGGLE-UNEXPECTED',
        ),
      );
      await load();
    }
  };

  const confirmDelete = (rule: UserRule) => {
    Alert.alert(
      rule.origin === 'LEARNED_MERCHANT' ? '撤销这次学习？' : '删除规则',
      rule.origin === 'LEARNED_MERCHANT'
        ? `将删除“${rule.pattern}”学习规则，并阻止相同商户自动重新学习；历史账目不变。`
        : `确定删除“${rule.pattern}”吗？删除后将立即停止匹配。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            repositories.userRules
              .remove(rule.id, new Date().toISOString())
              .then(load)
              .catch(deleteError => {
                setError(
                  safeErrorMessage(
                    deleteError,
                    '删除规则失败。',
                    'RULE-DELETE-UNEXPECTED',
                  ),
                );
              });
          },
        },
      ],
    );
  };

  const exportLearningData = async () => {
    setManagingLearning(true);
    setError(undefined);
    try {
      const [learnedRules, feedback, suppressions] = await Promise.all([
        repositories.userRules.list({ origins: ['LEARNED_MERCHANT'] }),
        repositories.classificationFeedback.list(),
        repositories.userRules.listLearnedSuppressions(),
      ]);
      const result = await saveLedgerTextFile({
        suggestedFileName: `轻记AI-学习数据-${new Date().toISOString().slice(0, 10)}.json`,
        mimeType: 'application/json',
        content: JSON.stringify(
          {
            format: 'qingji-ai-learning-data',
            version: 1,
            exportedAt: new Date().toISOString(),
            learnedRules,
            feedback,
            suppressions,
          },
          null,
          2,
        ),
      });
      if (result.status === 'SAVED')
        setNotice('学习数据已通过系统文件面板导出。');
    } catch (exportError) {
      setError(
        safeErrorMessage(
          exportError,
          '导出学习数据失败。',
          'LEARNING-EXPORT-UNEXPECTED',
        ),
      );
    } finally {
      setManagingLearning(false);
    }
  };

  const deleteLearningData = () => {
    Alert.alert(
      '彻底删除全部学习数据？',
      '将删除纠正历史、自动学习规则和抑制记录；手动创建的规则与账目不会删除。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '彻底删除',
          style: 'destructive',
          onPress: async () => {
            setManagingLearning(true);
            try {
              const result =
                await repositories.userRules.deleteAllLearningData();
              await load();
              setNotice(
                `已删除 ${result.learnedRuleCount} 条学习规则和 ${result.feedbackCount} 条纠正记录。`,
              );
            } catch (deleteError) {
              setError(
                safeErrorMessage(
                  deleteError,
                  '删除学习数据失败，操作已回滚。',
                  'LEARNING-DELETE-UNEXPECTED',
                ),
              );
            } finally {
              setManagingLearning(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.explanation}>
          <Text style={styles.explanationTitle}>规则优先级</Text>
          <Text style={styles.explanationText}>
            本次输入中明确写出的类型、分类和账户始终优先；用户创建规则高于学习规则，学习规则高于商户词典与通用关键词。
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('RuleEditor', { ruleType: 'MERCHANT' })
            }
            style={styles.primaryAction}
          >
            <Text style={styles.primaryActionText}>＋ 商户规则</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('RuleEditor', { ruleType: 'KEYWORD' })
            }
            style={styles.secondaryAction}
          >
            <Text style={styles.secondaryActionText}>＋ 关键词规则</Text>
          </Pressable>
        </View>

        <View style={styles.learningActions}>
          <Text style={styles.explanationTitle}>学习数据由你控制</Text>
          <Text style={styles.explanationText}>
            命中次数和最近使用时间保存在本机；可在设置中停用学习，也可在这里导出或彻底删除。
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={managingLearning}
              onPress={() => exportLearningData().catch(() => undefined)}
              style={styles.secondaryAction}
            >
              <Text style={styles.secondaryActionText}>导出学习数据</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={managingLearning}
              onPress={deleteLearningData}
              style={styles.learningDeleteButton}
            >
              <Text style={styles.deleteText}>彻底删除学习数据</Text>
            </Pressable>
          </View>
        </View>

        {notice === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.notice}>
            {notice}
          </Text>
        )}

        {error === undefined ? null : (
          <Pressable accessibilityRole="button" onPress={load}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error} 点击重试。
            </Text>
          </Pressable>
        )}

        {loading && rules.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#2563EB" size="large" />
            <Text style={styles.muted}>正在读取本地规则…</Text>
          </View>
        ) : rules.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>还没有分类规则</Text>
            <Text style={styles.muted}>
              你可以手动创建；同一商户连续三次被纠正为相同分类后，也会自动形成一条学习规则。
            </Text>
          </View>
        ) : (
          <View style={styles.ruleList}>
            {rules.map(rule => (
              <View key={rule.id} style={styles.ruleCard}>
                <View style={styles.ruleHeader}>
                  <View style={styles.badges}>
                    <Text style={styles.typeBadge}>
                      {RULE_TYPE_LABELS[rule.ruleType]}
                    </Text>
                    <Text
                      style={
                        rule.origin === 'LEARNED_MERCHANT'
                          ? styles.learnedBadge
                          : styles.createdBadge
                      }
                    >
                      {rule.origin === 'LEARNED_MERCHANT'
                        ? '三次纠正学习'
                        : '用户创建'}
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel={`启用规则 ${rule.pattern}`}
                    onValueChange={enabled => toggleRule(rule, enabled)}
                    trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
                    thumbColor={rule.enabled ? '#2563EB' : '#F8FAFC'}
                    value={rule.enabled}
                  />
                </View>

                <Text style={styles.pattern}>{rule.pattern}</Text>
                <Text style={styles.target}>
                  建议：{targetLabel(rule, categoryById, accountById)}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={styles.meta}>优先级 {rule.priority}</Text>
                  <Text style={styles.meta}>已采用 {rule.usageCount} 次</Text>
                  <Text style={styles.meta}>
                    {formatLastUsed(rule.lastUsedAt)}
                  </Text>
                </View>

                <View style={styles.cardActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      navigation.navigate('RuleEditor', { ruleId: rule.id })
                    }
                    style={styles.editButton}
                  >
                    <Text style={styles.editText}>编辑</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => confirmDelete(rule)}
                    style={styles.deleteButton}
                  >
                    <Text style={styles.deleteText}>
                      {rule.origin === 'LEARNED_MERCHANT' ? '撤销学习' : '删除'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { gap: 16, padding: 16, paddingBottom: 36 },
  explanation: {
    gap: 6,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    padding: 14,
  },
  explanationTitle: { color: '#1E3A8A', fontSize: 14, fontWeight: '800' },
  explanationText: { color: '#1E40AF', fontSize: 12, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 10 },
  learningActions: {
    gap: 8,
    borderRadius: 14,
    backgroundColor: '#F5F3FF',
    padding: 14,
  },
  learningDeleteButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 13,
    backgroundColor: '#FEF2F2',
    paddingVertical: 13,
  },
  notice: {
    borderRadius: 10,
    backgroundColor: '#DCFCE7',
    color: '#166534',
    lineHeight: 19,
    padding: 12,
  },
  primaryAction: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 13,
    backgroundColor: '#2563EB',
    paddingVertical: 13,
  },
  primaryActionText: { color: '#FFFFFF', fontWeight: '800' },
  secondaryAction: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    paddingVertical: 13,
  },
  secondaryActionText: { color: '#1D4ED8', fontWeight: '800' },
  error: {
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    color: '#991B1B',
    lineHeight: 19,
    padding: 12,
  },
  centered: { alignItems: 'center', gap: 10, paddingVertical: 60 },
  emptyCard: {
    alignItems: 'center',
    gap: 8,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    padding: 28,
  },
  emptyTitle: { color: '#0F172A', fontSize: 18, fontWeight: '800' },
  muted: { color: '#64748B', lineHeight: 20, textAlign: 'center' },
  ruleList: { gap: 12 },
  ruleCard: {
    gap: 11,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    padding: 17,
  },
  ruleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  badges: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  typeBadge: {
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    color: '#334155',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  learnedBadge: {
    borderRadius: 999,
    backgroundColor: '#EDE9FE',
    color: '#6D28D9',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  createdBadge: {
    borderRadius: 999,
    backgroundColor: '#DCFCE7',
    color: '#166534',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pattern: { color: '#0F172A', fontSize: 20, fontWeight: '900' },
  target: { color: '#334155', fontSize: 14, lineHeight: 21 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  meta: { color: '#64748B', fontSize: 11 },
  cardActions: { flexDirection: 'row', gap: 9 },
  editButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 11,
    backgroundColor: '#EFF6FF',
    paddingVertical: 10,
  },
  editText: { color: '#1D4ED8', fontWeight: '800' },
  deleteButton: {
    alignItems: 'center',
    borderRadius: 11,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  deleteText: { color: '#B91C1C', fontWeight: '800' },
});
