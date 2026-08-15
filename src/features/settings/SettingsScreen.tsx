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
import { safeErrorMessage } from '../../domain/errors/AppError';
import { importPendingPaymentNotificationsAutomatically } from '../../importers/paymentNotificationAutoImport';
import {
  getPaymentNotificationCaptureStatus,
  openPaymentNotificationSettings,
  setPaymentNotificationCaptureEnabled,
  type PaymentNotificationCaptureStatus,
} from '../../native/PaymentNotificationCapture';
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
  const [learningEnabled, setLearningEnabled] = useState(true);
  const [retainOriginalText, setRetainOriginalText] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [paymentNotificationsEnabled, setPaymentNotificationsEnabled] =
    useState(false);
  const [imageOcrEnabled, setImageOcrEnabled] = useState(false);
  const [experimentBusy, setExperimentBusy] = useState(false);
  const [experimentNotice, setExperimentNotice] = useState<string>();
  const [notificationStatus, setNotificationStatus] =
    useState<PaymentNotificationCaptureStatus>({
      supported: false,
      permissionGranted: false,
      captureEnabled: false,
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

      repositories.experimentalFeatures
        .get()
        .then(settings => {
          if (active) {
            setPaymentNotificationsEnabled(
              settings.paymentNotificationsEnabled,
            );
            setImageOcrEnabled(settings.imageOcrEnabled);
          }
        })
        .catch(() => undefined);
      getPaymentNotificationCaptureStatus()
        .then(status => {
          if (active) setNotificationStatus(status);
        })
        .catch(() => undefined);

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

  const changeExperiment = async (key: 'imageOcrEnabled', enabled: boolean) => {
    setExperimentBusy(true);
    setError(undefined);
    try {
      const updated = await repositories.experimentalFeatures.update(
        { [key]: enabled },
        new Date().toISOString(),
      );
      setPaymentNotificationsEnabled(updated.paymentNotificationsEnabled);
      setImageOcrEnabled(updated.imageOcrEnabled);
    } catch (caught) {
      setError(
        safeErrorMessage(
          caught,
          '无法保存实验功能设置。',
          'SETTINGS-EXPERIMENT-SAVE-UNEXPECTED',
        ),
      );
    } finally {
      setExperimentBusy(false);
    }
  };

  const changePaymentNotifications = async (enabled: boolean) => {
    setExperimentBusy(true);
    setError(undefined);
    setExperimentNotice(undefined);
    try {
      const updated = await repositories.experimentalFeatures.update(
        { paymentNotificationsEnabled: enabled },
        new Date().toISOString(),
      );
      let status: PaymentNotificationCaptureStatus;
      try {
        status = await setPaymentNotificationCaptureEnabled(enabled);
      } catch (nativeError) {
        if (enabled) {
          await repositories.experimentalFeatures.update(
            { paymentNotificationsEnabled: false },
            new Date().toISOString(),
          );
          await setPaymentNotificationCaptureEnabled(false).catch(
            () => undefined,
          );
        }
        throw nativeError;
      }
      setPaymentNotificationsEnabled(updated.paymentNotificationsEnabled);
      setNotificationStatus(status);
      setExperimentNotice(
        enabled
          ? status.permissionGranted
            ? '自动记账已开启；新支付会自动进入待确认。'
            : '还需开启系统“通知使用权”，才能识别新支付。'
          : '自动记账已关闭，尚未导入的通知内容已清除。',
      );
    } catch (caught) {
      setError(
        safeErrorMessage(
          caught,
          '无法更新支付通知自动记账设置。',
          'SETTINGS-NOTIFICATION-SAVE-UNEXPECTED',
        ),
      );
    } finally {
      setExperimentBusy(false);
    }
  };

  const importPaymentNotifications = async () => {
    setExperimentBusy(true);
    setError(undefined);
    setExperimentNotice(undefined);
    try {
      const result =
        await importPendingPaymentNotificationsAutomatically(repositories);
      setExperimentNotice(
        result.importedCount === 0
          ? '没有发现新的可解析支付通知。'
          : `已将 ${result.importedCount} 笔支付通知自动放入待确认。`,
      );
      setNotificationStatus(await getPaymentNotificationCaptureStatus());
    } catch (caught) {
      setError(
        safeErrorMessage(
          caught,
          '支付通知导入失败；通知未确认清除，可稍后重试。',
          'SETTINGS-NOTIFICATION-IMPORT-UNEXPECTED',
        ),
      );
    } finally {
      setExperimentBusy(false);
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

        <Text style={styles.sectionLabel}>自动化与导入（默认关闭）</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>微信 / 支付宝自动记账</Text>
              <Text style={styles.settingDescription}>
                Android
                在你明确开启并授予“通知使用权”后，只筛选微信、支付宝的支付结果通知；新账会在本机自动进入待确认，聊天通知不会保存或入账，任何通知都不会上传。
              </Text>
            </View>
            <Switch
              accessibilityLabel="支付通知辅助记账"
              disabled={experimentBusy || !notificationStatus.supported}
              onValueChange={changePaymentNotifications}
              value={paymentNotificationsEnabled}
            />
          </View>
          {paymentNotificationsEnabled && notificationStatus.supported ? (
            <View style={styles.experimentActions}>
              <Pressable
                accessibilityRole="button"
                disabled={experimentBusy}
                onPress={() => openPaymentNotificationSettings()}
                style={styles.experimentSecondary}
              >
                <Text style={styles.experimentSecondaryText}>
                  {notificationStatus.permissionGranted
                    ? '管理通知使用权'
                    : '开启通知使用权'}
                </Text>
              </Pressable>
              {notificationStatus.permissionGranted ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={experimentBusy}
                  onPress={importPaymentNotifications}
                  style={styles.experimentPrimary}
                >
                  <Text style={styles.experimentPrimaryText}>
                    立即重试（{notificationStatus.queuedCount}）
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>截图文字识别</Text>
              <Text style={styles.settingDescription}>
                开启后可把支付截图分享给轻记
                AI，在设备上识别文字；图片不上传、不保存。
              </Text>
            </View>
            <Switch
              accessibilityLabel="截图文字识别"
              disabled={experimentBusy}
              onValueChange={enabled =>
                changeExperiment('imageOcrEnabled', enabled)
              }
              value={imageOcrEnabled}
            />
          </View>
          {experimentNotice === undefined ? null : (
            <Text accessibilityRole="alert" style={styles.pauseNotice}>
              {experimentNotice}
            </Text>
          )}
        </View>

        {error === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}

        <View style={styles.scopeCard}>
          <Text style={styles.scopeTitle}>当前阶段边界</Text>
          <Text style={styles.scopeText}>
            自动记账只支持
            Android；后台启动被系统限制时，通知会暂存在不参与备份的 App
            私有事件箱，并在下次打开 App 时自动补导。iOS 无法监听其他 App
            通知，仍使用分享或截图识别。账本、通知内容、图片和规则不会上传。
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
  experimentActions: { flexDirection: 'row', gap: spacing.sm },
  experimentSecondary: {
    minHeight: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.sm,
  },
  experimentSecondaryText: { color: colors.brand, fontWeight: '800' },
  experimentPrimary: {
    minHeight: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  experimentPrimaryText: { color: colors.white, fontWeight: '800' },
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
