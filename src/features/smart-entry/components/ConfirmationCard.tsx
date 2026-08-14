import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons/static';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ParsedTransactionCandidate } from '../../../classification/types';
import {
  confirmationIntentFor,
  type RecognizedConfirmationIntent,
  reviewDisposition,
} from '../../../domain/services/reviewDisposition';
import { formatAmountMinor } from '../../../domain/services/manualTransaction';
import {
  colors,
  control,
  radius,
  shadows,
  spacing,
  typography,
} from '../../../theme/tokens';
import type { CandidateReviewState } from '../BookkeepingSession';

type Props = {
  candidate: ParsedTransactionCandidate;
  inputSource?: 'TEXT' | 'VOICE';
  index: number;
  categoryLabel: string;
  accountLabel: string;
  targetAccountLabel?: string;
  reviewState: CandidateReviewState;
  onConfirm: (intent: RecognizedConfirmationIntent) => void;
  onEdit: () => void;
  onPending: () => void;
};

const TYPE_LABELS: Readonly<Record<string, string>> = {
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
};

const SUGGESTION_SOURCE_LABELS = {
  EXPLICIT_TEXT: '本次明确表达',
  USER_RULE: '个人规则',
  LEARNED_MERCHANT: '历史纠正',
  MERCHANT_DICTIONARY: '本地商户资料',
  SEMANTIC_ONTOLOGY: '场景语义',
  COMMON_KEYWORD: '常用表达',
  DEFAULT: '默认建议',
} as const;

function formatDate(value: string | undefined): string {
  if (value === undefined) {
    return '待补充';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

export function ConfirmationCard({
  candidate,
  inputSource = 'TEXT',
  index,
  categoryLabel,
  accountLabel,
  targetAccountLabel,
  reviewState,
  onConfirm,
  onEdit,
  onPending,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const saving = reviewState === 'SAVING';
  const disposition = reviewDisposition(candidate);
  const confirmationIntent = confirmationIntentFor(candidate);
  const statusLabel =
    disposition === 'DIRECT_CONFIRM'
      ? '可确认'
      : disposition === 'REVIEW_CONFIRM'
        ? '核对后确认'
        : disposition === 'EDIT_OR_PENDING'
          ? '请检查'
          : '需补充';
  const confidenceLabel =
    candidate.confidenceLevel === 'HIGH'
      ? '高'
      : candidate.confidenceLevel === 'MEDIUM'
        ? '中'
        : '低';
  const advisoryReasons = candidate.advisoryReasons ?? [];
  const surfacedAdvisory =
    disposition === 'REVIEW_CONFIRM' ? advisoryReasons[0] : undefined;
  const extraReviewCount =
    candidate.ambiguityReasons.length +
    advisoryReasons.length -
    (surfacedAdvisory === undefined ? 0 : 1) +
    (candidate.categoryAlternatives.length > 0 ? 1 : 0);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.amountGroup}>
          <Text style={styles.ordinal}>第 {index + 1} 笔</Text>
          <Text style={styles.amount}>
            {candidate.amountMinor === undefined
              ? '金额待补充'
              : formatAmountMinor(candidate.amountMinor)}
          </Text>
        </View>
        <View
          style={[
            styles.status,
            disposition === 'DIRECT_CONFIRM' && styles.readyStatus,
            disposition === 'EDIT_ONLY' && styles.editStatus,
          ]}
        >
          <Text
            style={[
              styles.statusText,
              disposition === 'DIRECT_CONFIRM' && styles.readyStatusText,
              disposition === 'EDIT_ONLY' && styles.editStatusText,
            ]}
          >
            {statusLabel}
          </Text>
        </View>
      </View>

      <Text accessibilityRole="header" style={styles.source}>
        {candidate.sourceText}
      </Text>

      <View style={styles.summary}>
        <SummaryRow
          label="类型 / 分类"
          value={`${TYPE_LABELS[candidate.type ?? ''] ?? '待补充'} · ${categoryLabel}`}
        />
        <SummaryRow
          label={candidate.type === 'TRANSFER' ? '转出 / 转入' : '账户 / 时间'}
          value={
            candidate.type === 'TRANSFER'
              ? `${accountLabel} → ${targetAccountLabel ?? '待补充'}`
              : `${accountLabel} · ${formatDate(candidate.occurredAt)}`
          }
        />
        {candidate.type === 'TRANSFER' ? (
          <SummaryRow label="时间" value={formatDate(candidate.occurredAt)} />
        ) : null}
        {candidate.merchantRawName === undefined ? null : (
          <SummaryRow label="商户 / 对象" value={candidate.merchantRawName} />
        )}
      </View>

      {disposition === 'DIRECT_CONFIRM' ? null : (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.reviewSummary,
            disposition === 'EDIT_ONLY' && styles.editSummary,
          ]}
        >
          <MaterialDesignIcons
            color={
              disposition === 'EDIT_ONLY'
                ? colors.expenseText
                : colors.warningText
            }
            name="alert-circle-outline"
            size={18}
          />
          <Text
            style={[
              styles.reviewSummaryText,
              disposition === 'EDIT_ONLY' && styles.editSummaryText,
            ]}
          >
            {candidate.missingFields.length > 0
              ? `待补充：${candidate.missingFields.join('、')}`
              : disposition === 'REVIEW_CONFIRM'
                ? (surfacedAdvisory ?? '请核对当前建议，确认后将直接入账')
                : '这笔账需要你检查'}
            {extraReviewCount > 0 ? ` · 另有 ${extraReviewCount} 条提示` : ''}
          </Text>
        </View>
      )}

      <Pressable
        accessibilityLabel={expanded ? '收起详情' : '查看详情'}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(value => !value)}
        style={styles.disclosure}
      >
        <Text style={styles.disclosureText}>
          {expanded ? '收起详情' : '查看详情'}
        </Text>
        <MaterialDesignIcons
          color={colors.inkMuted}
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.details}>
          <SummaryRow
            label="识别把握"
            value={`${confidenceLabel} · ${statusLabel}`}
          />
          <SummaryRow
            label="输入方式"
            value={inputSource === 'VOICE' ? '语音转写' : '文字输入'}
          />
          <SummaryRow
            label="建议依据"
            value={SUGGESTION_SOURCE_LABELS[candidate.suggestionSource]}
          />
          {candidate.fieldEvidence === undefined
            ? null
            : (
                ['amount', 'type', 'category', 'account', 'occurredAt'] as const
              ).map(field => {
                const evidence = candidate.fieldEvidence?.[field];
                if (evidence === undefined) return null;
                const label = {
                  amount: '金额依据',
                  type: '类型依据',
                  category: '分类依据',
                  account: '账户依据',
                  occurredAt: '时间依据',
                }[field];
                return (
                  <SummaryRow
                    key={field}
                    label={label}
                    value={evidence.explanation}
                  />
                );
              })}
          {candidate.projectName === undefined ? null : (
            <SummaryRow label="项目" value={candidate.projectName} />
          )}
          {candidate.tags.length === 0 ? null : (
            <SummaryRow label="标签" value={candidate.tags.join('、')} />
          )}
          {candidate.note === undefined ? null : (
            <SummaryRow label="备注" value={candidate.note} />
          )}
          {candidate.categoryAlternatives.length === 0 ? null : (
            <SummaryRow
              label="可选分类"
              value={candidate.categoryAlternatives
                .map(item => item.label)
                .join('、')}
            />
          )}
          {candidate.ambiguityReasons.map(reason => (
            <Text key={reason} style={styles.reason}>
              · {reason}
            </Text>
          ))}
          {advisoryReasons.map(reason => (
            <Text key={reason} style={styles.reason}>
              · {reason}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        {confirmationIntent === undefined ? (
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={onEdit}
            style={[styles.primaryAction, saving && styles.disabled]}
          >
            <Text style={styles.primaryActionText}>
              {disposition === 'EDIT_ONLY' ? '补充信息' : '检查并编辑'}
            </Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              accessibilityHint={
                disposition === 'REVIEW_CONFIRM'
                  ? '请先核对卡片中的金额、类型、分类、账户和时间'
                  : undefined
              }
              accessibilityRole="button"
              disabled={saving}
              onPress={() => onConfirm(confirmationIntent)}
              style={[styles.primaryAction, saving && styles.disabled]}
            >
              <Text style={styles.primaryActionText}>
                {saving ? '保存中…' : '确认入账'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={onEdit}
              style={[styles.secondaryAction, saving && styles.disabled]}
            >
              <Text style={styles.secondaryActionText}>编辑</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
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
  amountGroup: { minWidth: 0, flex: 1, gap: 2 },
  ordinal: { color: colors.inkMuted, fontSize: 11, fontWeight: '700' },
  amount: { color: colors.ink, fontSize: 30, fontWeight: '900' },
  status: {
    flexShrink: 0,
    borderRadius: radius.pill,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  readyStatus: { backgroundColor: colors.incomeSoft },
  editStatus: { backgroundColor: colors.expenseSoft },
  statusText: {
    color: colors.warningText,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  readyStatusText: { color: colors.incomeText },
  editStatusText: { color: colors.expenseText },
  source: {
    color: colors.inkSecondary,
    fontSize: typography.body,
    fontWeight: '700',
    lineHeight: 21,
  },
  summary: {
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  summaryLabel: {
    width: 82,
    color: colors.inkMuted,
    fontSize: typography.caption,
    lineHeight: 19,
  },
  summaryValue: {
    minWidth: 0,
    flex: 1,
    color: colors.inkSecondary,
    fontSize: typography.body,
    fontWeight: '700',
    lineHeight: 20,
  },
  reviewSummary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.warningSoft,
    padding: spacing.sm,
  },
  editSummary: { backgroundColor: colors.expenseSoft },
  reviewSummaryText: {
    minWidth: 0,
    flex: 1,
    color: colors.warningText,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  editSummaryText: { color: colors.expenseText },
  disclosure: {
    minHeight: control.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
  },
  disclosureText: {
    color: colors.inkMuted,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  details: {
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
  },
  reason: {
    color: colors.inkMuted,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  actions: { gap: spacing.xs },
  primaryAction: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryActionText: {
    color: colors.white,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryAction: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brandMuted,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryActionText: {
    color: colors.brandPressed,
    fontSize: typography.body,
    fontWeight: '800',
    textAlign: 'center',
  },
  textAction: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  textActionText: {
    color: colors.inkSecondary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  disabled: { opacity: 0.55 },
});
