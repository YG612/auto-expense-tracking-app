import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ParsedTransactionCandidate } from '../../../classification/types';
import { formatAmountMinor } from '../../../domain/services/manualTransaction';
import {
  colors,
  control,
  radius,
  shadows,
  spacing,
} from '../../../theme/tokens';

export type CandidateSaveState = 'UNSAVED' | 'SAVING' | 'PENDING' | 'CONFIRMED';

type Props = {
  candidate: ParsedTransactionCandidate;
  inputSource?: 'TEXT' | 'VOICE';
  index: number;
  categoryLabel: string;
  accountLabel: string;
  targetAccountLabel?: string;
  saveState: CandidateSaveState;
  canConfirm: boolean;
  canPersist: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onPending: () => void;
  onOpenPending: () => void;
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
  USER_RULE: '用户自定义规则',
  LEARNED_MERCHANT: '历史纠正形成的商户规则',
  MERCHANT_DICTIONARY: '本地商户词典',
  COMMON_KEYWORD: '通用关键词规则',
  DEFAULT: '默认建议',
} as const;

function confidenceText(candidate: ParsedTransactionCandidate): string {
  const band =
    candidate.confidenceLevel === 'HIGH'
      ? '高'
      : candidate.confidenceLevel === 'MEDIUM'
        ? '中'
        : '低';
  return `${band}置信度 ${Math.round(candidate.confidence * 100)}%`;
}

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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
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
  saveState,
  canConfirm,
  canPersist,
  onConfirm,
  onEdit,
  onPending,
  onOpenPending,
}: Props) {
  const saved = saveState === 'PENDING' || saveState === 'CONFIRMED';
  const saving = saveState === 'SAVING';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <View style={styles.ordinalRow}>
            <Text style={styles.ordinal}>候选 {index + 1}</Text>
            <Text style={styles.inputSource}>
              {inputSource === 'VOICE' ? '语音转写' : '文字输入'}
            </Text>
          </View>
          <Text accessibilityRole="header" style={styles.source}>
            {candidate.sourceText}
          </Text>
        </View>
        <View
          style={[
            styles.confidence,
            candidate.confidenceLevel === 'HIGH' && styles.highConfidence,
            candidate.confidenceLevel === 'LOW' && styles.lowConfidence,
          ]}
        >
          <Text
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.6}
            minimumFontScale={0.75}
            numberOfLines={1}
            style={[
              styles.confidenceText,
              candidate.confidenceLevel === 'HIGH' && styles.highConfidenceText,
              candidate.confidenceLevel === 'LOW' && styles.lowConfidenceText,
            ]}
          >
            {confidenceText(candidate)}
          </Text>
        </View>
      </View>

      <Text style={styles.amount}>
        {candidate.amountMinor === undefined
          ? '金额待补充'
          : formatAmountMinor(candidate.amountMinor)}
      </Text>

      <View style={styles.details}>
        <Detail
          label="类型"
          value={TYPE_LABELS[candidate.type ?? ''] ?? '待补充'}
        />
        <Detail label="分类" value={categoryLabel} />
        <Detail label="账户" value={accountLabel} />
        {candidate.type === 'TRANSFER' ? (
          <Detail label="转入" value={targetAccountLabel ?? '待补充'} />
        ) : null}
        <Detail label="时间" value={formatDate(candidate.occurredAt)} />
        {candidate.merchantRawName === undefined ? null : (
          <Detail label="商户/对象" value={candidate.merchantRawName} />
        )}
        {candidate.projectName === undefined ? null : (
          <Detail label="建议项目" value={candidate.projectName} />
        )}
        {candidate.tags.length === 0 ? null : (
          <Detail label="建议标签" value={candidate.tags.join('、')} />
        )}
      </View>

      <View style={styles.sourceNotice}>
        <Text style={styles.sourceNoticeTitle}>建议来源</Text>
        <Text style={styles.sourceNoticeText}>
          {SUGGESTION_SOURCE_LABELS[candidate.suggestionSource]}
          {candidate.matchedRulePattern === undefined
            ? ''
            : ` · “${candidate.matchedRulePattern}” · 优先级 ${candidate.matchedRulePriority ?? 0}`}
        </Text>
      </View>

      {candidate.categoryAlternatives.length === 0 ? null : (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>可选方向</Text>
          <Text style={styles.noticeText}>
            {candidate.categoryAlternatives.map(item => item.label).join('、')}
          </Text>
        </View>
      )}

      {candidate.missingFields.length === 0 ? null : (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            待补充：{candidate.missingFields.join('、')}
          </Text>
        </View>
      )}

      {candidate.ambiguityReasons.length === 0 ? null : (
        <View style={styles.reasons}>
          {candidate.ambiguityReasons.map(reason => (
            <Text key={reason} style={styles.reason}>
              · {reason}
            </Text>
          ))}
        </View>
      )}

      {saveState === 'CONFIRMED' ? (
        <View style={styles.savedBanner}>
          <Text style={styles.savedText}>✓ 已确认入账</Text>
        </View>
      ) : saveState === 'PENDING' ? (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenPending}
          style={styles.pendingBanner}
        >
          <Text style={styles.pendingText}>已放入待确认箱 · 点击查看</Text>
        </Pressable>
      ) : (
        <View style={styles.actions}>
          {canConfirm ? (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={onConfirm}
              style={[styles.primaryAction, saving && styles.disabled]}
            >
              <Text style={styles.primaryActionText}>
                {saving ? '保存中…' : '确认入账'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={onEdit}
            style={[styles.secondaryAction, saving && styles.disabled]}
          >
            <Text style={styles.secondaryActionText}>
              {canPersist ? '编辑后确认' : '转到手动补充'}
            </Text>
          </Pressable>
          {canPersist ? (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={onPending}
              style={[styles.textAction, saving && styles.disabled]}
            >
              <Text style={styles.textActionText}>暂存待确认</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      {saved ? null : (
        <Text style={styles.privacy}>
          确认前不会写入账本；分类解析全程仅在本机完成。
        </Text>
      )}
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
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  headerText: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 200,
    gap: 3,
  },
  ordinalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  ordinal: { color: colors.brand, fontSize: 12, fontWeight: '800' },
  inputSource: {
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    color: colors.inkMuted,
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  source: {
    color: colors.inkSecondary,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
  },
  confidence: {
    maxWidth: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  highConfidence: { backgroundColor: colors.incomeSoft },
  lowConfidence: { backgroundColor: colors.expenseSoft },
  confidenceText: {
    color: colors.warningText,
    fontSize: 11,
    fontWeight: '800',
  },
  highConfidenceText: { color: colors.incomeText },
  lowConfidenceText: { color: colors.expenseText },
  amount: { color: colors.ink, fontSize: 30, fontWeight: '900' },
  details: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sourceNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sourceNoticeTitle: {
    color: colors.inkSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  sourceNoticeText: {
    minWidth: 0,
    flex: 1,
    color: colors.inkMuted,
    fontSize: 11,
  },
  detail: {
    width: '48%',
    gap: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    padding: 9,
  },
  detailLabel: { color: colors.inkMuted, fontSize: 11 },
  detailValue: {
    color: colors.inkSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  notice: {
    gap: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    padding: 11,
  },
  noticeTitle: { color: colors.brandPressed, fontSize: 12, fontWeight: '800' },
  noticeText: { color: colors.brand, fontSize: 12, lineHeight: 18 },
  warning: {
    borderRadius: radius.sm,
    backgroundColor: colors.warningSoft,
    padding: 10,
  },
  warningText: {
    color: colors.warningText,
    fontSize: 12,
    fontWeight: '700',
  },
  reasons: { gap: 3 },
  reason: { color: colors.inkMuted, fontSize: 12, lineHeight: 18 },
  actions: { gap: 9 },
  primaryAction: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    padding: 13,
  },
  primaryActionText: { color: colors.white, fontSize: 15, fontWeight: '800' },
  secondaryAction: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brandMuted,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    padding: 12,
  },
  secondaryActionText: {
    color: colors.brandPressed,
    fontSize: 14,
    fontWeight: '800',
  },
  textAction: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  textActionText: {
    color: colors.inkSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  disabled: { opacity: 0.55 },
  privacy: { color: colors.inkMuted, fontSize: 10, textAlign: 'center' },
  savedBanner: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.incomeSoft,
    padding: 12,
  },
  savedText: { color: colors.incomeText, fontWeight: '800' },
  pendingBanner: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
    padding: 12,
  },
  pendingText: { color: colors.warningText, fontWeight: '800' },
});
