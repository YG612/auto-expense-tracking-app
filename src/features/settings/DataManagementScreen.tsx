import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons/static';
import { useState } from 'react';
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
import { parseLedgerBackupDocument } from '../../database';
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
import {
  authenticatePrivacyProtection,
  getPrivacyProtectionCapabilities,
} from '../../native/PrivacyProtection';
import { purgeTransientSensitiveData } from '../../native/SensitiveDataPurge';
import {
  colors,
  radius,
  shadows,
  spacing,
  typography,
} from '../../theme/tokens';

export const DATA_ERASURE_CONFIRMATION_TEXT = '删除全部数据';

export function DataManagementScreen() {
  const repositories = useRepositories();
  const privacy = usePrivacySettings();
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [includeOriginalText, setIncludeOriginalText] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMode, setBackupMode] = useState<'CREATE' | 'RESTORE'>();
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirmation, setPassphraseConfirmation] = useState('');
  const [encryptedBackup, setEncryptedBackup] = useState<string>();
  const [eraseModalVisible, setEraseModalVisible] = useState(false);
  const [eraseConfirmation, setEraseConfirmation] = useState('');
  const [eraseBusy, setEraseBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

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
        setNotice(`已导出 ${rows.length} 笔交易。CSV 是明文，请妥善保管。`);
      }
    } catch (caught) {
      setError(
        safeErrorMessage(
          caught,
          '导出失败，账本数据没有变化。',
          'DATA-EXPORT-UNEXPECTED',
        ),
      );
    } finally {
      setExporting(false);
    }
  };

  const beginCreate = () => {
    setError(undefined);
    setNotice(undefined);
    setPassphrase('');
    setPassphraseConfirmation('');
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
        setPassphrase('');
        setBackupMode('RESTORE');
      }
    } catch (caught) {
      setError(
        safeErrorMessage(
          caught,
          '无法读取所选备份文件。',
          'BACKUP-OPEN-UNEXPECTED',
        ),
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const closeModal = () => {
    if (backupBusy) return;
    setBackupMode(undefined);
    setPassphrase('');
    setPassphraseConfirmation('');
    setEncryptedBackup(undefined);
  };

  const submitBackup = async () => {
    if (backupMode === undefined || passphrase.length < 8) return;
    if (backupMode === 'CREATE' && passphrase !== passphraseConfirmation) {
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
        const encrypted = await encryptLedgerBackup(plaintext, passphrase);
        const timestamp = createdAt
          .replaceAll(/[-:]/g, '')
          .replace(/\.\d{3}Z$/, 'Z');
        const result = await saveLedgerTextFile({
          suggestedFileName: `qingji-backup-${timestamp}.qjb`,
          mimeType: 'application/json',
          content: encrypted,
        });
        if (result.status === 'SAVED') {
          setNotice(
            '加密备份已保存。口令不会被保存或上传，请与备份文件分开保管。',
          );
        }
      } else {
        if (encryptedBackup === undefined)
          throw new Error('Selected encrypted backup is missing.');
        const plaintext = await decryptLedgerBackup(
          encryptedBackup,
          passphrase,
        );
        // Validate before clearing device-local queues so a wrong password or
        // malformed backup cannot discard pending input as a side effect.
        parseLedgerBackupDocument(plaintext);
        await purgeTransientSensitiveData();
        const restored = await repositories.ledgerBackup.restoreBackupDocument(
          plaintext,
          new Date().toISOString(),
        );
        setNotice(
          `已原子恢复 ${restored.rowCount} 个数据项，请返回首页复核账本。`,
        );
      }
      setBackupMode(undefined);
      setEncryptedBackup(undefined);
    } catch (caught) {
      setError(
        safeErrorMessage(
          caught,
          backupMode === 'CREATE'
            ? '创建加密备份失败，账本数据没有变化。'
            : '恢复失败：口令错误、文件损坏或版本不兼容。数据库恢复事务没有部分提交；通知、Agent 或分享临时缓存可能已被清理。',
          'BACKUP-ACTION-UNEXPECTED',
        ),
      );
    } finally {
      setBackupBusy(false);
      setPassphrase('');
      setPassphraseConfirmation('');
    }
  };

  const beginErase = () => {
    setError(undefined);
    setNotice(undefined);
    setEraseConfirmation('');
    setEraseModalVisible(true);
  };

  const closeEraseModal = () => {
    if (eraseBusy) return;
    setEraseConfirmation('');
    setEraseModalVisible(false);
  };

  const submitErase = async () => {
    if (
      eraseBusy ||
      eraseConfirmation.trim() !== DATA_ERASURE_CONFIRMATION_TEXT
    ) {
      return;
    }
    setEraseBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const capabilities = await getPrivacyProtectionCapabilities();
      if (!capabilities.available) {
        throw new Error('设备未配置可用的系统身份验证，不能删除全部数据。');
      }
      const authentication = await authenticatePrivacyProtection(
        '验证身份以删除轻记 AI 的全部本机数据',
      );
      if (authentication.status !== 'AUTHENTICATED') return;

      await purgeTransientSensitiveData();
      const result = await repositories.dataErasure.eraseAllUserData(
        new Date().toISOString(),
      );
      setEraseModalVisible(false);
      setEraseConfirmation('');
      setNotice(
        `已删除 ${result.deletedRows} 条用户数据，清理原生临时缓存并完成空表验证。`,
      );
      await privacy.reloadSettings();
    } catch (caught) {
      setError(
        safeErrorMessage(
          caught,
          '删除未完成。数据库删除事务没有部分提交；通知、Agent 或分享临时缓存可能已被清理，请重试。',
          'DATA-ERASURE-UNEXPECTED',
        ),
      );
    } finally {
      setEraseBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.icon}>
            <MaterialDesignIcons
              color={colors.brand}
              name="database-lock-outline"
              size={30}
            />
          </View>
          <View style={styles.copy}>
            <Text accessibilityRole="header" style={styles.heroTitle}>
              导出与备份
            </Text>
            <Text style={styles.description}>
              所有处理均在本机完成。加密备份恢复只有在解密、校验和数据库验证全部通过后才会提交。
            </Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>可读导出</Text>
        <View style={styles.card}>
          <Text style={styles.title}>导出 CSV</Text>
          <Text style={styles.description}>
            通过系统文件面板保存 UTF-8 表格，可用于 Excel 或迁移到其他账本。
          </Text>
          <View style={styles.optionRow}>
            <View style={styles.copy}>
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
            <View style={styles.copy}>
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
          <Text style={styles.warning}>
            CSV 是明文文件。若账本包含敏感信息，请保存到可信位置。
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={exporting}
            onPress={exportCsv}
            style={[styles.primaryButton, exporting && styles.disabled]}
          >
            {exporting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.primaryText}>选择位置并导出</Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>隐私清理</Text>
        <View style={[styles.card, styles.dangerCard]}>
          <Text style={styles.title}>删除全部本机数据</Text>
          <Text style={styles.description}>
            删除交易、待确认、回收站、标签、规则、预算、周期账、导入记录、通知/OCR
            记录、Agent/语音幂等回执、原生临时事件箱、模型观察和全部设置。系统分类与空白默认账户会保留，以便应用重新初始化。
          </Text>
          <Text style={styles.dangerWarning}>
            此操作不可撤销。建议先创建加密备份；执行时必须通过系统身份验证并输入确认语句。
          </Text>
          <Pressable
            accessibilityLabel="开始删除全部本机数据"
            accessibilityRole="button"
            disabled={eraseBusy || backupBusy || exporting}
            onPress={beginErase}
            style={styles.dangerButton}
          >
            <Text style={styles.dangerButtonText}>删除全部本机数据</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>完整迁移</Text>
        <View style={styles.card}>
          <Text style={styles.title}>加密备份与恢复</Text>
          <Text style={styles.description}>
            完整备份交易、分类、账户、规则和设置，使用口令派生的 AES-256-GCM
            密钥加密。
          </Text>
          <Text style={styles.warning}>
            忘记口令后无法恢复。恢复会替换备份内包含的当前账本数据，失败时整体回滚。
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={backupBusy}
              onPress={beginCreate}
              style={[styles.primaryButton, styles.flex]}
            >
              <Text style={styles.primaryText}>创建备份</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={backupBusy}
              onPress={beginRestore}
              style={[styles.secondaryButton, styles.flex]}
            >
              <Text style={styles.secondaryText}>从备份恢复</Text>
            </Pressable>
          </View>
        </View>

        {notice === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.notice}>
            {notice}
          </Text>
        )}
        {error === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </ScrollView>

      <Modal
        animationType="fade"
        onRequestClose={closeModal}
        transparent
        visible={backupMode !== undefined}
      >
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            <Text accessibilityRole="header" style={styles.modalTitle}>
              {backupMode === 'CREATE' ? '设置备份口令' : '解密并恢复账本'}
            </Text>
            <Text style={styles.description}>
              {backupMode === 'CREATE'
                ? '至少 8 个字符。口令不会被保存或上传。'
                : '确认后将先解密并验证完整性，再在一个事务中恢复。'}
            </Text>
            <TextInput
              accessibilityLabel="备份口令"
              editable={!backupBusy}
              onChangeText={setPassphrase}
              placeholder="输入备份口令"
              placeholderTextColor={colors.inkMuted}
              secureTextEntry
              style={styles.input}
              value={passphrase}
            />
            {backupMode === 'CREATE' ? (
              <TextInput
                accessibilityLabel="再次输入备份口令"
                editable={!backupBusy}
                onChangeText={setPassphraseConfirmation}
                placeholder="再次输入备份口令"
                placeholderTextColor={colors.inkMuted}
                secureTextEntry
                style={styles.input}
                value={passphraseConfirmation}
              />
            ) : null}
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                disabled={backupBusy}
                onPress={closeModal}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={backupBusy || passphrase.length < 8}
                onPress={submitBackup}
                style={[
                  styles.primaryButton,
                  styles.flex,
                  (backupBusy || passphrase.length < 8) && styles.disabled,
                ]}
              >
                {backupBusy ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.primaryText}>
                    {backupMode === 'CREATE' ? '加密并保存' : '确认恢复'}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={closeEraseModal}
        transparent
        visible={eraseModalVisible}
      >
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            <Text accessibilityRole="header" style={styles.modalTitle}>
              最后确认删除
            </Text>
            <Text style={styles.dangerWarning}>
              请输入“{DATA_ERASURE_CONFIRMATION_TEXT}
              ”。随后系统会要求验证设备密码或生物识别；验证通过后才会开始原子删除。
            </Text>
            <TextInput
              accessibilityLabel="删除全部数据确认语句"
              autoCapitalize="none"
              editable={!eraseBusy}
              onChangeText={setEraseConfirmation}
              placeholder={DATA_ERASURE_CONFIRMATION_TEXT}
              placeholderTextColor={colors.inkMuted}
              style={styles.input}
              value={eraseConfirmation}
            />
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                disabled={eraseBusy}
                onPress={closeEraseModal}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={
                  eraseBusy ||
                  eraseConfirmation.trim() !== DATA_ERASURE_CONFIRMATION_TEXT
                }
                onPress={submitErase}
                style={[
                  styles.dangerButton,
                  styles.flex,
                  (eraseBusy ||
                    eraseConfirmation.trim() !==
                      DATA_ERASURE_CONFIRMATION_TEXT) &&
                    styles.disabled,
                ]}
              >
                {eraseBusy ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.dangerButtonText}>验证身份并删除</Text>
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
  hero: {
    flexDirection: 'row',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    ...shadows.card,
  },
  icon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
  },
  copy: { minWidth: 0, flex: 1, gap: spacing.xs },
  heroTitle: {
    color: colors.ink,
    fontSize: typography.title,
    fontWeight: '900',
  },
  sectionLabel: {
    marginTop: spacing.sm,
    marginLeft: spacing.xxs,
    color: colors.inkMuted,
    fontSize: typography.caption,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  card: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    ...shadows.card,
  },
  title: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  description: { color: colors.inkSecondary, fontSize: 13, lineHeight: 20 },
  optionRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  optionTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  optionDescription: { color: colors.inkMuted, fontSize: 12, lineHeight: 18 },
  warning: {
    borderRadius: radius.sm,
    backgroundColor: colors.warningSoft,
    color: colors.warningText,
    fontSize: 12,
    lineHeight: 18,
    padding: spacing.sm,
  },
  dangerCard: { borderColor: colors.expenseText },
  dangerWarning: {
    borderRadius: radius.sm,
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    fontSize: 12,
    lineHeight: 18,
    padding: spacing.sm,
  },
  dangerButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.expenseText,
    paddingHorizontal: spacing.md,
  },
  dangerButtonText: { color: colors.white, fontWeight: '900' },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
  },
  primaryText: { color: colors.white, fontWeight: '900' },
  secondaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  secondaryText: { color: colors.inkSecondary, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  disabled: { opacity: 0.4 },
  notice: {
    borderRadius: radius.md,
    backgroundColor: colors.incomeSoft,
    color: colors.incomeText,
    lineHeight: 21,
    padding: spacing.md,
  },
  error: {
    borderRadius: radius.md,
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    lineHeight: 20,
    padding: spacing.md,
  },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
    padding: spacing.lg,
  },
  modal: {
    width: '100%',
    maxWidth: 440,
    gap: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    ...shadows.card,
  },
  modalTitle: {
    color: colors.ink,
    fontSize: typography.title,
    fontWeight: '900',
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    color: colors.ink,
    paddingHorizontal: spacing.md,
  },
});
