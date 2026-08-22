import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { useRepositories } from '../../app/DatabaseProvider';
import type { ShadowObservationSummary } from '../../database/repositories';
import { safeErrorMessage } from '../../domain/errors/AppError';
import { importPendingPaymentNotificationsAutomatically } from '../../importers/paymentNotificationAutoImport';
import {
  getPaymentNotificationCaptureStatus,
  openPaymentNotificationSettings,
  setPaymentNotificationCaptureEnabled,
  type PaymentNotificationCaptureStatus,
} from '../../native/PaymentNotificationCapture';
import { colors, radius, shadows, spacing } from '../../theme/tokens';

const EMPTY_NOTIFICATION_STATUS: PaymentNotificationCaptureStatus = {
  supported: false,
  permissionGranted: false,
  captureEnabled: false,
  queuedCount: 0,
};

async function requestPendingReviewAlertPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) return true;
  return (
    (await PermissionsAndroid.request(permission, {
      title: '允许待确认账单提醒',
      message:
        '识别到支付通知后，轻记 AI 可提示你核对候选账单。拒绝不会影响本地捕获和前台补导。',
      buttonPositive: '允许提醒',
      buttonNegative: '暂不允许',
    })) === PermissionsAndroid.RESULTS.GRANTED
  );
}

export function ExperimentalFeaturesSection() {
  const repositories = useRepositories();
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [imageOcrEnabled, setImageOcrEnabled] = useState(false);
  const [notificationStatus, setNotificationStatus] =
    useState<PaymentNotificationCaptureStatus>(EMPTY_NOTIFICATION_STATUS);
  const [shadowSummary, setShadowSummary] =
    useState<ShadowObservationSummary>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([
        repositories.experimentalFeatures.get(),
        getPaymentNotificationCaptureStatus(),
        repositories.shadowObservations.latestSummary(),
      ])
        .then(([settings, status, summary]) => {
          if (!active) return;
          setPaymentEnabled(settings.paymentNotificationsEnabled);
          setImageOcrEnabled(settings.imageOcrEnabled);
          setNotificationStatus(status);
          setShadowSummary(summary);
        })
        .catch(loadError => {
          if (active) {
            setError(
              safeErrorMessage(
                loadError,
                '读取实验功能状态失败。',
                'SETTINGS-EXPERIMENT-LOAD-UNEXPECTED',
              ),
            );
          }
        });
      return () => {
        active = false;
      };
    }, [repositories]),
  );

  const changePaymentNotifications = async (enabled: boolean) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const reviewAlertsEnabled = enabled
        ? await requestPendingReviewAlertPermission().catch(() => false)
        : false;
      await repositories.experimentalFeatures.update(
        { paymentNotificationsEnabled: enabled },
        new Date().toISOString(),
      );
      try {
        const status = await setPaymentNotificationCaptureEnabled(enabled);
        setPaymentEnabled(enabled);
        setNotificationStatus(status);
        setNotice(
          enabled
            ? status.permissionGranted
              ? reviewAlertsEnabled
                ? '已开启；识别结果会进入待确认并显示核对提醒，不会直接入账。'
                : '已开启；识别结果会进入待确认，但系统未允许核对提醒。'
              : '还需在系统中授予“通知使用权”。'
            : '已关闭，尚未导入的通知已清除。',
        );
      } catch (nativeError) {
        await repositories.experimentalFeatures.update(
          { paymentNotificationsEnabled: false },
          new Date().toISOString(),
        );
        await setPaymentNotificationCaptureEnabled(false).catch(
          () => undefined,
        );
        throw nativeError;
      }
    } catch (caught) {
      setPaymentEnabled(false);
      setError(
        safeErrorMessage(
          caught,
          '无法更新支付通知辅助记账。',
          'SETTINGS-NOTIFICATION-SAVE-UNEXPECTED',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const changeImageOcr = async (enabled: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const updated = await repositories.experimentalFeatures.update(
        { imageOcrEnabled: enabled },
        new Date().toISOString(),
      );
      setImageOcrEnabled(updated.imageOcrEnabled);
    } catch (caught) {
      setError(
        safeErrorMessage(
          caught,
          '无法保存截图识别设置。',
          'SETTINGS-OCR-SAVE-UNEXPECTED',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const importQueuedNotifications = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result =
        await importPendingPaymentNotificationsAutomatically(repositories);
      setNotice(
        result.importedCount === 0
          ? '没有发现新的可解析支付通知。'
          : `已将 ${result.importedCount} 笔记录放入待确认。`,
      );
      setNotificationStatus(await getPaymentNotificationCaptureStatus());
    } catch (caught) {
      setError(
        safeErrorMessage(
          caught,
          '支付通知导入失败，可稍后重试。',
          'SETTINGS-NOTIFICATION-IMPORT-UNEXPECTED',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const exportShadowObservations = async () => {
    if (shadowSummary === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const jsonl = await repositories.shadowObservations.exportJsonl(
        shadowSummary.modelVersion,
      );
      await Share.share({
        title: `轻记 AI 模型观察数据 ${shadowSummary.modelVersion}`,
        message: jsonl,
      });
      setNotice(
        `已准备 ${shadowSummary.observationCount} 条脱敏观察数据，不含原文、金额和账户。`,
      );
    } catch (caught) {
      setError(
        safeErrorMessage(
          caught,
          '模型观察数据导出失败。',
          'SETTINGS-SHADOW-EXPORT-UNEXPECTED',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text style={styles.sectionLabel}>自动化与导入（默认关闭）</Text>
      <View style={styles.card}>
        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={styles.settingTitle}>微信 / 支付宝通知辅助记账</Text>
            <Text style={styles.settingDescription}>
              仅在 Android 上工作。系统通知使用权覆盖全部通知；App
              只在本机筛选微信和支付宝支付结果并生成待确认记录，不上传通知内容。
            </Text>
          </View>
          <Switch
            accessibilityLabel="支付通知辅助记账"
            disabled={busy || !notificationStatus.supported}
            onValueChange={changePaymentNotifications}
            value={paymentEnabled}
          />
        </View>
        {paymentEnabled && notificationStatus.supported ? (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => openPaymentNotificationSettings()}
              style={styles.secondaryAction}
            >
              <Text style={styles.secondaryActionText}>
                {notificationStatus.permissionGranted
                  ? '管理通知使用权'
                  : '开启通知使用权'}
              </Text>
            </Pressable>
            {notificationStatus.permissionGranted ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={importQueuedNotifications}
                style={styles.primaryAction}
              >
                <Text style={styles.primaryActionText}>
                  重试队列（{notificationStatus.queuedCount}）
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={styles.settingTitle}>截图文字识别</Text>
            <Text style={styles.settingDescription}>
              分享支付截图后仅在设备上识别，图片不上传、不保存；结果仍需确认。
            </Text>
          </View>
          <Switch
            accessibilityLabel="截图文字识别"
            disabled={busy}
            onValueChange={changeImageOcr}
            value={imageOcrEnabled}
          />
        </View>
      </View>

      {shadowSummary === undefined ? null : (
        <>
          <Text style={styles.sectionLabel}>模型验证</Text>
          <View style={styles.card}>
            <Text style={styles.settingTitle}>脱敏影子观察</Text>
            <Text style={styles.settingDescription}>
              模型 {shadowSummary.modelVersion} 已积累{' '}
              {shadowSummary.observationCount}{' '}
              条人工确认对照，只含分类、置信度和耗时。
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={exportShadowObservations}
              style={styles.primaryAction}
            >
              {busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryActionText}>导出 JSONL</Text>
              )}
            </Pressable>
          </View>
        </>
      )}

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
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    marginTop: spacing.xs,
    marginLeft: spacing.xxs,
    color: colors.inkMuted,
    fontSize: 12,
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
  actions: { flexDirection: 'row', gap: spacing.sm },
  secondaryAction: {
    minHeight: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.sm,
  },
  secondaryActionText: { color: colors.brand, fontWeight: '800' },
  primaryAction: {
    minHeight: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.sm,
  },
  primaryActionText: { color: colors.white, fontWeight: '800' },
  notice: {
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    color: colors.brandPressed,
    padding: 12,
  },
  error: {
    borderRadius: radius.sm,
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    padding: 12,
  },
});
