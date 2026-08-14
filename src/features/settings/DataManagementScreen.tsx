import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons/static';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import releaseIdentity from '../../../config/release-identity.json';
import { useRepositories } from '../../app/DatabaseProvider';
import { usePrivacySettings } from '../../app/PrivacyGate';
import type {
  LedgerDataSummary,
  LedgerMaintenanceRepository,
} from '../../database';
import { safeErrorMessage } from '../../domain/errors/AppError';
import { createLedgerCsv } from '../../domain/services/ledgerCsv';
import {
  decryptLedgerBackup,
  encryptLedgerBackup,
} from '../../native/LedgerBackupCrypto';
import {
  openLedgerTextFile,
  saveLedgerTextFile,
} from '../../native/LedgerFilePortal';
import { clearPaymentNotifications } from '../../native/PaymentNotificationCapture';
import {
  colors,
  radius,
  shadows,
  spacing,
  typography,
} from '../../theme/tokens';

export const DELETE_ALL_CONFIRMATION_PHRASE = '删除全部数据';

const EMPTY_SUMMARY: LedgerDataSummary = {
  confirmedCount: 0,
  pendingCount: 0,
  recycleBinCount: 0,
  projectCount: 0,
  tagCount: 0,
  merchantCount: 0,
  budgetCount: 0,
  ruleCount: 0,
  feedbackCount: 0,
  importRecordCount: 0,
  recurringTemplateCount: 0,
  importMappingTemplateCount: 0,
  productValueEventCount: 0,
};

type DataManagementScreenProps = {
  maintenanceRepository?: LedgerMaintenanceRepository;
};

type SummaryRowProps = {
  label: string;
  value: number;
};

function SummaryRow({ label, value }: SummaryRowProps) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

export function totalLedgerItems(summary: LedgerDataSummary): number {
  return Object.values(summary).reduce((total, value) => total + value, 0);
}

export function DataManagementScreen({
  maintenanceRepository,
}: DataManagementScreenProps) {
  const repositories = useRepositories();
  const privacy = usePrivacySettings();
  const repository = maintenanceRepository ?? repositories.ledgerMaintenance;
  const [summary, setSummary] = useState<LedgerDataSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [includeOriginalText, setIncludeOriginalText] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMode, setBackupMode] = useState<'CREATE' | 'RESTORE'>();
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupPassphraseConfirmation, setBackupPassphraseConfirmation] =
    useState('');
  const [encryptedBackup, setEncryptedBackup] = useState<string>();
  const [confirmation, setConfirmation] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setSummary(await repository.getDataSummary());
    } catch (loadError) {
      setError(
        safeErrorMessage(
          loadError,
          '读取账本数据概览失败。',
          'DATA-MANAGEMENT-SUMMARY-UNEXPECTED',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    loadSummary().catch(() => undefined);
  }, [loadSummary]);

  const total = useMemo(() => totalLedgerItems(summary), [summary]);
  const canDelete =
    confirmation === DELETE_ALL_CONFIRMATION_PHRASE && !deleting;

  const openDeleteConfirmation = () => {
    setConfirmation('');
    setNotice(undefined);
    setError(undefined);
    setModalVisible(true);
  };

  const exportCsv = async () => {
    setExporting(true);
    setNotice(undefined);
    setError(undefined);
    try {
      const rows = await repositories.ledgerExport.listTransactionsForExport({
        includeDeleted,
        includeOriginalText,
      });
      const timestamp = new Date()
        .toISOString()
        .replaceAll(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');
      const result = await saveLedgerTextFile({
        suggestedFileName: `qingji-ledger-${timestamp}.csv`,
        mimeType: 'text/csv',
        content: createLedgerCsv(rows),
      });

      if (result.status === 'SAVED') {
        setNotice(
          `已导出 ${rows.length} 笔交易。请妥善保管包含财务信息的文件。`,
        );
      }
    } catch (exportError) {
      setError(
        safeErrorMessage(
          exportError,
          '导出失败，账本数据没有发生变化。',
          'DATA-MANAGEMENT-EXPORT-UNEXPECTED',
        ),
      );
    } finally {
      setExporting(false);
    }
  };

  const closeBackupModal = () => {
    if (backupBusy) return;
    setBackupMode(undefined);
    setBackupPassphrase('');
    setBackupPassphraseConfirmation('');
    setEncryptedBackup(undefined);
  };

  const beginBackup = () => {
    setError(undefined);
    setNotice(undefined);
    setBackupPassphrase('');
    setBackupPassphraseConfirmation('');
    setBackupMode('CREATE');
  };

  const beginRestore = async () => {
    setBackupBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const selected = await openLedgerTextFile([
        'application/json',
        'application/octet-stream',
        'text/plain',
      ]);
      if (selected.status === 'OPENED') {
        setEncryptedBackup(selected.content);
        setBackupPassphrase('');
        setBackupMode('RESTORE');
      }
    } catch (openError) {
      setError(
        safeErrorMessage(
          openError,
          '无法读取所选备份文件，原账本没有变化。',
          'DATA-MANAGEMENT-BACKUP-OPEN-UNEXPECTED',
        ),
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const submitBackupAction = async () => {
    if (backupMode === undefined || backupPassphrase.length < 8) return;
    if (
      backupMode === 'CREATE' &&
      backupPassphrase !== backupPassphraseConfirmation
    ) {
      setError('两次输入的备份口令不一致。');
      return;
    }

    setBackupBusy(true);
    setError(undefined);
    try {
      if (backupMode === 'CREATE') {
        const createdAt = new Date().toISOString();
        const plaintext = await repositories.ledgerBackup.createBackupDocument(
          createdAt,
          releaseIdentity.marketingVersion,
        );
        const encrypted = await encryptLedgerBackup(
          plaintext,
          backupPassphrase,
        );
        const timestamp = createdAt
          .replaceAll(/[-:]/g, '')
          .replace(/\.\d{3}Z$/, 'Z');
        const result = await saveLedgerTextFile({
          suggestedFileName: `qingji-backup-${timestamp}.qjb`,
          mimeType: 'application/json',
          content: encrypted,
        });
        if (result.status === 'SAVED') {
          await privacy.updateSettings({ lastBackupAt: createdAt });
          setNotice(
            '加密备份已保存。轻记 AI 不保存口令，请将口令与备份文件分开保管。',
          );
        }
      } else {
        if (encryptedBackup === undefined) {
          throw new Error('Selected encrypted backup is missing.');
        }
        const plaintext = await decryptLedgerBackup(
          encryptedBackup,
          backupPassphrase,
        );
        const restored = await repositories.ledgerBackup.restoreBackupDocument(
          plaintext,
          new Date().toISOString(),
        );
        await privacy.reloadSettings();
        setSummary(await repository.getDataSummary());
        setNotice(
          `已原子恢复 ${restored.rowCount} 个数据项。请返回首页复核账本。`,
        );
      }
      setBackupMode(undefined);
      setEncryptedBackup(undefined);
    } catch (backupError) {
      setError(
        safeErrorMessage(
          backupError,
          backupMode === 'CREATE'
            ? '创建加密备份失败，账本数据没有变化。'
            : '恢复失败：口令错误、文件损坏或版本不兼容。原账本没有变化。',
          'DATA-MANAGEMENT-BACKUP-UNEXPECTED',
        ),
      );
    } finally {
      setBackupBusy(false);
      setBackupPassphrase('');
      setBackupPassphraseConfirmation('');
    }
  };

  const closeDeleteConfirmation = () => {
    if (!deleting) {
      setModalVisible(false);
      setConfirmation('');
    }
  };

  const deleteAllData = async () => {
    if (!canDelete) {
      return;
    }

    setDeleting(true);
    setError(undefined);
    try {
      await repository.deleteAllUserData(new Date().toISOString());
      clearPaymentNotifications();
      await privacy.reloadSettings();
      setSummary(await repository.getDataSummary());
      setModalVisible(false);
      setConfirmation('');
      setNotice('本机账本数据已全部删除，系统分类和默认账户已恢复可用。');
    } catch (deleteError) {
      setError(
        safeErrorMessage(
          deleteError,
          '删除失败，原账本未发生部分删除，请重试。',
          'DATA-MANAGEMENT-DELETE-UNEXPECTED',
        ),
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <MaterialDesignIcons
              color={colors.brand}
              name="database-lock-outline"
              size={30}
            />
          </View>
          <View style={styles.heroCopy}>
            <Text accessibilityRole="header" style={styles.heroTitle}>
              你的数据留在本机
            </Text>
            <Text style={styles.heroText}>
              删除操作在一个数据库事务中完成。任一步失败都会整体回滚，不会留下半个账本。
            </Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>账本数据概览</Text>
        <View style={styles.card}>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.brand} />
              <Text style={styles.loadingText}>正在核对本机数据…</Text>
            </View>
          ) : (
            <>
              <SummaryRow label="已确认交易" value={summary.confirmedCount} />
              <SummaryRow label="待确认交易" value={summary.pendingCount} />
              <SummaryRow label="回收站交易" value={summary.recycleBinCount} />
              <SummaryRow
                label="项目、标签与商户"
                value={
                  summary.projectCount +
                  summary.tagCount +
                  summary.merchantCount
                }
              />
              <SummaryRow label="预算" value={summary.budgetCount} />
              <SummaryRow
                label="规则与学习反馈"
                value={summary.ruleCount + summary.feedbackCount}
              />
              <SummaryRow label="导入记录" value={summary.importRecordCount} />
              <SummaryRow
                label="周期记账模板"
                value={summary.recurringTemplateCount}
              />
              <SummaryRow
                label="导入映射模板"
                value={summary.importMappingTemplateCount}
              />
              <SummaryRow
                label="本地产品效果记录"
                value={summary.productValueEventCount}
              />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>合计数据项</Text>
                <Text style={styles.totalValue}>{total}</Text>
              </View>
            </>
          )}
        </View>

        <Text style={styles.sectionLabel}>可读导出</Text>
        <View style={styles.cardWithGap}>
          <View style={styles.exportHeader}>
            <MaterialDesignIcons
              color={colors.brand}
              name="file-delimited-outline"
              size={28}
            />
            <View style={styles.heroCopy}>
              <Text style={styles.exportTitle}>导出 CSV</Text>
              <Text style={styles.heroText}>
                通过系统文件面板保存 UTF-8 表格，可用于 Excel
                或其他账本迁移。导出文件不会自动回传本应用。
              </Text>
            </View>
          </View>
          <View style={styles.optionRow}>
            <View style={styles.optionCopy}>
              <Text style={styles.optionTitle}>包含回收站</Text>
              <Text style={styles.optionDescription}>
                同时导出已软删除的交易
              </Text>
            </View>
            <Switch
              accessibilityLabel="导出包含回收站"
              disabled={exporting}
              onValueChange={setIncludeDeleted}
              value={includeDeleted}
            />
          </View>
          <View style={styles.optionRow}>
            <View style={styles.optionCopy}>
              <Text style={styles.optionTitle}>包含原始文字</Text>
              <Text style={styles.optionDescription}>
                可能包含语音转写或输入句子，默认关闭
              </Text>
            </View>
            <Switch
              accessibilityLabel="导出包含原始文字"
              disabled={exporting}
              onValueChange={setIncludeOriginalText}
              value={includeOriginalText}
            />
          </View>
          <Text style={styles.plainTextWarning}>
            CSV
            是明文文件。若账本包含敏感信息，请保存到可信位置；需要完整迁移时应优先使用后续提供的加密备份。
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={exporting || loading}
            onPress={exportCsv}
            style={[
              styles.exportButton,
              (exporting || loading) && styles.buttonDisabled,
            ]}
          >
            {exporting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.exportButtonText}>选择位置并导出</Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>加密备份与恢复</Text>
        <View style={styles.cardWithGap}>
          <View style={styles.exportHeader}>
            <MaterialDesignIcons
              color={colors.brand}
              name="shield-key-outline"
              size={28}
            />
            <View style={styles.heroCopy}>
              <Text style={styles.exportTitle}>完整账本备份</Text>
              <Text style={styles.heroText}>
                包含交易、分类、账户、规则和设置。使用口令派生的 AES-256-GCM
                密钥加密，并在恢复前验证完整性。
              </Text>
            </View>
          </View>
          <Text style={styles.plainTextWarning}>
            忘记口令后无法恢复，开发者也无法找回。恢复会完整替换当前账本，失败时自动回滚。
          </Text>
          <View style={styles.modalActions}>
            <Pressable
              accessibilityRole="button"
              disabled={backupBusy}
              onPress={beginBackup}
              style={[styles.exportButton, styles.flexButton]}
            >
              <Text style={styles.exportButtonText}>创建备份</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={backupBusy}
              onPress={beginRestore}
              style={[styles.cancelButton, styles.flexButton]}
            >
              <Text style={styles.cancelButtonText}>从备份恢复</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionLabel}>危险操作</Text>
        <View style={styles.dangerCard}>
          <View style={styles.dangerHeader}>
            <MaterialDesignIcons
              color={colors.expenseText}
              name="delete-alert-outline"
              size={28}
            />
            <View style={styles.dangerCopy}>
              <Text style={styles.dangerTitle}>删除全部数据</Text>
              <Text style={styles.dangerText}>
                删除交易、回收站、待确认、预算、项目、标签、商户、规则、学习反馈和导入记录，并重置个性化设置。
              </Text>
            </View>
          </View>
          <Text style={styles.externalFileNotice}>
            已保存到系统文件夹的导出或备份不受影响，需要你在文件管理器中主动删除。
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={loading || deleting}
            onPress={openDeleteConfirmation}
            style={({ pressed }) => [
              styles.deleteButton,
              pressed && styles.deleteButtonPressed,
              (loading || deleting) && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.deleteButtonText}>删除本机全部账本数据</Text>
          </Pressable>
        </View>

        {notice === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.successNotice}>
            {notice}
          </Text>
        )}
        {error === undefined ? null : (
          <View style={styles.errorCard}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
            <Pressable accessibilityRole="button" onPress={loadSummary}>
              <Text style={styles.retryText}>重新核对</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <Modal
        animationType="fade"
        onRequestClose={closeDeleteConfirmation}
        transparent
        visible={modalVisible}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text accessibilityRole="header" style={styles.modalTitle}>
              此操作无法在 App 内撤销
            </Text>
            <Text style={styles.modalText}>
              将删除当前列出的全部数据。继续前请确认已保存需要的备份。
            </Text>
            <Text style={styles.confirmationLabel}>
              输入“{DELETE_ALL_CONFIRMATION_PHRASE}”以继续
            </Text>
            <TextInput
              accessibilityLabel="删除全部数据确认短语"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!deleting}
              onChangeText={setConfirmation}
              placeholder={DELETE_ALL_CONFIRMATION_PHRASE}
              placeholderTextColor={colors.inkMuted}
              style={styles.confirmationInput}
              value={confirmation}
            />
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={deleting}
                onPress={closeDeleteConfirmation}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelButtonText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!canDelete}
                onPress={deleteAllData}
                style={[
                  styles.confirmDeleteButton,
                  !canDelete && styles.buttonDisabled,
                ]}
              >
                {deleting ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.confirmDeleteText}>永久删除</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={closeBackupModal}
        transparent
        visible={backupMode !== undefined}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text accessibilityRole="header" style={styles.modalTitleNeutral}>
              {backupMode === 'CREATE' ? '设置备份口令' : '解密并恢复账本'}
            </Text>
            <Text style={styles.modalText}>
              {backupMode === 'CREATE'
                ? '至少 8 个字符。此口令不会被保存或上传。'
                : '恢复将替换当前账本。只有解密、校验和数据库验证全部通过后才会提交。'}
            </Text>
            <TextInput
              accessibilityLabel="备份口令"
              editable={!backupBusy}
              onChangeText={setBackupPassphrase}
              placeholder="输入备份口令"
              placeholderTextColor={colors.inkMuted}
              secureTextEntry
              style={styles.confirmationInput}
              value={backupPassphrase}
            />
            {backupMode === 'CREATE' ? (
              <TextInput
                accessibilityLabel="再次输入备份口令"
                editable={!backupBusy}
                onChangeText={setBackupPassphraseConfirmation}
                placeholder="再次输入备份口令"
                placeholderTextColor={colors.inkMuted}
                secureTextEntry
                style={styles.confirmationInput}
                value={backupPassphraseConfirmation}
              />
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={backupBusy}
                onPress={closeBackupModal}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelButtonText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={backupBusy || backupPassphrase.length < 8}
                onPress={submitBackupAction}
                style={[
                  styles.exportButton,
                  styles.flexButton,
                  (backupBusy || backupPassphrase.length < 8) &&
                    styles.buttonDisabled,
                ]}
              >
                {backupBusy ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.exportButtonText}>
                    {backupMode === 'CREATE' ? '加密并保存' : '确认恢复'}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  heroCard: {
    flexDirection: 'row',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    ...shadows.card,
  },
  heroIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
  },
  heroCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  heroTitle: {
    color: colors.ink,
    fontSize: typography.title,
    fontWeight: '900',
  },
  heroText: { color: colors.inkSecondary, fontSize: 13, lineHeight: 20 },
  sectionLabel: {
    marginTop: spacing.sm,
    marginLeft: spacing.xxs,
    color: colors.inkMuted,
    fontSize: typography.caption,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    ...shadows.card,
  },
  cardWithGap: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    ...shadows.card,
  },
  exportHeader: { flexDirection: 'row', gap: spacing.sm },
  exportTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  optionRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  optionCopy: { minWidth: 0, flex: 1, gap: 3 },
  optionTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  optionDescription: { color: colors.inkMuted, fontSize: 12, lineHeight: 18 },
  plainTextWarning: {
    borderRadius: radius.sm,
    backgroundColor: colors.warningSoft,
    color: colors.warningText,
    fontSize: 12,
    lineHeight: 18,
    padding: spacing.sm,
  },
  exportButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  exportButtonText: { color: colors.white, fontWeight: '900' },
  flexButton: { flex: 1 },
  loadingRow: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: { color: colors.inkSecondary },
  summaryRow: {
    minHeight: 47,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryLabel: { color: colors.inkSecondary, fontSize: 14 },
  summaryValue: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  totalRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalLabel: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  totalValue: { color: colors.brand, fontSize: 20, fontWeight: '900' },
  dangerCard: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.expenseText,
    borderRadius: radius.lg,
    backgroundColor: colors.expenseSoft,
    padding: spacing.lg,
  },
  dangerHeader: { flexDirection: 'row', gap: spacing.sm },
  dangerCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  dangerTitle: {
    color: colors.expenseText,
    fontSize: 17,
    fontWeight: '900',
  },
  dangerText: { color: colors.inkSecondary, fontSize: 13, lineHeight: 20 },
  externalFileNotice: {
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 18,
    padding: spacing.sm,
  },
  deleteButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.expenseText,
    paddingHorizontal: spacing.md,
  },
  deleteButtonPressed: { opacity: 0.86 },
  deleteButtonText: { color: colors.white, fontWeight: '900' },
  buttonDisabled: { opacity: 0.4 },
  successNotice: {
    borderRadius: radius.md,
    backgroundColor: colors.incomeSoft,
    color: colors.incomeText,
    lineHeight: 21,
    padding: spacing.md,
  },
  errorCard: {
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.expenseSoft,
    padding: spacing.md,
  },
  errorText: { color: colors.expenseText, lineHeight: 20 },
  retryText: { color: colors.brand, fontWeight: '800' },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    gap: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    ...shadows.card,
  },
  modalTitle: {
    color: colors.expenseText,
    fontSize: typography.title,
    fontWeight: '900',
  },
  modalTitleNeutral: {
    color: colors.ink,
    fontSize: typography.title,
    fontWeight: '900',
  },
  modalText: { color: colors.inkSecondary, lineHeight: 21 },
  confirmationLabel: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  confirmationInput: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    color: colors.ink,
    paddingHorizontal: spacing.md,
  },
  modalActions: { flexDirection: 'row', gap: spacing.sm },
  cancelButton: {
    minHeight: 48,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
  },
  cancelButtonText: { color: colors.inkSecondary, fontWeight: '800' },
  confirmDeleteButton: {
    minHeight: 48,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.expenseText,
  },
  confirmDeleteText: { color: colors.white, fontWeight: '900' },
});
