import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { ParsedTransactionCandidate } from '../../../classification/types';
import type { Account, Category, Project, Tag } from '../../../domain/entities';
import { categorySelectionLabel } from '../../../domain/policies/bookkeepingPresentationPolicy';
import {
  type ManualTransactionDraft,
  validateManualTransaction,
} from '../../../domain/services/manualTransaction';
import { reviewDisposition } from '../../../domain/services/reviewDisposition';
import {
  colors,
  control,
  radius,
  shadows,
  spacing,
  typography,
} from '../../../theme/tokens';
import {
  SelectionModal,
  type SelectionOption,
} from '../../manual-bookkeeping/components/SelectionModal';
import type { CandidateReviewState } from '../BookkeepingSession';

type ReferenceData = {
  categories: readonly Category[];
  accounts: readonly Account[];
  projects: readonly Project[];
  tags: readonly Tag[];
};

type ModalName = 'category' | 'account' | 'targetAccount' | 'project' | 'tag';

const TYPE_LABELS = {
  EXPENSE: '支出',
  INCOME: '收入',
  TRANSFER: '转账',
  REFUND: '退款',
  BORROW_IN: '借入',
  LEND_OUT: '借出',
  REPAYMENT_IN: '收到还款',
  REPAYMENT_OUT: '支付还款',
  REIMBURSEMENT: '报销回款',
  ADJUSTMENT: '余额调整',
} as const;

function formatDateTime(value: string | undefined): string {
  if (value === undefined) return '时间待确认';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

type Props = {
  candidate: ParsedTransactionCandidate;
  initialDraft: ManualTransactionDraft;
  references: ReferenceData;
  index: number;
  categoryLabel: string;
  accountLabel: string;
  targetAccountLabel?: string;
  reviewState: CandidateReviewState;
  onConfirmEdited: (draft: ManualTransactionDraft) => Promise<unknown> | void;
  onEdit: () => void;
  onPending: () => void;
};

function selectedName(
  options: readonly SelectionOption[],
  selectedId: string | undefined,
  fallback: string,
): string {
  return options.find(option => option.id === selectedId)?.label ?? fallback;
}

function categoryOptions(
  categories: readonly Category[],
  type: 'EXPENSE' | 'INCOME',
): SelectionOption[] {
  return categories
    .filter(
      category =>
        category.type === type &&
        !category.isHidden &&
        category.parentId === undefined,
    )
    .map(category => ({
      id: category.id,
      label: category.name,
      icon: category.icon,
    }));
}

function selectedCategoryId(draft: ManualTransactionDraft): string[] {
  return draft.categoryId === undefined ? [] : [draft.categoryId];
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Selector({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.selector, disabled && styles.disabled]}
    >
      <Text numberOfLines={1} style={styles.selectorText}>
        {label}
      </Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export function ConfirmationCard({
  candidate,
  initialDraft,
  references,
  index,
  categoryLabel,
  accountLabel,
  targetAccountLabel,
  reviewState,
  onConfirmEdited,
  onEdit,
  onPending,
}: Props) {
  const [draft, setDraft] = useState(initialDraft);
  const [activeModal, setActiveModal] = useState<ModalName>();
  const [validationMessage, setValidationMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const disposition = reviewDisposition(candidate);
  const saving = reviewState === 'SAVING' || submitting;

  const showAmount = candidate.amountMinor !== undefined;
  const showCategory =
    candidate.categoryKey !== undefined ||
    candidate.subcategoryKey !== undefined ||
    candidate.classificationLabel !== undefined;
  const showAccount =
    candidate.accountKey !== undefined || candidate.accountIdHint !== undefined;
  const showTargetAccount = candidate.targetAccountKey !== undefined;
  const showMerchant = (candidate.merchantRawName?.trim().length ?? 0) > 0;
  const showProject = (candidate.projectName?.trim().length ?? 0) > 0;
  const showTags = candidate.tags.length > 0;

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
  const availableCategoryOptions = useMemo(
    () =>
      categoryOptions(
        references.categories,
        draft.type === 'EXPENSE' ? 'EXPENSE' : 'INCOME',
      ),
    [draft.type, references.categories],
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

  const chooseCategory = (ids: string[]) => {
    const selectedId = ids[0];
    setDraft(current => ({
      ...current,
      categoryId: selectedId,
      // Keep the model's more specific signal while the user leaves its parent
      // unchanged. Switching the visible top-level category invalidates it.
      subcategoryId:
        selectedId !== undefined && selectedId === current.categoryId
          ? current.subcategoryId
          : undefined,
    }));
    setValidationMessage(undefined);
  };

  const confirm = async () => {
    const currentValidation = validateManualTransaction(draft);
    if (!currentValidation.ok) {
      setValidationMessage(currentValidation.message);
      return;
    }
    setSubmitting(true);
    setValidationMessage(undefined);
    try {
      await onConfirmEdited(draft);
    } finally {
      setSubmitting(false);
    }
  };

  const validation = validateManualTransaction(draft);
  const needsFullEditor =
    !validation.ok &&
    ((validation.field === 'amountText' && !showAmount) ||
      (validation.field === 'categoryId' && !showCategory) ||
      (validation.field === 'accountId' && !showAccount) ||
      (validation.field === 'targetAccountId' && !showTargetAccount));
  const onlyMissingAccount =
    candidate.missingFields.length === 1 &&
    candidate.missingFields[0] === '账户';
  const statusLabel =
    disposition === 'DIRECT_CONFIRM'
      ? '可确认'
      : disposition === 'REVIEW_CONFIRM'
        ? '核对后确认'
        : disposition === 'EDIT_OR_PENDING'
          ? '请检查'
          : onlyMissingAccount
            ? '请选择入账账户'
            : '需补充';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.ordinal}>第 {index + 1} 笔</Text>
          <Text style={styles.editHint}>识别字段可直接修改</Text>
        </View>
        <View style={styles.status}>
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.sourceStrip}>
        <Text style={styles.sourceLabel}>本笔解析片段</Text>
        <Text accessibilityRole="header" style={styles.source}>
          “{candidate.sourceText}”
        </Text>
      </View>

      <View style={styles.readonlySummary}>
        <Text style={styles.readonlyLabel}>类型与时间</Text>
        <Text style={styles.readonlyValue}>
          {TYPE_LABELS[draft.type]} · {formatDateTime(candidate.occurredAt)}
        </Text>
      </View>

      <View style={styles.fields}>
        {showAmount ? (
          <Field label="金额">
            <View style={styles.amountControl}>
              <Text style={styles.currency}>¥</Text>
              <TextInput
                accessibilityLabel="金额"
                editable={!saving}
                keyboardType="decimal-pad"
                maxLength={14}
                onChangeText={amountText => {
                  setDraft(current => ({ ...current, amountText }));
                  setValidationMessage(undefined);
                }}
                selectTextOnFocus
                style={styles.amountInput}
                value={draft.amountText}
              />
            </View>
          </Field>
        ) : null}

        {showCategory ? (
          <Field label="分类">
            <Selector
              disabled={saving}
              label={categorySelectionLabel(
                references.categories,
                draft.categoryId,
                undefined,
                categoryLabel,
              )}
              onPress={() => setActiveModal('category')}
            />
          </Field>
        ) : null}

        {showAccount ? (
          <Field label={showTargetAccount ? '转出账户' : '账户'}>
            <Selector
              disabled={saving}
              label={selectedName(
                accountOptions,
                draft.accountId,
                accountLabel,
              )}
              onPress={() => setActiveModal('account')}
            />
          </Field>
        ) : null}

        {showTargetAccount ? (
          <Field label="转入账户">
            <Selector
              disabled={saving}
              label={selectedName(
                accountOptions,
                draft.targetAccountId,
                targetAccountLabel ?? '选择账户',
              )}
              onPress={() => setActiveModal('targetAccount')}
            />
          </Field>
        ) : null}

        {showMerchant ? (
          <Field label="商户">
            <TextInput
              accessibilityLabel="商户"
              editable={!saving}
              maxLength={80}
              onChangeText={merchantName =>
                setDraft(current => ({ ...current, merchantName }))
              }
              style={styles.textInput}
              value={draft.merchantName}
            />
          </Field>
        ) : null}

        {showProject ? (
          <Field label="项目">
            <Selector
              disabled={saving}
              label={selectedName(
                projectOptions,
                draft.projectId,
                candidate.projectName ?? '选择项目',
              )}
              onPress={() => setActiveModal('project')}
            />
          </Field>
        ) : null}

        {showTags ? (
          <Field label="标签">
            <Selector
              disabled={saving}
              label={
                draft.tagIds.length === 0
                  ? candidate.tags.join('、')
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
          </Field>
        ) : null}

        <Field label="备注（可选）">
          <TextInput
            accessibilityLabel="备注"
            editable={!saving}
            maxLength={500}
            multiline
            onChangeText={note => setDraft(current => ({ ...current, note }))}
            placeholder="补充用途、同行人等信息"
            style={[styles.textInput, styles.noteInput]}
            textAlignVertical="top"
            value={draft.note}
          />
        </Field>
      </View>

      {validationMessage === undefined ? null : (
        <Text accessibilityRole="alert" style={styles.validation}>
          {validationMessage}
        </Text>
      )}

      <View style={styles.actions}>
        {needsFullEditor ? (
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={onEdit}
            style={[styles.primaryAction, saving && styles.disabled]}
          >
            <Text style={styles.primaryActionText}>编辑</Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={confirm}
              style={[styles.primaryAction, saving && styles.disabled]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : null}
              <Text style={styles.primaryActionText}>
                {submitting ? '保存中…' : '确认入账'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={onEdit}
              style={[styles.editAction, saving && styles.disabled]}
            >
              <Text style={styles.editActionText}>编辑</Text>
            </Pressable>
          </>
        )}
        {disposition === 'EDIT_ONLY' ? null : (
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={onPending}
            style={[styles.textAction, saving && styles.disabled]}
          >
            <Text style={styles.textActionText}>存入待处理</Text>
          </Pressable>
        )}
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
          title={showTargetAccount ? '转出账户' : '账户'}
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
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    ...shadows.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  ordinal: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  editHint: { color: colors.inkMuted, fontSize: 11, marginTop: 3 },
  status: {
    borderRadius: radius.pill,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: { color: colors.warningText, fontSize: 11, fontWeight: '800' },
  sourceStrip: {
    gap: 4,
    borderLeftWidth: 3,
    borderLeftColor: colors.brandMuted,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  sourceLabel: {
    color: colors.inkMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  source: { color: colors.inkSecondary, fontSize: 13, lineHeight: 19 },
  readonlySummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  readonlyLabel: { color: colors.inkMuted, fontSize: 11 },
  readonlyValue: {
    color: colors.inkSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  fields: { gap: spacing.sm },
  field: { gap: 6 },
  fieldLabel: { color: colors.inkSecondary, fontSize: 11, fontWeight: '800' },
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
  selectorText: { minWidth: 0, flex: 1, color: colors.ink, fontSize: 14 },
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
    fontSize: 22,
    fontWeight: '900',
    paddingHorizontal: 7,
    paddingVertical: 8,
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
  noteInput: { minHeight: 68 },
  validation: {
    borderRadius: radius.sm,
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    fontSize: 12,
    fontWeight: '700',
    padding: spacing.sm,
  },
  actions: { gap: spacing.xs },
  primaryAction: {
    minHeight: control.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
  },
  primaryActionText: {
    color: colors.white,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
  },
  editAction: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brandMuted,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  editActionText: {
    color: colors.brandPressed,
    fontSize: typography.body,
    fontWeight: '800',
  },
  textAction: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textActionText: {
    color: colors.inkSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  disabled: { opacity: 0.55 },
});
