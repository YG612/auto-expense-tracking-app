import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRepositories } from '../../app/DatabaseProvider';
import type { StatementImportReview } from '../../database';
import { safeErrorMessage } from '../../domain/errors/AppError';
import { formatAmountMinor } from '../../domain/services/manualTransaction';
import { parseStatementCsv } from '../../importers/statementCsv';
import { colors, radius, spacing, typography } from '../../theme/tokens';

export function StatementImportScreen() {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const [fileName, setFileName] = useState('账单.csv');
  const [content, setContent] = useState('');
  const [review, setReview] = useState<StatementImportReview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const analyze = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const preview = parseStatementCsv({ content, fileName });
      setReview(await repositories.statementImport.analyze(preview));
    } catch (analysisError) {
      setReview(undefined);
      setError(
        safeErrorMessage(
          analysisError,
          '无法解析 CSV，请检查表头、日期和金额格式。',
          'STATEMENT-CSV-ANALYZE',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (busy || review === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await repositories.statementImport.commit(
        review,
        new Date().toISOString(),
      );
      Alert.alert(
        '导入完成',
        `已写入 ${result.transactionIds.length} 笔待确认记录；确定重复项已跳过。`,
        [
          {
            text: '查看待确认',
            onPress: () => navigation.navigate('Pending'),
          },
        ],
      );
    } catch (commitError) {
      setError(
        safeErrorMessage(
          commitError,
          '导入失败，数据库没有写入半批数据。',
          'STATEMENT-CSV-COMMIT',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>本地解析，不上传账单</Text>
          <Text style={styles.noticeText}>
            从微信、支付宝或其他表格复制 CSV
            内容。解析结果只会在确认后写入待确认箱。
          </Text>
        </View>

        <Text style={styles.label}>文件名</Text>
        <TextInput
          accessibilityLabel="CSV 文件名"
          editable={!busy}
          onChangeText={value => {
            setFileName(value);
            setReview(undefined);
          }}
          placeholder="账单.csv"
          style={styles.input}
          value={fileName}
        />

        <Text style={styles.label}>CSV 内容</Text>
        <TextInput
          accessibilityLabel="CSV 内容"
          editable={!busy}
          multiline
          onChangeText={value => {
            setContent(value);
            setReview(undefined);
          }}
          placeholder={
            '交易时间,收支类型,金额,商户\n2026-08-01 08:00,支出,12.50,早餐店'
          }
          style={[styles.input, styles.csvInput]}
          textAlignVertical="top"
          value={content}
        />

        {error === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={busy || content.trim().length === 0}
          onPress={analyze}
          style={[styles.primary, busy && styles.disabled]}
        >
          {busy ? <ActivityIndicator color={colors.white} /> : null}
          <Text style={styles.primaryText}>解析并检查</Text>
        </Pressable>

        {review === undefined ? null : (
          <View style={styles.review}>
            <Text style={styles.reviewTitle}>导入预览</Text>
            <Text style={styles.summary}>
              可导入 {review.rows.length - review.definiteDuplicateCount} 笔 ·
              确定重复 {review.definiteDuplicateCount} 笔 · 可能重复{' '}
              {review.possibleDuplicateCount} 笔 · 失败{' '}
              {review.preview.failures.length} 行
            </Text>
            {review.rows.slice(0, 20).map(row => (
              <View key={row.candidate.sourceRow} style={styles.row}>
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={styles.rowTitle}>
                    {row.candidate.merchantRawName ?? '未识别商户'}
                  </Text>
                  <Text style={styles.rowMeta}>
                    第 {row.candidate.sourceRow} 行 · {row.candidate.type} ·{' '}
                    {row.duplicateKind === 'NONE'
                      ? '新记录'
                      : row.duplicateKind === 'DEFINITE'
                        ? '确定重复'
                        : '可能重复'}
                  </Text>
                </View>
                <Text style={styles.amount}>
                  {formatAmountMinor(row.candidate.amountMinor)}
                </Text>
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={commit}
              style={[styles.primary, busy && styles.disabled]}
            >
              <Text style={styles.primaryText}>导入到待确认箱</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.xxl },
  notice: {
    gap: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
    padding: spacing.md,
  },
  noticeTitle: { color: colors.brandPressed, fontWeight: '800' },
  noticeText: { color: colors.inkSecondary, lineHeight: 20 },
  label: { color: colors.ink, fontSize: typography.caption, fontWeight: '800' },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.ink,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  csvInput: { minHeight: 180, fontFamily: 'monospace' },
  primary: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
  },
  primaryText: { color: colors.white, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  error: {
    borderRadius: radius.md,
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    padding: spacing.md,
  },
  review: { gap: spacing.sm },
  reviewTitle: {
    color: colors.ink,
    fontSize: typography.title,
    fontWeight: '900',
  },
  summary: { color: colors.inkSecondary, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  rowCopy: { minWidth: 0, flex: 1, gap: 3 },
  rowTitle: { color: colors.ink, fontWeight: '700' },
  rowMeta: { color: colors.inkMuted, fontSize: typography.caption },
  amount: { color: colors.ink, fontWeight: '900' },
});
