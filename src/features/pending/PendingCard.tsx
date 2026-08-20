import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { TransactionSummary } from '../../database';
import type {
  Account,
  Category,
  Project,
  Tag,
  TransactionType,
} from '../../domain/entities';
import { categorySelectionLabel } from '../../domain/policies/bookkeepingPresentationPolicy';
import {
  getTransactionTypeOption,
  TRANSACTION_TYPE_OPTIONS,
  type ManualTransactionDraft,
  validateManualTransaction,
} from '../../domain/services/manualTransaction';
import { confirmationIssues } from '../../domain/services/textTransaction';
import {
  colors,
  control,
  radius,
  shadows,
  spacing,
  typography,
} from '../../theme/tokens';
import { DateTimeField } from '../manual-bookkeeping/components/DateTimeField';
import {
  SelectionModal,
  type SelectionOption,
} from '../manual-bookkeeping/components/SelectionModal';
import { pendingDraftFromTransaction } from './pendingTransactionEditing';

type ModalName = 'category' | 'account' | 'targetAccount' | 'project' | 'tag';

export type PendingReferenceData = {
  categories: readonly Category[];
  accounts: readonly Account[];
  projects: readonly Project[];
  tags: readonly Tag[];
};

type PendingCardProps = {
  transaction: TransactionSummary;
  tagIds: readonly string[];
  references: PendingReferenceData;
  busy: boolean;
  onSave: (draft: ManualTransactionDraft, confirm: boolean) => Promise<boolean>;
  onEdit: () => void;
  onDelete: () => void;
};

function confidenceLabel(value: number | undefined): string {
  if (value === undefined) {
    return '未评分';
  }
  const band = value >= 0.9 ? '高' : value >= 0.65 ? '中' : '低';
  return `${band}置信度 ${Math.round(value * 100)}%`;
}

function sourceLabel(source: TransactionSummary['source']): string {
  const labels: Partial<Record<TransactionSummary['source'], string>> = {
    TEXT: '文字识别',
    VOICE: '语音识别',
    OCR: '图片识别',
    ANDROID_NOTIFICATION: '支付通知',
    IOS_SHARE: '系统分享',
    WECHAT_IMPORT: '微信账单',
    ALIPAY_IMPORT: '支付宝账单',
    CSV_IMPORT: '表格导入',
  };
  return labels[source] ?? source;
}

function selectedName(
  options: readonly SelectionOption[],
  selectedId: string | undefined,
  fallback: string,
): string {
  const selected = options.find(option => option.id === selectedId);
  return selected === undefined ? fallback : selected.label;
}

function categoryOptions(
  categories: readonly Category[],
  type: 'EXPENSE' | 'INCOME',
): SelectionOption[] {
  const visible = categories.filter(
    category => category.type === type && !category.isHidden,
  );
  const parents = new Map(
    visible
      .filter(category => category.parentId === undefined)
      .map(category => [category.id, category]),
  );

  return visible.map(category => ({
    id: category.id,
    label: category.name,
    icon: category.icon,
    detail:
      category.parentId === undefined
        ? undefined
        : parents.get(category.parentId)?.name,
  }));
}

function selectedCategoryId(draft: ManualTransactionDraft): string[] {
  return draft.subcategoryId === undefined
    ? draft.categoryId === undefined
      ? []
      : [draft.categoryId]
    : [draft.subcategoryId];
}

function CompactField({
  label,
  required = false,
  wide = false,
  children,
}: {
  label: string;
  required?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.field, wide && styles.wideField]}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function Selector({
  label,
  missing = false,
  onPress,
}: {
  label: string;
  missing?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.selector, missing && styles.missingSelector]}
    >
      <Text
        numberOfLines={1}
        style={[styles.selectorText, missing && styles.missingSelectorText]}
      >
        {label}
      </Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export function PendingCard({
  transaction,
  tagIds,
  references,
  busy,
  onSave,
  onEdit,
  onDelete,
}: PendingCardProps) {
  const [draft, setDraft] = useState(() =>
    pendingDraftFromTransaction(transaction, tagIds),
  );
  const [activeModal, setActiveModal] = useState<ModalName>();
  const [validationMessage, setValidationMessage] = useState<string>();
  const [savingMode, setSavingMode] = useState<'save' | 'confirm'>();

  const transactionOption = getTransactionTypeOption(draft.type);
  const availableCategoryOptions = useMemo(
    () =>
      transactionOption.categoryType === undefined
        ? []
        : categoryOptions(
            references.categories,
            transactionOption.categoryType,
          ),
    [references.categories, transactionOption.categoryType],
  );
  const accountOptions = useMemo(
    () =>
      references.accounts
        .filter(account => !account.isHidden)
        .map(account => ({
          id: account.id,
          label: account.name,
          icon: account.icon,
        })),
    [references.accounts],
  );
  const projectOptions = useMemo(
    () =>
      references.projects
        .filter(project => !project.isArchived)
        .map(project => ({ id: project.id, label: project.name })),
    [references.projects],
  );
  const tagOptions = useMemo(
    () => references.tags.map(tag => ({ id: tag.id, label: tag.name })),
    [references.tags],
  );
  const categoryLabel = categorySelectionLabel(
    references.categories,
    draft.categoryId,
    draft.subcategoryId,
    transaction.categoryName ?? '选择分类',
  );
  const currentIssues = confirmationIssues({
    ...transaction,
    type: draft.type,
    amountMinor: Number(draft.amountText) > 0 ? 1 : 0,
    occurredAt: draft.occurredAt.toISOString(),
    categoryId: draft.categoryId,
    subcategoryId: draft.subcategoryId,
    accountId: draft.accountId,
    targetAccountId: draft.targetAccountId,
  });

  const changeType = (type: TransactionType) => {
    const previousCategoryType = getTransactionTypeOption(
      draft.type,
    ).categoryType;
    const nextOption = getTransactionTypeOption(type);
    setDraft(current => ({
      ...current,
      type,
      categoryId:
        previousCategoryType === nextOption.categoryType
          ? current.categoryId
          : undefined,
      subcategoryId:
        previousCategoryType === nextOption.categoryType
          ? current.subcategoryId
          : undefined,
      targetAccountId: nextOption.requiresTargetAccount
        ? current.targetAccountId
        : undefined,
    }));
    setValidationMessage(undefined);
  };

  const chooseCategory = (ids: string[]) => {
    const selected = references.categories.find(
      category => category.id === ids[0],
    );
    if (selected?.parentId === undefined) {
      setDraft(current => ({
        ...current,
        categoryId: selected?.id,
        subcategoryId: undefined,
      }));
    } else {
      setDraft(current => ({
        ...current,
        categoryId: selected.parentId,
        subcategoryId: selected.id,
      }));
    }
    setValidationMessage(undefined);
  };

  const save = async (confirm: boolean) => {
    const validation = validateManualTransaction(draft);
    if (!validation.ok) {
      setValidationMessage(validation.message);
      return;
    }

    setSavingMode(confirm ? 'confirm' : 'save');
    setValidationMessage(undefined);
    try {
      await onSave(draft, confirm);
    } finally {
      setSavingMode(undefined);
    }
  };

  const disabled = busy || savingMode !== undefined;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeading}>
        <View style={styles.sourceGroup}>
          <Text style={styles.source}>{sourceLabel(transaction.source)}</Text>
          <Text
            style={[
              styles.confidence,
              (transaction.confidence ?? 0) < 0.65 && styles.lowConfidence,
            ]}
          >
            {confidenceLabel(transaction.confidence)}
          </Text>
        </View>
        <Text style={styles.editingHint}>字段可直接修改</Text>
      </View>

      {transaction.originalText === undefined ? null : (
        <View style={styles.receiptStrip}>
          <Text style={styles.receiptLabel}>识别原文</Text>
          <Text style={styles.originalText}>“{transaction.originalText}”</Text>
        </View>
      )}

      <CompactField label="交易类型" required wide>
        <View style={styles.typeGrid}>
          {TRANSACTION_TYPE_OPTIONS.map(option => {
            const selected = option.value === draft.type;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                disabled={disabled}
                key={option.value}
                onPress={() => changeType(option.value)}
                style={[styles.typeChip, selected && styles.selectedTypeChip]}
              >
                <Text
                  style={[
                    styles.typeChipText,
                    selected && styles.selectedTypeChipText,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </CompactField>

      <View style={styles.fieldGrid}>
        <CompactField label="金额（元）" required>
          <View style={styles.amountControl}>
            <Text style={styles.currency}>¥</Text>
            <TextInput
              accessibilityLabel="金额"
              editable={!disabled}
              keyboardType="decimal-pad"
              maxLength={14}
              onChangeText={amountText =>
                setDraft(current => ({ ...current, amountText }))
              }
              placeholder="0.00"
              placeholderTextColor={colors.placeholder}
              selectTextOnFocus
              style={styles.amountInput}
              value={draft.amountText}
            />
          </View>
        </CompactField>

        {transactionOption.categoryType === undefined ? null : (
          <CompactField label="分类" required>
            <Selector
              label={categoryLabel}
              missing={draft.categoryId === undefined}
              onPress={() => setActiveModal('category')}
            />
          </CompactField>
        )}

        <CompactField
          label={transactionOption.requiresTargetAccount ? '转出账户' : '账户'}
          required
        >
          <Selector
            label={selectedName(
              accountOptions,
              draft.accountId,
              transaction.accountName ?? '选择账户',
            )}
            missing={draft.accountId === undefined}
            onPress={() => setActiveModal('account')}
          />
        </CompactField>

        {transactionOption.requiresTargetAccount ? (
          <CompactField label="转入账户" required>
            <Selector
              label={selectedName(
                accountOptions,
                draft.targetAccountId,
                transaction.targetAccountName ?? '选择转入账户',
              )}
              missing={draft.targetAccountId === undefined}
              onPress={() => setActiveModal('targetAccount')}
            />
          </CompactField>
        ) : null}
      </View>

      <CompactField label="日期和时间" required wide>
        <View style={styles.dateControl}>
          <DateTimeField
            onChange={occurredAt =>
              setDraft(current => ({ ...current, occurredAt }))
            }
            value={draft.occurredAt}
          />
        </View>
      </CompactField>

      <View style={styles.detailSection}>
        <Text style={styles.detailTitle}>识别详情</Text>
        <CompactField label="商户" wide>
          <TextInput
            accessibilityLabel="商户"
            editable={!disabled}
            maxLength={80}
            onChangeText={merchantName =>
              setDraft(current => ({ ...current, merchantName }))
            }
            placeholder="未识别，可直接补充"
            placeholderTextColor={colors.placeholder}
            style={styles.textInput}
            value={draft.merchantName}
          />
        </CompactField>

        <View style={styles.fieldGrid}>
          <CompactField label="项目">
            <Selector
              label={selectedName(
                projectOptions,
                draft.projectId,
                transaction.projectName ?? '未选择',
              )}
              onPress={() => setActiveModal('project')}
            />
          </CompactField>
          <CompactField label="标签">
            <Selector
              label={
                draft.tagIds.length === 0
                  ? '未选择'
                  : draft.tagIds
                      .map(
                        id =>
                          references.tags.find(tag => tag.id === id)?.name ??
                          id,
                      )
                      .join('、')
              }
              onPress={() => setActiveModal('tag')}
            />
          </CompactField>
        </View>

        <CompactField label="备注" wide>
          <TextInput
            accessibilityLabel="备注"
            editable={!disabled}
            maxLength={500}
            multiline
            onChangeText={note => setDraft(current => ({ ...current, note }))}
            placeholder="未识别，可直接补充"
            placeholderTextColor={colors.placeholder}
            style={[styles.textInput, styles.noteInput]}
            textAlignVertical="top"
            value={draft.note}
          />
        </CompactField>
      </View>

      {currentIssues.length === 0 ? null : (
        <Text accessibilityRole="alert" style={styles.issue}>
          确认前需补充：{currentIssues.join('、')}
        </Text>
      )}
      {validationMessage === undefined ? null : (
        <Text accessibilityRole="alert" style={styles.validation}>
          {validationMessage}
        </Text>
      )}
      {transaction.requiresReview !== true ? null : (
        <Text style={styles.reviewNote}>
          这笔结果原本存在不确定项；保存后将以你当前填写的内容为准。
        </Text>
      )}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => save(true)}
          style={[styles.primaryAction, disabled && styles.disabled]}
        >
          {savingMode === 'confirm' ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : null}
          <Text style={styles.primaryActionText}>
            {savingMode === 'confirm' ? '正在确认…' : '保存并确认'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => save(false)}
          style={[styles.saveAction, disabled && styles.disabled]}
        >
          <Text style={styles.saveActionText}>
            {savingMode === 'save' ? '保存中…' : '仅保存'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={onEdit}
          style={[styles.editAction, disabled && styles.disabled]}
        >
          <Text style={styles.editActionText}>编辑</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={onDelete}
          style={styles.deleteAction}
        >
          <Text style={styles.deleteActionText}>删除</Text>
        </Pressable>
      </View>

      {activeModal === 'category' ? (
        <SelectionModal
          onChange={chooseCategory}
          onClose={() => setActiveModal(undefined)}
          options={availableCategoryOptions}
          selectedIds={selectedCategoryId(draft)}
          title="分类"
          visible
        />
      ) : null}
      {activeModal === 'account' ? (
        <SelectionModal
          onChange={ids =>
            setDraft(current => ({ ...current, accountId: ids[0] }))
          }
          onClose={() => setActiveModal(undefined)}
          options={accountOptions}
          selectedIds={draft.accountId === undefined ? [] : [draft.accountId]}
          title={transactionOption.requiresTargetAccount ? '转出账户' : '账户'}
          visible
        />
      ) : null}
      {activeModal === 'targetAccount' ? (
        <SelectionModal
          onChange={ids =>
            setDraft(current => ({ ...current, targetAccountId: ids[0] }))
          }
          onClose={() => setActiveModal(undefined)}
          options={accountOptions.filter(
            option => option.id !== draft.accountId,
          )}
          selectedIds={
            draft.targetAccountId === undefined ? [] : [draft.targetAccountId]
          }
          title="转入账户"
          visible
        />
      ) : null}
      {activeModal === 'project' ? (
        <SelectionModal
          allowClear
          onChange={ids =>
            setDraft(current => ({ ...current, projectId: ids[0] }))
          }
          onClose={() => setActiveModal(undefined)}
          options={projectOptions}
          selectedIds={draft.projectId === undefined ? [] : [draft.projectId]}
          title="项目"
          visible
        />
      ) : null}
      {activeModal === 'tag' ? (
        <SelectionModal
          allowClear
          multiple
          onChange={ids => setDraft(current => ({ ...current, tagIds: ids }))}
          onClose={() => setActiveModal(undefined)}
          options={tagOptions}
          selectedIds={draft.tagIds}
          title="标签"
          visible
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    ...shadows.card,
  },
  cardHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sourceGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  source: {
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    color: colors.brandPressed,
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  confidence: {
    color: colors.warningText,
    fontSize: 11,
    fontWeight: '700',
  },
  lowConfidence: { color: colors.expenseText },
  editingHint: { color: colors.inkMuted, fontSize: 11, fontWeight: '600' },
  receiptStrip: {
    gap: spacing.xxs,
    borderLeftWidth: 3,
    borderLeftColor: colors.brandMuted,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  receiptLabel: {
    color: colors.inkMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  originalText: { color: colors.inkSecondary, fontSize: 13, lineHeight: 19 },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  field: { minWidth: 136, flex: 1, gap: 6 },
  wideField: { width: '100%', flexBasis: '100%' },
  fieldLabel: { color: colors.inkSecondary, fontSize: 11, fontWeight: '700' },
  required: { color: colors.expenseText },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  typeChip: {
    minHeight: 36,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
  },
  selectedTypeChip: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  typeChipText: { color: colors.inkSecondary, fontSize: 12, fontWeight: '700' },
  selectedTypeChipText: { color: colors.white },
  selector: {
    minHeight: control.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
  },
  missingSelector: {
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  selectorText: { minWidth: 0, flex: 1, color: colors.ink, fontSize: 14 },
  missingSelectorText: { color: colors.warningText, fontWeight: '700' },
  chevron: { color: colors.graphicMuted, fontSize: 22 },
  amountControl: {
    minHeight: control.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
  },
  currency: { color: colors.inkMuted, fontSize: 18, fontWeight: '700' },
  amountInput: {
    minWidth: 0,
    flex: 1,
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  dateControl: {
    minHeight: control.minTouchTarget,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  detailSection: {
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
    paddingTop: spacing.md,
  },
  detailTitle: {
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '800',
  },
  textInput: {
    minHeight: control.minTouchTarget,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: typography.body,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteInput: { minHeight: 72 },
  issue: {
    borderRadius: radius.sm,
    backgroundColor: colors.warningSoft,
    color: colors.warningText,
    fontSize: 12,
    fontWeight: '700',
    padding: spacing.sm,
  },
  validation: {
    borderRadius: radius.sm,
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    fontSize: 12,
    fontWeight: '700',
    padding: spacing.sm,
  },
  reviewNote: { color: colors.inkMuted, fontSize: 11, lineHeight: 17 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  primaryAction: {
    minHeight: control.minTouchTarget,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    paddingHorizontal: 12,
  },
  primaryActionText: { color: colors.white, fontSize: 13, fontWeight: '800' },
  saveAction: {
    minHeight: control.minTouchTarget,
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: 13,
  },
  saveActionText: {
    color: colors.brandPressed,
    fontSize: 12,
    fontWeight: '800',
  },
  editAction: {
    minHeight: control.minTouchTarget,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brandMuted,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: 13,
  },
  editActionText: {
    color: colors.brandPressed,
    fontSize: 12,
    fontWeight: '800',
  },
  deleteAction: {
    minHeight: control.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  deleteActionText: {
    color: colors.expenseText,
    fontSize: 12,
    fontWeight: '800',
  },
  disabled: { opacity: 0.55 },
});
