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
import type { Account, Category } from '../../domain/entities';
import { safeErrorMessage } from '../../domain/errors/AppError';
import { formatAmountMinor } from '../../domain/services/manualTransaction';
import {
  canDirectlyConfirmTextTransaction,
  confirmationIssues,
} from '../../domain/services/textTransaction';
import { categoryTypeForTransactionType } from '../../domain/services/transactionSemantics';
import {
  SelectionModal,
  type SelectionOption,
} from '../manual-bookkeeping/components/SelectionModal';
import {
  transactionCategoryLabel,
  transactionTitle,
} from '../transactions/transactionPresentation';
import {
  pendingAccountOptions,
  pendingCategoryOptions,
  type PendingReviewChoice,
} from './pendingReviewOptions';

type ReviewField = 'CATEGORY' | 'ACCOUNT';
type CardModal = { transactionId: string; field: ReviewField };

function confidenceLabel(value: number | undefined): string {
  if (value === undefined) {
    return '未评分';
  }
  const band = value >= 0.9 ? '高' : value >= 0.65 ? '中' : '低';
  return `${band}置信度 ${Math.round(value * 100)}%`;
}

export function pendingTransactionsEligibleForBatch(
  transactions: readonly TransactionSummary[],
): TransactionSummary[] {
  return transactions.filter(canDirectlyConfirmTextTransaction);
}

export function PendingCard({
  transaction,
  busy,
  onConfirm,
  onEdit,
  onDelete,
  selected,
  onToggleSelected,
  categoryChoices = [],
  accountChoices = [],
  onChooseCategory,
  onChooseAccount,
  onMoreCategories,
  onMoreAccounts,
}: {
  transaction: TransactionSummary;
  busy: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onDelete: () => void;
  selected?: boolean;
  onToggleSelected?: () => void;
  categoryChoices?: readonly PendingReviewChoice[];
  accountChoices?: readonly PendingReviewChoice[];
  onChooseCategory?: (id: string) => void;
  onChooseAccount?: (id: string) => void;
  onMoreCategories?: () => void;
  onMoreAccounts?: () => void;
}) {
  const canConfirm = canDirectlyConfirmTextTransaction(transaction);
  const issues = confirmationIssues(transaction);

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        {onToggleSelected === undefined ? null : (
          <Pressable
            accessibilityLabel={
              selected ? '取消选择此待确认记录' : '选择此待确认记录'
            }
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            disabled={busy}
            onPress={onToggleSelected}
            style={[styles.checkbox, selected && styles.checkboxSelected]}
          >
            <Text style={styles.checkboxText}>{selected ? '✓' : ''}</Text>
          </Pressable>
        )}
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
      {onChooseAccount === undefined ? null : (
        <InlineReviewField
          busy={busy}
          choices={accountChoices}
          label="账户"
          missing={transaction.accountId === undefined}
          onChoose={onChooseAccount}
          onMore={onMoreAccounts}
        />
      )}
      {onChooseCategory === undefined || categoryChoices.length === 0 ? null : (
        <InlineReviewField
          busy={busy}
          choices={categoryChoices}
          label="分类"
          missing={transaction.categoryId === undefined}
          onChoose={onChooseCategory}
          onMore={onMoreCategories}
        />
      )}
      {issues.length === 0 ? null : (
        <Text style={styles.issues}>确认前需补充：{issues.join('、')}</Text>
      )}
      {transaction.requiresReview !== true ? null : (
        <Text style={styles.issues}>
          识别结果存在不确定项，请检查并编辑后再确认。
        </Text>
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
        {canConfirm ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onEdit}
            style={styles.secondaryAction}
          >
            <Text style={styles.secondaryActionText}>编辑</Text>
          </Pressable>
        ) : null}
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

function InlineReviewField({
  label,
  missing,
  busy,
  choices,
  onChoose,
  onMore,
}: {
  label: string;
  missing: boolean;
  busy: boolean;
  choices: readonly PendingReviewChoice[];
  onChoose: (id: string) => void;
  onMore?: () => void;
}) {
  return (
    <View style={[styles.reviewField, missing && styles.reviewFieldMissing]}>
      <View style={styles.reviewFieldHeader}>
        <View style={styles.reviewFieldTitleGroup}>
          <Text style={styles.reviewFieldLabel}>{label}</Text>
          <Text style={missing ? styles.requiredBadge : styles.readyBadge}>
            {missing ? '必选' : '可直接修改'}
          </Text>
        </View>
        {onMore === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onMore}
            style={[styles.moreChoiceButton, busy && styles.disabled]}
          >
            <Text style={styles.moreChoiceText}>更多</Text>
          </Pressable>
        )}
      </View>
      <ScrollView
        contentContainerStyle={styles.quickChoices}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {choices.map(choice => (
          <Pressable
            accessibilityLabel={`${label}：${
              choice.detail === undefined
                ? choice.label
                : `${choice.detail} / ${choice.label}`
            }${choice.recommendation === 'MOST_LIKELY' ? '，最可能' : ''}`}
            accessibilityRole="button"
            accessibilityState={{ selected: choice.selected }}
            disabled={busy}
            key={choice.id}
            onPress={() => onChoose(choice.id)}
            style={[
              styles.quickChoice,
              choice.selected && styles.quickChoiceSelected,
              busy && styles.disabled,
            ]}
          >
            <View style={styles.quickChoiceTop}>
              {choice.icon === undefined ? null : (
                <Text style={styles.quickChoiceIcon}>{choice.icon}</Text>
              )}
              <Text
                numberOfLines={1}
                style={[
                  styles.quickChoiceLabel,
                  choice.selected && styles.quickChoiceLabelSelected,
                ]}
              >
                {choice.label}
              </Text>
              {choice.selected ? (
                <Text style={styles.choiceCheck}>✓</Text>
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.quickChoiceDetail,
                choice.selected && styles.quickChoiceDetailSelected,
              ]}
            >
              {choice.recommendation === 'MOST_LIKELY'
                ? `最可能${
                    choice.detail === undefined ? '' : ` · ${choice.detail}`
                  }`
                : choice.recommendation === 'ALTERNATIVE'
                  ? `备选${
                      choice.detail === undefined ? '' : ` · ${choice.detail}`
                    }`
                  : (choice.detail ?? '常用')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export function PendingScreen() {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchField, setBatchField] = useState<ReviewField>();
  const [cardModal, setCardModal] = useState<CardModal>();
  const [loading, setLoading] = useState(true);
  const [busyOperation, setBusyOperation] = useState<string>();
  const busyRef = useRef(false);
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError(undefined);
      Promise.all([
        repositories.transactions.listSummaries({
          confirmationStatus: 'PENDING',
        }),
        Promise.all([
          repositories.categories.listVisibleByUsage('EXPENSE'),
          repositories.categories.listVisibleByUsage('INCOME'),
        ]).then(([expense, income]) => [...expense, ...income]),
        repositories.accounts.listVisibleByUsage(),
      ])
        .then(([rows, loadedCategories, loadedAccounts]) => {
          if (active) {
            setTransactions(rows);
            setCategories(loadedCategories);
            setAccounts(loadedAccounts);
            setSelectedIds(
              current =>
                new Set(
                  [...current].filter(id => rows.some(row => row.id === id)),
                ),
            );
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
    }, [repositories]),
  );

  const confirmable = useMemo(
    () => pendingTransactionsEligibleForBatch(transactions),
    [transactions],
  );
  const selected = useMemo(
    () => transactions.filter(transaction => selectedIds.has(transaction.id)),
    [selectedIds, transactions],
  );
  const selectedConfirmable = useMemo(
    () => pendingTransactionsEligibleForBatch(selected),
    [selected],
  );
  const selectedType =
    selected.length > 0 &&
    selected.every(item => item.type === selected[0]?.type)
      ? selected[0]?.type
      : undefined;
  const categoryOptions = useMemo<SelectionOption[]>(() => {
    const categoryType = categoryTypeForTransactionType(selectedType);
    if (categoryType === undefined) return [];
    return categories
      .filter(
        category =>
          category.type === categoryType &&
          !category.isHidden &&
          category.parentId === undefined,
      )
      .map(category => ({
        id: category.id,
        label: category.name,
        icon: category.icon,
      }));
  }, [categories, selectedType]);
  const accountOptions = useMemo<SelectionOption[]>(
    () =>
      accounts.map(account => ({
        id: account.id,
        label: account.name,
        icon: account.icon,
      })),
    [accounts],
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

  const reloadPending = async () => {
    const rows = await repositories.transactions.listSummaries({
      confirmationStatus: 'PENDING',
    });
    setTransactions(rows);
    setSelectedIds(
      current =>
        new Set([...current].filter(id => rows.some(row => row.id === id))),
    );
  };

  const selectedReferences = () =>
    selected.map(transaction => ({
      id: transaction.id,
      revision: transaction.revision,
    }));

  const applyBatchAssignment = async (field: ReviewField, id: string) => {
    setBatchField(undefined);
    if (!beginBusy(`assign-${field}`)) return;
    setError(undefined);
    try {
      const result = await repositories.transactions.reviewPendingBatch(
        selectedReferences(),
        field === 'CATEGORY' ? { categoryId: id } : { accountId: id },
        new Date().toISOString(),
      );
      await reloadPending();
      Alert.alert(
        '批量修改完成',
        `已更新 ${result.appliedIds.length} 笔待确认记录。`,
      );
    } catch (assignmentError) {
      setError(
        safeErrorMessage(
          assignmentError,
          '批量修改失败。',
          'PENDING-BATCH-ASSIGN-UNEXPECTED',
        ),
      );
    } finally {
      endBusy();
    }
  };

  const applyCardAssignment = async (
    transaction: TransactionSummary,
    field: ReviewField,
    id: string,
  ) => {
    setCardModal(undefined);
    if (!beginBusy(`assign-${transaction.id}-${field}`)) return;
    setError(undefined);
    try {
      const result = await repositories.transactions.reviewPendingBatch(
        [{ id: transaction.id, revision: transaction.revision }],
        field === 'CATEGORY' ? { categoryId: id } : { accountId: id },
        new Date().toISOString(),
      );
      if (!result.appliedIds.includes(transaction.id)) {
        throw new Error('这笔记录已被修改，请刷新后重试。');
      }
      await reloadPending();
    } catch (assignmentError) {
      setError(
        safeErrorMessage(
          assignmentError,
          `修改${field === 'CATEGORY' ? '分类' : '账户'}失败。`,
          'PENDING-CARD-ASSIGN-UNEXPECTED',
        ),
      );
    } finally {
      endBusy();
    }
  };

  const confirmSelected = async () => {
    if (selectedConfirmable.length === 0 || !beginBusy('confirm-selected')) {
      return;
    }
    setError(undefined);
    try {
      const result = await repositories.transactions.confirmPendingBatch(
        selectedConfirmable.map(transaction => ({
          id: transaction.id,
          revision: transaction.revision,
        })),
        new Date().toISOString(),
      );
      setSelectedIds(new Set());
      await reloadPending();
      Alert.alert(
        '批量确认完成',
        `已确认 ${result.confirmedIds.length} 笔；有风险或缺字段的记录仍保留。`,
      );
    } catch (batchError) {
      setError(
        safeErrorMessage(
          batchError,
          '批量确认失败。',
          'PENDING-SELECTED-CONFIRM-UNEXPECTED',
        ),
      );
    } finally {
      endBusy();
    }
  };

  const ignoreSelected = () => {
    Alert.alert(
      '忽略所选待确认记录？',
      '这些记录会进入回收站，原有账目不受影响。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '忽略',
          style: 'destructive',
          onPress: async () => {
            if (!beginBusy('ignore-selected')) return;
            setError(undefined);
            try {
              const result =
                await repositories.transactions.softDeletePendingBatch(
                  selectedReferences(),
                  new Date().toISOString(),
                );
              setSelectedIds(new Set());
              await reloadPending();
              Alert.alert(
                '已忽略',
                `${result.appliedIds.length} 笔记录已移入回收站。`,
              );
            } catch (ignoreError) {
              setError(
                safeErrorMessage(
                  ignoreError,
                  '批量忽略失败。',
                  'PENDING-BATCH-IGNORE-UNEXPECTED',
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

  const confirm = async (transaction: TransactionSummary) => {
    if (!beginBusy(transaction.id)) {
      return;
    }
    setError(undefined);
    try {
      const confirmed = await repositories.transactions.confirmPending(
        { id: transaction.id, revision: transaction.revision },
        new Date().toISOString(),
      );
      if (confirmed.status !== 'APPLIED') {
        throw new Error('这笔记录已被修改，请刷新后重试。');
      }
      setTransactions(current =>
        current.filter(item => item.id !== transaction.id),
      );
      setSelectedIds(current => {
        const next = new Set(current);
        next.delete(transaction.id);
        return next;
      });
    } catch (confirmError) {
      setError(
        safeErrorMessage(
          confirmError,
          '确认失败，请重试。',
          'PENDING-CONFIRM-UNEXPECTED',
        ),
      );
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
                new Date().toISOString(),
              );
              if (deleted.status !== 'APPLIED') {
                throw new Error('记录已被修改，请刷新后重试。');
              }
              setTransactions(current =>
                current.filter(item => item.id !== transaction.id),
              );
              setSelectedIds(current => {
                const next = new Set(current);
                next.delete(transaction.id);
                return next;
              });
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
        <View>
          <Text style={styles.headerTitle}>{transactions.length} 笔待确认</Text>
          <Text style={styles.headerDescription}>
            需检查或缺少字段的记录不会进入统计，也不会批量确认。
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

      {transactions.length === 0 ? null : (
        <View style={styles.selectionBar}>
          <Pressable
            accessibilityRole="button"
            disabled={busyOperation !== undefined}
            onPress={() =>
              setSelectedIds(
                selected.length === transactions.length
                  ? new Set()
                  : new Set(transactions.map(item => item.id)),
              )
            }
            style={styles.selectionButton}
          >
            <Text style={styles.selectionButtonText}>
              {selected.length === transactions.length
                ? '取消全选'
                : '全选待确认'}
            </Text>
          </Pressable>
          <Text style={styles.selectionCount}>已选 {selected.length} 笔</Text>
          {selected.length === 0 ? null : (
            <ScrollView
              contentContainerStyle={styles.batchActions}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              <Pressable
                accessibilityRole="button"
                disabled={
                  busyOperation !== undefined || categoryOptions.length === 0
                }
                onPress={() => setBatchField('CATEGORY')}
                style={[
                  styles.batchAction,
                  busyOperation !== undefined && styles.disabled,
                ]}
              >
                <Text style={styles.batchActionText}>改分类</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busyOperation !== undefined}
                onPress={() => setBatchField('ACCOUNT')}
                style={[
                  styles.batchAction,
                  busyOperation !== undefined && styles.disabled,
                ]}
              >
                <Text style={styles.batchActionText}>改账户</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={
                  busyOperation !== undefined ||
                  selectedConfirmable.length === 0
                }
                onPress={confirmSelected}
                style={[
                  styles.batchAction,
                  busyOperation !== undefined && styles.disabled,
                ]}
              >
                <Text style={styles.batchActionText}>
                  确认可用 {selectedConfirmable.length}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busyOperation !== undefined}
                onPress={ignoreSelected}
                style={[
                  styles.batchAction,
                  styles.ignoreAction,
                  busyOperation !== undefined && styles.disabled,
                ]}
              >
                <Text style={styles.ignoreActionText}>忽略</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
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
          {transactions.map(transaction => {
            const categorySuggestions = pendingCategoryOptions(
              transaction,
              categories,
            );
            const accountSuggestions = pendingAccountOptions(
              transaction,
              accounts,
            );
            return (
              <PendingCard
                accountChoices={accountSuggestions.quick}
                busy={busyOperation !== undefined}
                categoryChoices={categorySuggestions.quick}
                key={transaction.id}
                onChooseAccount={id =>
                  applyCardAssignment(transaction, 'ACCOUNT', id)
                }
                onChooseCategory={
                  categorySuggestions.all.length === 0
                    ? undefined
                    : id => applyCardAssignment(transaction, 'CATEGORY', id)
                }
                onConfirm={() => confirm(transaction)}
                onDelete={() => remove(transaction)}
                onEdit={() =>
                  navigation.navigate('ManualEntry', {
                    transactionId: transaction.id,
                  })
                }
                onMoreAccounts={() =>
                  setCardModal({
                    transactionId: transaction.id,
                    field: 'ACCOUNT',
                  })
                }
                onMoreCategories={
                  categorySuggestions.all.length === 0
                    ? undefined
                    : () =>
                        setCardModal({
                          transactionId: transaction.id,
                          field: 'CATEGORY',
                        })
                }
                onToggleSelected={() =>
                  setSelectedIds(current => {
                    const next = new Set(current);
                    if (next.has(transaction.id)) next.delete(transaction.id);
                    else next.add(transaction.id);
                    return next;
                  })
                }
                selected={selectedIds.has(transaction.id)}
                transaction={transaction}
              />
            );
          })}
        </ScrollView>
      )}
      <SelectionModal
        onChange={ids => {
          const id = ids[0];
          if (id !== undefined && batchField !== undefined) {
            applyBatchAssignment(batchField, id).catch(() => undefined);
          }
        }}
        onClose={() => setBatchField(undefined)}
        options={batchField === 'CATEGORY' ? categoryOptions : accountOptions}
        selectedIds={[]}
        title={batchField === 'CATEGORY' ? '批量设置分类' : '批量设置账户'}
        visible={batchField !== undefined}
      />
      <SelectionModal
        onChange={ids => {
          const id = ids[0];
          const modal = cardModal;
          const transaction = transactions.find(
            item => item.id === modal?.transactionId,
          );
          if (
            id !== undefined &&
            modal !== undefined &&
            transaction !== undefined
          ) {
            applyCardAssignment(transaction, modal.field, id).catch(
              () => undefined,
            );
          }
        }}
        onClose={() => setCardModal(undefined)}
        options={(() => {
          const transaction = transactions.find(
            item => item.id === cardModal?.transactionId,
          );
          if (transaction === undefined) return [];
          return cardModal?.field === 'CATEGORY'
            ? pendingCategoryOptions(transaction, categories).all
            : pendingAccountOptions(transaction, accounts).all;
        })()}
        selectedIds={(() => {
          const transaction = transactions.find(
            item => item.id === cardModal?.transactionId,
          );
          if (transaction === undefined) return [];
          const id =
            cardModal?.field === 'CATEGORY'
              ? (transaction.subcategoryId ?? transaction.categoryId)
              : transaction.accountId;
          return id === undefined ? [] : [id];
        })()}
        title={cardModal?.field === 'CATEGORY' ? '选择分类' : '选择账户'}
        visible={cardModal !== undefined}
      />
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
  checkbox: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#94A3B8',
    borderRadius: 7,
  },
  checkboxSelected: { borderColor: '#2563EB', backgroundColor: '#2563EB' },
  checkboxText: { color: '#FFFFFF', fontWeight: '900' },
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
  reviewField: {
    gap: 8,
    borderWidth: 1,
    borderColor: '#DDE8FF',
    borderRadius: 13,
    backgroundColor: '#F8FAFD',
    padding: 10,
  },
  reviewFieldMissing: { borderColor: '#F4C77D', backgroundColor: '#FFFBEB' },
  reviewFieldHeader: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reviewFieldTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  reviewFieldLabel: { color: '#344054', fontSize: 12, fontWeight: '900' },
  readyBadge: { color: '#667085', fontSize: 10, fontWeight: '700' },
  requiredBadge: {
    borderRadius: 999,
    backgroundColor: '#FFF1D6',
    color: '#8A4B00',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  moreChoiceButton: { paddingHorizontal: 4, paddingVertical: 4 },
  moreChoiceText: { color: '#2457E6', fontSize: 11, fontWeight: '800' },
  quickChoices: { gap: 7, paddingRight: 4 },
  quickChoice: {
    minWidth: 104,
    maxWidth: 144,
    minHeight: 52,
    justifyContent: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: '#E4E9F1',
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  quickChoiceSelected: { borderColor: '#2457E6', backgroundColor: '#EEF4FF' },
  quickChoiceTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  quickChoiceIcon: { fontSize: 13 },
  quickChoiceLabel: {
    minWidth: 0,
    flexShrink: 1,
    color: '#344054',
    fontSize: 12,
    fontWeight: '800',
  },
  quickChoiceLabelSelected: { color: '#1948C8' },
  choiceCheck: { color: '#2457E6', fontSize: 11, fontWeight: '900' },
  quickChoiceDetail: { color: '#667085', fontSize: 9, fontWeight: '700' },
  quickChoiceDetailSelected: { color: '#2457E6' },
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
  selectionBar: {
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CBD5E1',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  selectionButton: { alignSelf: 'flex-start' },
  selectionButtonText: { color: '#1D4ED8', fontSize: 12, fontWeight: '900' },
  selectionCount: { color: '#475569', fontSize: 11 },
  batchActions: { gap: 8 },
  batchAction: {
    minHeight: 36,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
  },
  batchActionText: { color: '#1D4ED8', fontSize: 12, fontWeight: '800' },
  ignoreAction: { borderColor: '#FECACA' },
  ignoreActionText: { color: '#DC2626', fontSize: 12, fontWeight: '800' },
});
