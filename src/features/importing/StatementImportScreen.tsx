import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons/static';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
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
import type { Category, ImportRecord } from '../../domain/entities';
import { safeErrorMessage } from '../../domain/errors/AppError';
import { formatAmountMinor } from '../../domain/services/manualTransaction';
import {
  inspectStatementHeaders,
  parseStatementCsv,
} from '../../importers/statementCsv';
import {
  inspectStatementXlsxHeaders,
  parseStatementXlsx,
} from '../../importers/statementXlsx';
import type {
  StatementColumnMapping,
  StatementField,
} from '../../importers/types';
import type {
  ImportMappingTemplate,
  ReviewedImportCandidate,
  StatementImportReview,
} from '../../database';
import { openLedgerTextFile } from '../../native/LedgerFilePortal';
import {
  colors,
  radius,
  shadows,
  spacing,
  typography,
} from '../../theme/tokens';
import { createId } from '../../utils/createId';
import {
  SelectionModal,
  type SelectionOption,
} from '../manual-bookkeeping/components/SelectionModal';

const MAPPING_FIELDS: readonly { field: StatementField; label: string }[] = [
  { field: 'occurredAt', label: '交易时间（必填）' },
  { field: 'amount', label: '金额（必填）' },
  { field: 'type', label: '收支类型' },
  { field: 'merchant', label: '商户/对方' },
  { field: 'account', label: '账户/支付方式' },
  { field: 'sourceReferenceId', label: '交易单号' },
  { field: 'note', label: '备注' },
];

type SelectedStatementFile = {
  fileName: string;
  encoding: 'UTF8' | 'BASE64';
  content: string;
  headers: readonly string[];
};

function sourceLabel(source: ImportRecord['source']): string {
  if (source === 'WECHAT') return '微信';
  if (source === 'ALIPAY') return '支付宝';
  return '通用 CSV';
}

function fileNameFromUri(uri: string | undefined): string {
  const value = uri?.split('/').at(-1);
  return value === undefined || value.length === 0 ? '账单.csv' : value;
}

export function StatementImportScreen() {
  const repositories = useRepositories();
  const navigation = useNavigation();
  const [review, setReview] = useState<StatementImportReview>();
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [templates, setTemplates] = useState<ImportMappingTemplate[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedFile, setSelectedFile] = useState<SelectedStatementFile>();
  const [mapping, setMapping] = useState<StatementColumnMapping>({});
  const [mappingField, setMappingField] = useState<StatementField>();
  const [templateName, setTemplateName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const loadHistory = useCallback(async () => {
    const [records, savedTemplates, visibleCategories] = await Promise.all([
      repositories.importRecords.listRecent(20),
      repositories.importMappingTemplates.list(),
      repositories.categories.listVisible(),
    ]);
    setHistory(records);
    setTemplates(savedTemplates);
    setCategories(visibleCategories);
  }, [repositories]);

  useEffect(() => {
    loadHistory().catch(() => undefined);
  }, [loadHistory]);

  const previewFile = async (
    file: SelectedStatementFile,
    selectedMapping?: StatementColumnMapping,
  ) => {
    const preview =
      file.encoding === 'BASE64'
        ? parseStatementXlsx({
            base64Content: file.content,
            fileName: file.fileName,
            mapping: selectedMapping,
          })
        : parseStatementCsv({
            content: file.content,
            fileName: file.fileName,
            mapping: selectedMapping,
          });
    setMapping(preview.mapping);
    setReview(await repositories.statementImport.analyze(preview));
  };

  const chooseFile = async () => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const selected = await openLedgerTextFile([
        'text/csv',
        'text/plain',
        'text/tab-separated-values',
        'application/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ]);
      if (selected.status === 'OPENED') {
        const fileName = selected.fileName ?? fileNameFromUri(selected.uri);
        const encoding =
          selected.encoding ?? (/\.xlsx$/iu.test(fileName) ? 'BASE64' : 'UTF8');
        const headers =
          encoding === 'BASE64'
            ? inspectStatementXlsxHeaders(selected.content)
            : inspectStatementHeaders(selected.content);
        const file: SelectedStatementFile = {
          fileName,
          encoding,
          content: selected.content,
          headers,
        };
        setSelectedFile(file);
        try {
          await previewFile(file);
        } catch {
          setReview(undefined);
          setMapping({});
          setNotice('已读取表头，请手动指定交易时间和金额列后重新预览。');
        }
      }
    } catch (openError) {
      setError(
        safeErrorMessage(
          openError,
          '无法解析所选账单。请确认它是 CSV、TSV 或 XLSX，且包含日期和金额表头。',
          'STATEMENT-IMPORT-OPEN-UNEXPECTED',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const reparse = async (nextMapping = mapping) => {
    if (selectedFile === undefined) return;
    if (
      nextMapping.occurredAt === undefined ||
      nextMapping.amount === undefined
    ) {
      setError('请先映射交易时间和金额。');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await previewFile(selectedFile, nextMapping);
      setNotice('字段映射已应用，请核对下方金额、日期和重复提示。');
    } catch (parseError) {
      setError(
        safeErrorMessage(
          parseError,
          '使用当前字段映射仍无法解析，请检查日期和金额列。',
          'STATEMENT-MAPPING-PARSE-UNEXPECTED',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    if (
      templateName.trim().length === 0 ||
      mapping.occurredAt === undefined ||
      mapping.amount === undefined
    ) {
      setError('请输入模板名称，并先完成时间与金额映射。');
      return;
    }
    const now = new Date().toISOString();
    await repositories.importMappingTemplates.save({
      id: createId('import-mapping'),
      name: templateName,
      mapping,
      createdAt: now,
      updatedAt: now,
    });
    setTemplateName('');
    await loadHistory();
    setNotice('字段映射模板已保存在本机。');
  };

  const mappingOptions: SelectionOption[] =
    selectedFile?.headers.map(header => ({ id: header, label: header })) ?? [];
  const automaticOfficialImport =
    review !== undefined && review.preview.source !== 'CSV';
  const categoryName = (candidate: ReviewedImportCandidate['candidate']) => {
    const category = categories.find(
      item =>
        item.id === (candidate.subcategoryIdHint ?? candidate.categoryIdHint),
    );
    return category?.name;
  };

  const commit = async () => {
    if (review === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await repositories.statementImport.commit(
        review,
        new Date().toISOString(),
      );
      setReview(undefined);
      setSelectedFile(undefined);
      setMapping({});
      await loadHistory();
      setNotice(
        `已将 ${result.transactionIds.length} 笔候选放入待确认；确定重复项未再次写入。`,
      );
    } catch (commitError) {
      setError(
        safeErrorMessage(
          commitError,
          '导入失败，本次账单与审计记录已整体回滚。',
          'STATEMENT-IMPORT-COMMIT-UNEXPECTED',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const undo = (record: ImportRecord) => {
    Alert.alert(
      '撤销本次导入？',
      `将删除由“${record.fileName ?? sourceLabel(record.source)}”导入的 ${record.importedCount} 笔交易，包括之后已确认的条目。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认撤销',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setError(undefined);
            try {
              const count = await repositories.statementImport.undo(
                record.id,
                new Date().toISOString(),
              );
              await loadHistory();
              setNotice(`已撤销本次导入并删除 ${count} 笔关联交易。`);
            } catch (undoError) {
              setError(
                safeErrorMessage(
                  undoError,
                  '撤销失败，账本未发生部分删除。',
                  'STATEMENT-IMPORT-UNDO-UNEXPECTED',
                ),
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <MaterialDesignIcons
            color={colors.brand}
            name="file-table-box-multiple-outline"
            size={34}
          />
          <View style={styles.flexCopy}>
            <Text accessibilityRole="header" style={styles.heroTitle}>
              先预览，再进入待确认
            </Text>
            <Text style={styles.body}>
              支持微信、支付宝官方账单，以及通用 CSV、TSV 和
              XLSX。原文件不保存，只记录哈希、数量和导入结果。
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={chooseFile}
          style={[styles.primaryButton, busy && styles.disabled]}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.primaryText}>选择账单文件</Text>
          )}
        </Pressable>

        {selectedFile === undefined || automaticOfficialImport ? null : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>字段映射</Text>
            <Text style={styles.body}>
              {selectedFile.fileName} · 已读取 {selectedFile.headers.length}{' '}
              个表头
            </Text>
            {MAPPING_FIELDS.map(item => (
              <Pressable
                accessibilityRole="button"
                key={item.field}
                onPress={() => setMappingField(item.field)}
                style={styles.mappingRow}
              >
                <Text style={styles.mappingLabel}>{item.label}</Text>
                <Text style={styles.mappingValue}>
                  {mapping[item.field] ?? '未映射'}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => reparse().catch(() => undefined)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>按当前映射重新预览</Text>
            </Pressable>
            {templates.length === 0 ? null : (
              <View style={styles.templateWrap}>
                {templates.map(template => (
                  <View key={template.id} style={styles.templateChipRow}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setMapping(template.mapping);
                        reparse(template.mapping).catch(() => undefined);
                      }}
                      style={styles.templateChip}
                    >
                      <Text style={styles.templateChipText}>
                        {template.name}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`删除映射模板${template.name}`}
                      accessibilityRole="button"
                      onPress={async () => {
                        await repositories.importMappingTemplates.delete(
                          template.id,
                        );
                        await loadHistory();
                      }}
                    >
                      <Text style={styles.templateDelete}>×</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            <View style={styles.templateSaveRow}>
              <TextInput
                accessibilityLabel="映射模板名称"
                maxLength={80}
                onChangeText={setTemplateName}
                placeholder="模板名，例如：旧账本导出"
                placeholderTextColor={colors.placeholder}
                style={styles.templateInput}
                value={templateName}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => saveTemplate().catch(() => undefined)}
                style={styles.templateSaveButton}
              >
                <Text style={styles.templateSaveText}>保存模板</Text>
              </Pressable>
            </View>
          </View>
        )}

        {review === undefined ? null : (
          <View style={styles.card}>
            <View style={styles.reviewTitleRow}>
              <Text style={styles.cardTitle}>
                {sourceLabel(review.preview.source)} · {review.preview.fileName}
              </Text>
              {review.preview.source === 'CSV' ? null : (
                <Text style={styles.detectedBadge}>已自动识别</Text>
              )}
            </View>
            <Text style={styles.body}>
              识别 {review.preview.candidates.length} 笔 · 确定重复{' '}
              {review.definiteDuplicateCount} 笔 · 疑似重复{' '}
              {review.possibleDuplicateCount} 笔 · 失败{' '}
              {review.preview.failures.length} 行
            </Text>
            <Text style={styles.mappingText}>
              字段映射：时间 ← {review.preview.mapping.occurredAt}；金额 ←{' '}
              {review.preview.mapping.amount}
            </Text>
            <View style={styles.previewList}>
              {review.rows.slice(0, 20).map(row => (
                <View key={row.candidate.sourceRow} style={styles.previewRow}>
                  <View style={styles.flexCopy}>
                    <Text numberOfLines={1} style={styles.rowTitle}>
                      {row.candidate.merchantRawName ?? '未识别商户'}
                    </Text>
                    <Text style={styles.rowMeta}>
                      第 {row.candidate.sourceRow} 行 ·{' '}
                      {row.candidate.occurredAt.slice(0, 10)}
                      {categoryName(row.candidate) === undefined
                        ? ' · 分类待确认'
                        : ` · ${categoryName(row.candidate)}`}
                    </Text>
                  </View>
                  <View style={styles.amountColumn}>
                    <Text style={styles.rowAmount}>
                      {formatAmountMinor(row.candidate.amountMinor)}
                    </Text>
                    {row.duplicateKind === 'NONE' ? null : (
                      <Text
                        style={
                          row.duplicateKind === 'DEFINITE'
                            ? styles.definiteBadge
                            : styles.possibleBadge
                        }
                      >
                        {row.duplicateKind === 'DEFINITE'
                          ? '确定重复'
                          : '疑似重复'}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
            {review.rows.length > 20 ? (
              <Text style={styles.body}>
                仅展示前 20 笔，提交时会处理全部候选。
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={commit}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryText}>导入到待确认</Text>
            </Pressable>
          </View>
        )}

        {notice === undefined ? null : (
          <View style={styles.notice}>
            <Text accessibilityRole="alert" style={styles.noticeText}>
              {notice}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Pending')}
            >
              <Text style={styles.noticeAction}>去批量审核</Text>
            </Pressable>
          </View>
        )}
        {error === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}

        <Text style={styles.sectionLabel}>最近导入</Text>
        {history.length === 0 ? (
          <Text style={styles.empty}>还没有导入记录。</Text>
        ) : (
          history.map(record => (
            <View key={record.id} style={styles.historyRow}>
              <View style={styles.flexCopy}>
                <Text style={styles.rowTitle}>
                  {record.fileName ?? sourceLabel(record.source)}
                </Text>
                <Text style={styles.rowMeta}>
                  {sourceLabel(record.source)} · 已导入 {record.importedCount} ·
                  重复 {record.duplicateCount} · 失败 {record.failedCount}
                </Text>
              </View>
              {record.undoneAt === undefined && record.importedCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => undo(record)}
                >
                  <Text style={styles.undoText}>撤销</Text>
                </Pressable>
              ) : (
                <Text style={styles.undoneText}>已撤销</Text>
              )}
            </View>
          ))
        )}
      </ScrollView>
      <SelectionModal
        onChange={ids => {
          const header = ids[0];
          if (mappingField !== undefined && header !== undefined) {
            setMapping(current => ({ ...current, [mappingField]: header }));
          }
          setMappingField(undefined);
        }}
        onClose={() => setMappingField(undefined)}
        options={mappingOptions}
        selectedIds={
          mappingField === undefined || mapping[mappingField] === undefined
            ? []
            : [mapping[mappingField]!]
        }
        title="选择文件列"
        visible={mappingField !== undefined}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  hero: {
    flexDirection: 'row',
    gap: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.brandSoft,
    padding: spacing.lg,
  },
  flexCopy: { minWidth: 0, flex: 1, gap: 4 },
  heroTitle: {
    color: colors.ink,
    fontSize: typography.title,
    fontWeight: '900',
  },
  body: { color: colors.inkSecondary, fontSize: 13, lineHeight: 20 },
  primaryButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: colors.white, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  card: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    ...shadows.card,
  },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  reviewTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  detectedBadge: {
    borderRadius: 999,
    backgroundColor: colors.brandSoft,
    color: colors.brand,
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  mappingText: {
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 18,
    padding: spacing.sm,
  },
  mappingRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  mappingLabel: { color: colors.inkSecondary, fontSize: 13 },
  mappingValue: { color: colors.brand, fontSize: 13, fontWeight: '800' },
  secondaryButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.md,
  },
  secondaryButtonText: { color: colors.brand, fontWeight: '900' },
  templateWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  templateChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: colors.brandSoft,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
  },
  templateChip: { paddingVertical: spacing.xs },
  templateChipText: { color: colors.brand, fontSize: 12, fontWeight: '800' },
  templateDelete: {
    color: colors.inkMuted,
    fontSize: 20,
    paddingHorizontal: 5,
  },
  templateSaveRow: { flexDirection: 'row', gap: spacing.xs },
  templateInput: {
    minHeight: 44,
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    color: colors.ink,
    paddingHorizontal: spacing.sm,
  },
  templateSaveButton: {
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.sm,
  },
  templateSaveText: { color: colors.white, fontSize: 12, fontWeight: '900' },
  previewList: { gap: 2 },
  previewRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
  },
  rowTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  rowMeta: { color: colors.inkMuted, fontSize: 11, lineHeight: 17 },
  amountColumn: { alignItems: 'flex-end', gap: 3 },
  rowAmount: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  definiteBadge: { color: colors.expenseText, fontSize: 10, fontWeight: '800' },
  possibleBadge: { color: colors.warningText, fontSize: 10, fontWeight: '800' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.incomeSoft,
    padding: spacing.md,
  },
  noticeText: {
    minWidth: 0,
    flex: 1,
    color: colors.incomeText,
    lineHeight: 20,
  },
  noticeAction: { color: colors.brand, fontWeight: '900' },
  error: {
    borderRadius: radius.md,
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    lineHeight: 20,
    padding: spacing.md,
  },
  sectionLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: '900' },
  empty: { color: colors.inkMuted, textAlign: 'center', padding: spacing.lg },
  historyRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  undoText: { color: colors.expenseText, fontWeight: '900' },
  undoneText: { color: colors.inkMuted, fontWeight: '700' },
});
