import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons/static';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRepositories } from '../../app/DatabaseProvider';
import { usePrivacySettings } from '../../app/PrivacyGate';
import { safeErrorMessage } from '../../domain/errors/AppError';
import type { PrivacyLockTimeoutSeconds } from '../../domain/entities';
import { parsePaymentNotifications } from '../../importers/paymentNotification';
import {
  acknowledgePaymentNotifications,
  getPaymentNotificationCaptureStatus,
  listPendingPaymentNotifications,
  openPaymentNotificationSettings,
  type PaymentNotificationCaptureStatus,
} from '../../native/PaymentNotificationCapture';
import {
  authenticatePrivacyProtection,
  getPrivacyProtectionCapabilities,
} from '../../native/PrivacyProtection';
import {
  colors,
  radius,
  shadows,
  spacing,
  typography,
} from '../../theme/tokens';

export function SettingsScreen() {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const privacy = usePrivacySettings();
  const [learningEnabled, setLearningEnabled] = useState(true);
  const [retainOriginalText, setRetainOriginalText] = useState(true);
  const [localInsightsEnabled, setLocalInsightsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [privacySaving, setPrivacySaving] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationNotice, setNotificationNotice] = useState<string>();
  const [notificationStatus, setNotificationStatus] =
    useState<PaymentNotificationCaptureStatus>({
      supported: false,
      permissionGranted: false,
      queuedCount: 0,
    });

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError(undefined);

      repositories.personalizationSettings
        .get()
        .then(settings => {
          if (active) {
            setLearningEnabled(settings.learningEnabled);
            setRetainOriginalText(settings.retainOriginalText);
            setLocalInsightsEnabled(settings.localInsightsEnabled);
          }
        })
        .catch(loadError => {
          if (active) {
            setError(
              safeErrorMessage(
                loadError,
                '读取个性化设置失败。',
                'SETTINGS-LOAD-UNEXPECTED',
              ),
            );
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });

      getPaymentNotificationCaptureStatus()
        .then(status => {
          if (active) setNotificationStatus(status);
        })
        .catch(() => {
          if (active) {
            setNotificationStatus({
              supported: false,
              permissionGranted: false,
              queuedCount: 0,
            });
          }
        });

      return () => {
        active = false;
      };
    }, [repositories]),
  );

  const changeLearning = async (enabled: boolean) => {
    const previous = learningEnabled;
    setLearningEnabled(enabled);
    setSaving(true);
    setError(undefined);
    try {
      await repositories.personalizationSettings.setLearningEnabled(
        enabled,
        new Date().toISOString(),
      );
    } catch (saveError) {
      setLearningEnabled(previous);
      setError(
        safeErrorMessage(
          saveError,
          '保存个性化设置失败。',
          'SETTINGS-LEARNING-SAVE-UNEXPECTED',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const openNotificationAccess = async () => {
    setError(undefined);
    try {
      await openPaymentNotificationSettings();
    } catch (accessError) {
      setError(
        safeErrorMessage(
          accessError,
          '无法打开系统通知使用权设置。',
          'SETTINGS-NOTIFICATION-ACCESS-UNEXPECTED',
        ),
      );
    }
  };

  const importCapturedNotifications = async () => {
    setNotificationBusy(true);
    setError(undefined);
    setNotificationNotice(undefined);
    try {
      const snapshots = await listPendingPaymentNotifications();
      const previews = parsePaymentNotifications(snapshots);
      const reviews = [];
      for (const preview of previews) {
        reviews.push(await repositories.statementImport.analyze(preview));
      }
      const result = await repositories.statementImport.commitMany(
        reviews,
        new Date().toISOString(),
      );
      await acknowledgePaymentNotifications(
        snapshots.map(snapshot => snapshot.key),
      );
      const importedCount = result.transactionIds.length;
      setNotificationNotice(
        importedCount === 0
          ? '没有发现可可靠解析的新支付通知。'
          : `已将 ${importedCount} 笔支付通知放入待确认，并自动建议商户分类。`,
      );
      setNotificationStatus(await getPaymentNotificationCaptureStatus());
    } catch (importError) {
      setError(
        safeErrorMessage(
          importError,
          '支付通知读取失败，账本不会写入半成品。',
          'SETTINGS-NOTIFICATION-IMPORT-UNEXPECTED',
        ),
      );
    } finally {
      setNotificationBusy(false);
    }
  };

  const changeOriginalTextRetention = async (enabled: boolean) => {
    const previous = retainOriginalText;
    setRetainOriginalText(enabled);
    setSaving(true);
    setError(undefined);
    try {
      await repositories.personalizationSettings.setRetainOriginalText(
        enabled,
        new Date().toISOString(),
      );
    } catch (saveError) {
      setRetainOriginalText(previous);
      setError(
        safeErrorMessage(
          saveError,
          '保存原始文字设置失败。',
          'SETTINGS-RETENTION-SAVE-UNEXPECTED',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const changeLocalInsights = async (enabled: boolean) => {
    const previous = localInsightsEnabled;
    setLocalInsightsEnabled(enabled);
    setSaving(true);
    setError(undefined);
    try {
      await repositories.personalizationSettings.setLocalInsightsEnabled(
        enabled,
        new Date().toISOString(),
      );
    } catch (saveError) {
      setLocalInsightsEnabled(previous);
      setError(
        safeErrorMessage(
          saveError,
          '保存本地洞察设置失败。',
          'SETTINGS-INSIGHTS-SAVE-UNEXPECTED',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const changeAppLock = async (enabled: boolean) => {
    setPrivacySaving(true);
    setError(undefined);
    try {
      const capabilities = await getPrivacyProtectionCapabilities();
      if (!capabilities.available) {
        throw new Error('请先在系统设置中配置生物识别、锁屏密码或设备凭据。');
      }
      const authenticated = await authenticatePrivacyProtection(
        enabled ? '验证身份以启用账本锁' : '验证身份以关闭账本锁',
      );
      if (authenticated.status === 'AUTHENTICATED') {
        await privacy.updateSettings({ appLockEnabled: enabled });
      }
    } catch (privacyError) {
      setError(
        safeErrorMessage(
          privacyError,
          '无法更改账本锁设置。',
          'SETTINGS-APP-LOCK-UNEXPECTED',
        ),
      );
    } finally {
      setPrivacySaving(false);
    }
  };

  const changeHideAmounts = async (enabled: boolean) => {
    setPrivacySaving(true);
    setError(undefined);
    try {
      await privacy.updateSettings({ hideAmounts: enabled });
    } catch (privacyError) {
      setError(
        safeErrorMessage(
          privacyError,
          '无法更改金额隐藏设置。',
          'SETTINGS-HIDE-AMOUNTS-UNEXPECTED',
        ),
      );
    } finally {
      setPrivacySaving(false);
    }
  };

  const changeLockTimeout = async (value: PrivacyLockTimeoutSeconds) => {
    setPrivacySaving(true);
    setError(undefined);
    try {
      await privacy.updateSettings({ lockTimeoutSeconds: value });
    } catch (privacyError) {
      setError(
        safeErrorMessage(
          privacyError,
          '无法更改自动锁定时间。',
          'SETTINGS-LOCK-TIMEOUT-UNEXPECTED',
        ),
      );
    } finally {
      setPrivacySaving(false);
    }
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.introCard}>
          <View style={styles.introHeader}>
            <View>
              <Text style={styles.introEyebrow}>隐私优先</Text>
              <Text accessibilityRole="header" style={styles.introTitle}>
                本地个性化
              </Text>
            </View>
            <View style={styles.privacyMark}>
              <MaterialDesignIcons
                color={colors.white}
                name="shield-lock-outline"
                size={29}
              />
            </View>
          </View>
          <Text style={styles.introText}>
            根据你确认后的分类纠正学习商户习惯。纠正记录、规则和匹配过程都只保存在本机。
          </Text>
        </View>

        <Text style={styles.sectionLabel}>智能学习</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>自动学习纠正</Text>
              <Text style={styles.settingDescription}>
                同一商户连续 3 次被纠正为相同分类后，形成一条可管理的商户规则。
              </Text>
            </View>
            {loading ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <Switch
                accessibilityLabel="自动学习纠正"
                disabled={saving}
                onValueChange={changeLearning}
                trackColor={{
                  false: colors.borderStrong,
                  true: colors.brandMuted,
                }}
                thumbColor={learningEnabled ? colors.brand : colors.surface}
                value={learningEnabled}
              />
            )}
          </View>
          <Text style={styles.pauseNotice}>
            暂停后不会记录新的纠正或生成学习规则；已有且已启用的规则仍会继续生效。
          </Text>
        </View>

        <Text style={styles.sectionLabel}>本地洞察</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>财务提醒与趋势提示</Text>
              <Text style={styles.settingDescription}>
                在本机计算预算偏离、分类上涨、异常大额、重复订阅候选和预算内每日可用额度。
              </Text>
            </View>
            {loading ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <Switch
                accessibilityLabel="本地财务洞察"
                disabled={saving}
                onValueChange={changeLocalInsights}
                thumbColor={
                  localInsightsEnabled ? colors.brand : colors.surface
                }
                value={localInsightsEnabled}
              />
            )}
          </View>
          <Text style={styles.pauseNotice}>
            关闭后分析页不再生成洞察；账目不会上传，也不会影响基础统计。
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('BudgetSettings')}
          style={styles.linkCard}
        >
          <View style={styles.ruleIcon}>
            <MaterialDesignIcons color={colors.brand} name="target" size={26} />
          </View>
          <View style={styles.linkCopy}>
            <Text style={styles.linkTitle}>月度预算</Text>
            <Text style={styles.linkDescription}>
              设置总预算和分类预算，为预算进度与本地洞察提供明确口径。
            </Text>
          </View>
          <MaterialDesignIcons
            color={colors.brand}
            name="chevron-right"
            size={27}
          />
        </Pressable>

        <Text style={styles.sectionLabel}>规则管理</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('RuleManagement')}
          style={styles.linkCard}
        >
          <View style={styles.ruleIcon}>
            <MaterialDesignIcons
              color={colors.brand}
              name="tune-variant"
              size={26}
            />
          </View>
          <View style={styles.linkCopy}>
            <Text style={styles.linkTitle}>分类规则</Text>
            <Text style={styles.linkDescription}>
              查看规则来源，新增商户或关键词规则，并可编辑、停用或删除。
            </Text>
          </View>
          <MaterialDesignIcons
            color={colors.brand}
            name="chevron-right"
            size={27}
          />
        </Pressable>

        <Text style={styles.sectionLabel}>数据留存</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>保存记账原始文字</Text>
              <Text style={styles.settingDescription}>
                用于复核识别结果和改进本地分类。关闭后，已有原文会立即从账本和纠错记录中清除，之后也不会再写入。
              </Text>
            </View>
            {loading ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <Switch
                accessibilityLabel="保存记账原始文字"
                disabled={saving}
                onValueChange={changeOriginalTextRetention}
                trackColor={{
                  false: colors.borderStrong,
                  true: colors.brandMuted,
                }}
                thumbColor={retainOriginalText ? colors.brand : colors.surface}
                value={retainOriginalText}
              />
            )}
          </View>
          <Text style={styles.pauseNotice}>
            金额、分类、账户和备注仍会正常保存；本设置只控制输入句子和语音转写原文。
          </Text>
        </View>

        <Text style={styles.sectionLabel}>数据安全</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>账本锁</Text>
              <Text style={styles.settingDescription}>
                冷启动或离开超过设定时间后，使用系统生物识别、锁屏密码或设备凭据解锁。
              </Text>
            </View>
            <Switch
              accessibilityLabel="账本锁"
              disabled={privacySaving}
              onValueChange={changeAppLock}
              value={privacy.settings.appLockEnabled}
            />
          </View>
          {privacy.settings.appLockEnabled ? (
            <View style={styles.timeoutSection}>
              <Text style={styles.optionCaption}>离开后自动锁定</Text>
              <View style={styles.timeoutOptions}>
                {(
                  [
                    [0, '立即'],
                    [30, '30 秒'],
                    [60, '1 分钟'],
                    [300, '5 分钟'],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    accessibilityRole="button"
                    key={value}
                    onPress={() => changeLockTimeout(value)}
                    style={[
                      styles.timeoutButton,
                      privacy.settings.lockTimeoutSeconds === value &&
                        styles.timeoutButtonSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.timeoutButtonText,
                        privacy.settings.lockTimeoutSeconds === value &&
                          styles.timeoutButtonTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>隐藏金额</Text>
              <Text style={styles.settingDescription}>
                首页、流水和分析页用占位符遮住金额，不改变统计与导出数据。
              </Text>
            </View>
            <Switch
              accessibilityLabel="隐藏金额"
              disabled={privacySaving}
              onValueChange={changeHideAmounts}
              value={privacy.settings.hideAmounts}
            />
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('RecurringTemplates')}
          style={styles.linkCard}
        >
          <View style={styles.ruleIcon}>
            <MaterialDesignIcons
              color={colors.brand}
              name="calendar-sync-outline"
              size={26}
            />
          </View>
          <View style={styles.linkCopy}>
            <Text style={styles.linkTitle}>周期记账</Text>
            <Text style={styles.linkDescription}>
              为房租、订阅等固定项目生成待确认草稿，或显式选择自动入账。
            </Text>
          </View>
          <MaterialDesignIcons
            color={colors.brand}
            name="chevron-right"
            size={27}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('StatementImport')}
          style={styles.linkCard}
        >
          <View style={styles.ruleIcon}>
            <MaterialDesignIcons
              color={colors.brand}
              name="file-import-outline"
              size={26}
            />
          </View>
          <View style={styles.linkCopy}>
            <Text style={styles.linkTitle}>账单导入</Text>
            <Text style={styles.linkDescription}>
              预览微信、支付宝或通用 CSV/TSV，识别重复后统一进入待确认。
            </Text>
          </View>
          <MaterialDesignIcons
            color={colors.brand}
            name="chevron-right"
            size={27}
          />
        </Pressable>
        <Text style={styles.sectionLabel}>Android 自动辅助</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.ruleIcon}>
              <MaterialDesignIcons
                color={colors.brand}
                name="bell-check-outline"
                size={26}
              />
            </View>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>微信 / 支付宝支付通知</Text>
              <Text style={styles.settingDescription}>
                {notificationStatus.supported
                  ? notificationStatus.permissionGranted
                    ? `通知使用权已开启，内存中有 ${notificationStatus.queuedCount} 条待检查通知。`
                    : '需由你在系统设置中显式授予通知使用权。'
                  : '当前设备不支持；账单文件导入仍可正常使用。'}
              </Text>
            </View>
          </View>
          <Text style={styles.pauseNotice}>
            仅接收微信和支付宝通知，原文只在内存中短暂排队；本机解析后生成待确认候选，不会静默入账，也不保证覆盖被系统遗漏的通知。
          </Text>
          {notificationStatus.supported ? (
            <View style={styles.notificationActions}>
              <Pressable
                accessibilityRole="button"
                disabled={notificationBusy}
                onPress={() => openNotificationAccess().catch(() => undefined)}
                style={styles.notificationSecondaryButton}
              >
                <Text style={styles.notificationSecondaryText}>
                  {notificationStatus.permissionGranted
                    ? '管理通知使用权'
                    : '开启通知使用权'}
                </Text>
              </Pressable>
              {notificationStatus.permissionGranted ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={notificationBusy}
                  onPress={() =>
                    importCapturedNotifications().catch(() => undefined)
                  }
                  style={styles.notificationPrimaryButton}
                >
                  {notificationBusy ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text style={styles.notificationPrimaryText}>
                      检查并导入
                    </Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {notificationNotice === undefined ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Pending')}
            >
              <Text style={styles.notificationNotice}>
                {notificationNotice} 去审核
              </Text>
            </Pressable>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('DataManagement')}
          style={styles.linkCard}
        >
          <View style={styles.ruleIcon}>
            <MaterialDesignIcons
              color={colors.brand}
              name="database-cog-outline"
              size={26}
            />
          </View>
          <View style={styles.linkCopy}>
            <Text style={styles.linkTitle}>数据管理</Text>
            <Text style={styles.linkDescription}>
              核对本机账本范围，并在需要时彻底删除全部个人数据。
            </Text>
          </View>
          <MaterialDesignIcons
            color={colors.brand}
            name="chevron-right"
            size={27}
          />
        </Pressable>

        {error === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}

        <View style={styles.scopeCard}>
          <Text style={styles.scopeTitle}>本地处理边界</Text>
          <Text style={styles.scopeText}>
            纠正学习、规则匹配与账本数据管理都在本机完成，不会上传账本或规则。
          </Text>
        </View>
      </ScrollView>
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
  introCard: {
    gap: spacing.sm,
    overflow: 'hidden',
    borderRadius: radius.xl,
    backgroundColor: colors.brand,
    padding: spacing.lg,
    ...shadows.card,
  },
  introHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  introEyebrow: {
    color: colors.onBrandSubtle,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  introTitle: {
    marginTop: 3,
    color: colors.white,
    fontSize: typography.pageTitle,
    fontWeight: '900',
  },
  introText: { color: colors.onBrandMuted, fontSize: 14, lineHeight: 22 },
  privacyMark: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  sectionLabel: {
    marginTop: spacing.xs,
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
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  settingCopy: { minWidth: 0, flex: 1, gap: 5 },
  settingTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  settingDescription: {
    color: colors.inkSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  pauseNotice: {
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    color: colors.brandPressed,
    fontSize: 12,
    lineHeight: 18,
    padding: 10,
  },
  notificationActions: { flexDirection: 'row', gap: spacing.sm },
  notificationSecondaryButton: {
    minHeight: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.sm,
  },
  notificationSecondaryText: { color: colors.brand, fontWeight: '900' },
  notificationPrimaryButton: {
    minHeight: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  notificationPrimaryText: { color: colors.white, fontWeight: '900' },
  notificationNotice: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 20,
  },
  timeoutSection: { gap: spacing.sm },
  optionCaption: { color: colors.inkMuted, fontSize: 12, fontWeight: '800' },
  timeoutOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  timeoutButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  timeoutButtonSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  timeoutButtonText: {
    color: colors.inkSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  timeoutButtonTextSelected: { color: colors.brand, fontWeight: '900' },
  linkCard: {
    minHeight: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    ...shadows.card,
  },
  ruleIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  linkCopy: { minWidth: 0, flex: 1, gap: 6 },
  linkTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  linkDescription: {
    color: colors.inkSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  error: {
    borderRadius: radius.sm,
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    padding: 12,
  },
  scopeCard: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
  },
  scopeTitle: {
    color: colors.inkSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  scopeText: { color: colors.inkMuted, fontSize: 12, lineHeight: 18 },
});
