import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRepositories } from '../../app/DatabaseProvider';
import type { TransactionSummary } from '../../database';
import { formatAmountMinor } from '../../domain/services/manualTransaction';
import {
  canDirectlyConfirmTextTransaction,
  confirmationIssues,
} from '../../domain/services/textTransaction';
import {
  transactionCategoryLabel,
  transactionTitle,
} from '../transactions/transactionPresentation';

function confidenceLabel(value: number | undefined): string {
  if (value === undefined) {
    return '未评分';
  }
  const band = value >= 0.9 ? '高' : value >= 0.65 ? '中' : '低';
  return `${band}置信度 ${Math.round(value * 100)}%`;
}

function PendingCard({
  transaction,
  busy,
  onConfirm,
  onEdit,
  onDelete,
}: {
  transaction: TransactionSummary;
  busy: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const canConfirm = canDirectlyConfirmTextTransaction(transaction);
  const issues = confirmationIssues(transaction);

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.cardTitle}>
            {transactionTitle(transaction)}
          </Text>
          <Text style={styles.category}>
            {transactionCategoryLabel(transaction)}
          </Text>
        </View>
        <Text style={styles.amount}>
          {formatAmountMinor(transaction.amountMinor)}
        </Text>
      </View>
      <View style={styles.badges}>
        <Text
          style={[
            styles.confidence,
            (transaction.confidence ?? 0) < 0.65 && styles.lowConfidence,
          ]}
        >
          {confidenceLabel(transaction.confidence)}
        </Text>
        <Text style={styles.sourceBadge}>
          {transaction.source === 'TEXT' ? '文字识别' : transaction.source}
        </Text>
      </View>
      {transaction.originalText === undefined ? null : (
        <Text style={styles.originalText}>“{transaction.originalText}”</Text>
      )}
      {issues.length === 0 ? null : (
        <Text style={styles.issues}>确认前需补充：{issues.join('、')}</Text>
      )}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={canConfirm ? onConfirm : onEdit}
          style={[styles.primaryAction, busy && styles.disabled]}
        >
          <Text style={styles.primaryActionText}>
            {busy ? '处理中…' : canConfirm ? '确认入账' : '检查并确认'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onEdit}
          style={styles.secondaryAction}
        >
          <Text style={styles.secondaryActionText}>编辑</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onDelete}
          style={styles.deleteAction}
        >
          <Text style={styles.deleteActionText}>删除</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function PendingScreen() {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError(undefined);
      repositories.transactions
        .listSummaries({ confirmationStatus: 'PENDING' })
        .then(rows => {
          if (active) {
            setTransactions(rows);
          }
        })
        .catch(loadError => {
          if (active) {
            setError(
              loadError instanceof Error
                ? loadError.message
                : '读取待确认记录失败。',
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
    }, [repositories]),
  );

  const confirmable = useMemo(
    () => transactions.filter(canDirectlyConfirmTextTransaction),
    [transactions],
  );

  const confirm = async (transactionId: string) => {
    setBusyId(transactionId);
    setError(undefined);
    try {
      const confirmed = await repositories.transactions.confirmPending(
        transactionId,
        new Date().toISOString(),
      );
      if (!confirmed) {
        throw new Error('这笔记录已被修改，请刷新后重试。');
      }
      setTransactions(current =>
        current.filter(transaction => transaction.id !== transactionId),
      );
    } catch (confirmError) {
      setError(
        confirmError instanceof Error
          ? confirmError.message
          : '确认失败，请重试。',
      );
    } finally {
      setBusyId(undefined);
    }
  };

  const confirmAll = async () => {
    if (confirmable.length === 0) {
      Alert.alert(
        '暂无可批量确认记录',
        '缺少字段或低置信度的记录需要逐笔检查。',
      );
      return;
    }
    setBusyId('batch');
    setError(undefined);
    try {
      const count = await repositories.transactions.confirmPendingBatch(
        confirmable.map(transaction => transaction.id),
        new Date().toISOString(),
      );
      const skipped = transactions.length - count;
      const confirmedIds = new Set(
        confirmable.map(transaction => transaction.id),
      );
      setTransactions(current =>
        current.filter(transaction => !confirmedIds.has(transaction.id)),
      );
      Alert.alert(
        '批量确认完成',
        skipped > 0
          ? `已确认 ${count} 笔，另有 ${skipped} 笔需要逐笔检查。`
          : `已确认 ${count} 笔。`,
      );
    } catch (batchError) {
      setError(
        batchError instanceof Error ? batchError.message : '批量确认失败。',
      );
    } finally {
      setBusyId(undefined);
    }
  };

  const remove = (transaction: TransactionSummary) => {
    Alert.alert(
      '删除这条待确认记录？',
      '记录将进入回收站，之后仍可从流水页恢复。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            setBusyId(transaction.id);
            try {
              const deleted = await repositories.transactions.softDelete(
                transaction.id,
                new Date().toISOString(),
              );
              if (!deleted) {
                throw new Error('记录已被修改，请刷新后重试。');
              }
              setTransactions(current =>
                current.filter(item => item.id !== transaction.id),
              );
            } catch (deleteError) {
              setError(
                deleteError instanceof Error
                  ? deleteError.message
                  : '删除失败。',
              );
            } finally {
              setBusyId(undefined);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{transactions.length} 笔待确认</Text>
          <Text style={styles.headerDescription}>
            低置信度或缺少字段的记录不会进入统计。
          </Text>
        </View>
        {transactions.length === 0 ? null : (
          <Pressable
            accessibilityRole="button"
            disabled={busyId !== undefined}
            onPress={confirmAll}
            style={styles.batchButton}
          >
            <Text style={styles.batchButtonText}>确认可用项</Text>
          </Pressable>
        )}
      </View>

      {error === undefined ? null : (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#2563EB" />
          <Text style={styles.muted}>正在读取待确认记录…</Text>
        </View>
      ) : transactions.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>待确认箱是空的</Text>
          <Text style={styles.muted}>模糊文字记录会安全地暂存在这里。</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('Main', { screen: 'SmartEntry' })
            }
            style={styles.startButton}
          >
            <Text style={styles.startButtonText}>去文字记账</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {transactions.map(transaction => (
            <PendingCard
              busy={busyId === transaction.id || busyId === 'batch'}
              key={transaction.id}
              onConfirm={() => confirm(transaction.id)}
              onDelete={() => remove(transaction)}
              onEdit={() =>
                navigation.navigate('ManualEntry', {
                  transactionId: transaction.id,
                })
              }
              transaction={transaction}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
  headerTitle: { color: '#0F172A', fontSize: 18, fontWeight: '900' },
  headerDescription: {
    maxWidth: 220,
    marginTop: 3,
    color: '#64748B',
    fontSize: 11,
    lineHeight: 16,
  },
  batchButton: {
    borderRadius: 11,
    backgroundColor: '#2563EB',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  batchButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  list: { gap: 12, padding: 14, paddingBottom: 30 },
  card: {
    gap: 11,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    padding: 15,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 7,
    elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  identity: { minWidth: 0, flex: 1, gap: 3 },
  cardTitle: { color: '#0F172A', fontSize: 16, fontWeight: '800' },
  category: { color: '#64748B', fontSize: 12 },
  amount: { color: '#0F172A', fontSize: 17, fontWeight: '900' },
  badges: { flexDirection: 'row', gap: 7 },
  confidence: {
    borderRadius: 999,
    backgroundColor: '#FEF3C7',
    color: '#92400E',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  lowConfidence: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  sourceBadge: {
    borderRadius: 999,
    backgroundColor: '#EFF6FF',
    color: '#1D4ED8',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  originalText: {
    borderRadius: 9,
    backgroundColor: '#F8FAFC',
    color: '#475569',
    fontSize: 12,
    lineHeight: 18,
    padding: 9,
  },
  issues: {
    borderRadius: 9,
    backgroundColor: '#FFF7ED',
    color: '#9A3412',
    fontSize: 11,
    fontWeight: '700',
    padding: 9,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  primaryAction: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 11,
    backgroundColor: '#2563EB',
    paddingVertical: 10,
  },
  primaryActionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  secondaryAction: {
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  secondaryActionText: { color: '#1D4ED8', fontSize: 12, fontWeight: '800' },
  deleteAction: { paddingHorizontal: 6, paddingVertical: 10 },
  deleteActionText: { color: '#DC2626', fontSize: 12, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 28,
  },
  emptyTitle: { color: '#0F172A', fontSize: 19, fontWeight: '900' },
  muted: { color: '#64748B', textAlign: 'center', lineHeight: 20 },
  startButton: {
    marginTop: 6,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  startButtonText: { color: '#FFFFFF', fontWeight: '800' },
  error: {
    backgroundColor: '#FEE2E2',
    color: '#991B1B',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
