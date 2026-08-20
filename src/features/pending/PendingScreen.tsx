import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import { safeErrorMessage } from '../../domain/errors/AppError';
import type { Account, Category, Project, Tag } from '../../domain/entities';
import {
  type ManualTransactionDraft,
  validateManualTransaction,
} from '../../domain/services/manualTransaction';
import { buildCorrectionLearningPlan } from '../../domain/services/personalizationLearning';
import { canDirectlyConfirmTextTransaction } from '../../domain/services/textTransaction';
import {
  colors,
  control,
  radius,
  spacing,
  typography,
} from '../../theme/tokens';
import { createId } from '../../utils/createId';
import { PendingCard, type PendingReferenceData } from './PendingCard';
import { buildReviewedTransaction } from './pendingTransactionEditing';

export { PendingCard } from './PendingCard';

type PendingData = PendingReferenceData & {
  transactions: TransactionSummary[];
  tagIdsByTransaction: Record<string, string[]>;
};

const EMPTY_REFERENCES: PendingReferenceData = {
  categories: [],
  accounts: [],
  projects: [],
  tags: [],
};

export function pendingTransactionsEligibleForBatch(
  transactions: readonly TransactionSummary[],
): TransactionSummary[] {
  return transactions.filter(canDirectlyConfirmTextTransaction);
}

function safeMutationTime(transaction: TransactionSummary): string {
  return new Date(
    Math.max(Date.now(), Date.parse(transaction.updatedAt)),
  ).toISOString();
}

export function PendingScreen() {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [references, setReferences] =
    useState<PendingReferenceData>(EMPTY_REFERENCES);
  const [tagIdsByTransaction, setTagIdsByTransaction] = useState<
    Record<string, string[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [busyOperation, setBusyOperation] = useState<string>();
  const busyRef = useRef(false);
  const [error, setError] = useState<string>();

  const fetchPendingData = useCallback(async (): Promise<PendingData> => {
    const [rows, categories, accounts, projects, tags] = await Promise.all([
      repositories.transactions.listSummaries({
        confirmationStatus: 'PENDING',
      }),
      repositories.categories.listAll(),
      repositories.accounts.listAll(),
      repositories.projects.listAll(),
      repositories.tags.listAll(),
    ]);
    const transactionTags = await Promise.all(
      rows.map(transaction =>
        repositories.transactionTags.listForTransaction(transaction.id),
      ),
    );

    return {
      transactions: rows,
      categories: categories as Category[],
      accounts: accounts as Account[],
      projects: projects as Project[],
      tags: tags as Tag[],
      tagIdsByTransaction: Object.fromEntries(
        rows.map((transaction, index) => [
          transaction.id,
          transactionTags[index]?.map(tag => tag.id) ?? [],
        ]),
      ),
    };
  }, [repositories]);

  const applyPendingData = useCallback((data: PendingData) => {
    setTransactions(data.transactions);
    setReferences({
      categories: data.categories,
      accounts: data.accounts,
      projects: data.projects,
      tags: data.tags,
    });
    setTagIdsByTransaction(data.tagIdsByTransaction);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError(undefined);
      fetchPendingData()
        .then(data => {
          if (active) {
            applyPendingData(data);
          }
        })
        .catch(loadError => {
          if (active) {
            setError(
              safeErrorMessage(
                loadError,
                '读取待确认记录失败。',
                'PENDING-LOAD-UNEXPECTED',
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
    }, [applyPendingData, fetchPendingData]),
  );

  const confirmable = useMemo(
    () => pendingTransactionsEligibleForBatch(transactions),
    [transactions],
  );

  const beginBusy = (operation: string): boolean => {
    if (busyRef.current) {
      return false;
    }
    busyRef.current = true;
    setBusyOperation(operation);
    return true;
  };

  const endBusy = () => {
    busyRef.current = false;
    setBusyOperation(undefined);
  };

  const save = async (
    transaction: TransactionSummary,
    draft: ManualTransactionDraft,
    confirm: boolean,
  ): Promise<boolean> => {
    if (!beginBusy(transaction.id)) {
      return false;
    }
    const validation = validateManualTransaction(draft);
    if (!validation.ok) {
      setError(validation.message);
      endBusy();
      return false;
    }

    setError(undefined);
    try {
      const now = safeMutationTime(transaction);
      const reviewed = buildReviewedTransaction(
        transaction,
        draft,
        validation.amountMinor,
        now,
        confirm,
      );
      const learningPlan = confirm
        ? buildCorrectionLearningPlan(
            transaction,
            reviewed,
            now,
            createId('feedback'),
            createId('rule'),
          )
        : undefined;
      const tagIds = [...draft.tagIds];
      const learningResult =
        learningPlan === undefined
          ? undefined
          : await repositories.classificationFeedback.saveCorrectedTransactionWithTags(
              {
                transaction: reviewed,
                tagIds,
                feedback: learningPlan.feedback,
                correctionOptions: {
                  learnedMerchantRule: learningPlan.learnedMerchantRule,
                  processedAt: now,
                },
              },
            );

      if (learningPlan === undefined) {
        await repositories.transactions.saveWithTags(reviewed, tagIds);
      }

      if (confirm) {
        setTransactions(current =>
          current.filter(item => item.id !== transaction.id),
        );
        setTagIdsByTransaction(current => {
          const next = { ...current };
          delete next[transaction.id];
          return next;
        });
      } else {
        applyPendingData(await fetchPendingData());
      }

      if (learningResult?.promotionStatus === 'PROMOTED') {
        Alert.alert(
          '已学会这个商户',
          `你连续纠正了“${learningPlan?.learnedMerchantRule?.pattern ?? '该商户'}”的分类，下次识别会优先采用。`,
        );
      }
      return true;
    } catch (saveError) {
      setError(
        safeErrorMessage(
          saveError,
          confirm ? '保存并确认失败，请重试。' : '保存修改失败，请重试。',
          'PENDING-INLINE-SAVE-UNEXPECTED',
        ),
      );
      return false;
    } finally {
      endBusy();
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
    if (!beginBusy('batch')) {
      return;
    }
    setError(undefined);
    try {
      const result = await repositories.transactions.confirmPendingBatch(
        confirmable.map(transaction => ({
          id: transaction.id,
          revision: transaction.revision,
        })),
        new Date().toISOString(),
      );
      const count = result.confirmedIds.length;
      const skipped = transactions.length - count;
      const confirmedIds = new Set(result.confirmedIds);
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
        safeErrorMessage(
          batchError,
          '批量确认失败。',
          'PENDING-BATCH-CONFIRM-UNEXPECTED',
        ),
      );
    } finally {
      endBusy();
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
            if (!beginBusy(transaction.id)) {
              return;
            }
            try {
              const deleted = await repositories.transactions.softDelete(
                { id: transaction.id, revision: transaction.revision },
                safeMutationTime(transaction),
              );
              if (deleted.status !== 'APPLIED') {
                throw new Error('记录已被修改，请刷新后重试。');
              }
              setTransactions(current =>
                current.filter(item => item.id !== transaction.id),
              );
            } catch (deleteError) {
              setError(
                safeErrorMessage(
                  deleteError,
                  '删除失败。',
                  'PENDING-DELETE-UNEXPECTED',
                ),
              );
            } finally {
              endBusy();
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>{transactions.length} 笔待确认</Text>
          <Text style={styles.headerDescription}>
            识别结果已展开，可直接修改后保存或确认入账。
          </Text>
        </View>
        {confirmable.length === 0 ? null : (
          <Pressable
            accessibilityRole="button"
            disabled={busyOperation !== undefined}
            onPress={confirmAll}
            style={styles.batchButton}
          >
            <Text style={styles.batchButtonText}>
              确认可用项（{confirmable.length}）
            </Text>
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
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.muted}>正在读取待确认记录…</Text>
        </View>
      ) : transactions.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>待确认箱是空的</Text>
          <Text style={styles.muted}>自动识别结果需要复核时会出现在这里。</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('Main', { screen: 'SmartEntry' })
            }
            style={styles.startButton}
          >
            <Text style={styles.startButtonText}>去智能记账</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        >
          {transactions.map(transaction => (
            <PendingCard
              busy={busyOperation !== undefined}
              key={`${transaction.id}:${transaction.revision}`}
              onDelete={() => remove(transaction)}
              onEdit={() =>
                navigation.navigate('ManualEntry', {
                  transactionId: transaction.id,
                })
              }
              onSave={(draft, confirm) => save(transaction, draft, confirm)}
              references={references}
              tagIds={tagIdsByTransaction[transaction.id] ?? []}
              transaction={transaction}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  headerCopy: { minWidth: 0, flex: 1 },
  headerTitle: {
    color: colors.ink,
    fontSize: typography.title,
    fontWeight: '900',
  },
  headerDescription: {
    maxWidth: 250,
    marginTop: 3,
    color: colors.inkMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  batchButton: {
    minHeight: control.minTouchTarget,
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.sm,
  },
  batchButtonText: { color: colors.white, fontSize: 12, fontWeight: '800' },
  list: { gap: spacing.md, padding: spacing.sm, paddingBottom: spacing.xxl },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: spacing.xxl,
  },
  emptyTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  muted: { color: colors.inkMuted, textAlign: 'center', lineHeight: 20 },
  startButton: {
    minHeight: control.minTouchTarget,
    justifyContent: 'center',
    marginTop: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
  },
  startButtonText: { color: colors.white, fontWeight: '800' },
  error: {
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
});
