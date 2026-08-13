import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons/static';
import type { ComponentProps } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { SpeechRecognitionActions } from '../../../speech/useSpeechRecognition';
import type { SpeechRecognitionSnapshot } from '../../../speech/types';
import {
  colors,
  control,
  radius,
  spacing,
  typography,
} from '../../../theme/tokens';

type Props = {
  snapshot: SpeechRecognitionSnapshot;
  actions: SpeechRecognitionActions;
  onUsePartial: (text: string, resultToken: string) => void;
  showActions?: boolean;
};

const BUSY_STATUSES = [
  'CHECKING_AVAILABILITY',
  'PREPARING_MODEL',
  'REQUESTING_PERMISSION',
  'STARTING',
  'PROCESSING',
] as const;

function statusText(snapshot: SpeechRecognitionSnapshot): string | undefined {
  const possibleNetworkRoute =
    snapshot.usingNetworkFallback || snapshot.mayUseNetwork === true;
  switch (snapshot.status) {
    case 'CHECKING_AVAILABILITY':
      return '正在检查设备语音能力…';
    case 'PREPARING_MODEL':
      return '正在准备本地中文语音…';
    case 'REQUESTING_PERMISSION':
      return '等待系统授予语音权限…';
    case 'STARTING':
      return possibleNetworkRoute
        ? '正在打开系统语音（可能联网）…'
        : '正在打开麦克风…';
    case 'LISTENING':
      return (
        snapshot.partialText ||
        (possibleNetworkRoute
          ? '正在听（系统服务可能联网，也可能自动结束）'
          : '正在听，请说出金额和用途')
      );
    case 'PROCESSING':
      return (
        snapshot.partialText ||
        (possibleNetworkRoute
          ? '系统语音正在完成转写（可能联网）…'
          : '正在完成转写…')
      );
    case 'SUCCEEDED':
      if (snapshot.canContinue === true && snapshot.finalText) {
        return '系统语音已结束本段。你可以继续说，或使用当前文字。';
      }
      return snapshot.finalText
        ? `已转为文字：${snapshot.finalText}`
        : undefined;
    case 'CANCELLED':
      return '已取消语音输入。';
    case 'ERROR':
      return snapshot.error?.message ?? '语音识别暂时失败。';
    default:
      return snapshot.notice;
  }
}

type ActionSpec = {
  accessibilityLabel: string;
  icon: ComponentProps<typeof MaterialDesignIcons>['name'];
  label: string;
  onPress: () => void;
  tone?: 'brand' | 'warning';
};

export function VoiceEntryPanel({
  snapshot,
  actions,
  onUsePartial,
  showActions = true,
}: Props) {
  const busy = BUSY_STATUSES.includes(
    snapshot.status as (typeof BUSY_STATUSES)[number],
  );
  const listening = snapshot.status === 'LISTENING';
  const error = snapshot.status === 'ERROR' ? snapshot.error : undefined;
  const localCapabilityNotice =
    error !== undefined &&
    snapshot.usingNetworkFallback !== true &&
    (error.stage === 'capability' ||
      snapshot.stage === 'capability' ||
      error.route === 'on-device' ||
      snapshot.route === 'on-device') &&
    [
      'model-missing',
      'model-status-unknown',
      'language-not-supported',
    ].includes(error.code);
  const partialText = snapshot.partialText.trim();
  const finalText = snapshot.finalText?.trim() ?? '';
  const consumableResultToken =
    snapshot.hasFreshTurnEvidence === true ? snapshot.resultToken : undefined;
  const status = statusText(snapshot);

  let primaryAction: ActionSpec | undefined;
  let secondaryAction: ActionSpec | undefined;

  if (showActions) {
    if (listening) {
      primaryAction = {
        accessibilityLabel: '说完了',
        icon: 'check',
        label: '说完了',
        onPress: actions.stop,
      };
      secondaryAction = {
        accessibilityLabel: '取消',
        icon: 'close',
        label: '取消',
        onPress: actions.cancel,
      };
    } else if (
      snapshot.status === 'SUCCEEDED' &&
      snapshot.canContinue === true &&
      finalText.length > 0 &&
      consumableResultToken !== undefined
    ) {
      primaryAction = {
        accessibilityLabel: '继续说',
        icon: 'microphone-plus',
        label: '继续说',
        onPress: actions.continueDictation,
      };
      secondaryAction = {
        accessibilityLabel: '使用这段文字',
        icon: 'text-box-check-outline',
        label: '使用这段文字',
        onPress: () => onUsePartial(finalText, consumableResultToken),
      };
    } else if (
      snapshot.status === 'PREPARING_MODEL' &&
      snapshot.canRecheck === true &&
      actions.recheck !== undefined
    ) {
      primaryAction = {
        accessibilityLabel: '检查语音包是否就绪',
        icon: 'refresh',
        label: '检查语音包是否就绪',
        onPress: actions.recheck,
      };
    } else if (
      error !== undefined &&
      partialText.length > 0 &&
      consumableResultToken !== undefined
    ) {
      primaryAction = {
        accessibilityLabel: '使用已转写文字继续',
        icon: 'text-box-check-outline',
        label: '使用已转写文字继续',
        onPress: () => onUsePartial(partialText, consumableResultToken),
      };
    } else if (error?.canOpenSettings === true) {
      primaryAction = {
        accessibilityLabel: '打开权限设置',
        icon: 'cog-outline',
        label: '打开权限设置',
        onPress: actions.openSettings,
      };
    } else if (error?.canDownloadModel === true) {
      primaryAction = {
        accessibilityLabel: '下载中文语音',
        icon: 'download',
        label: '下载中文语音',
        onPress: actions.downloadModel,
      };
      if (error.canUseNetwork) {
        secondaryAction = {
          accessibilityLabel: '使用可能联网的系统语音',
          icon: 'account-voice',
          label: '使用可能联网的系统语音',
          onPress: actions.useNetworkAndRetry,
          tone: 'warning',
        };
      }
    } else if (error?.canRecheck === true && actions.recheck !== undefined) {
      primaryAction = {
        accessibilityLabel: '我已开启，重新检测',
        icon: 'refresh',
        label: '我已开启，重新检测',
        onPress: actions.recheck,
      };
    } else if (error?.canUseNetwork === true) {
      primaryAction = {
        accessibilityLabel: '使用可能联网的系统语音',
        icon: 'account-voice',
        label: '使用可能联网的系统语音',
        onPress: actions.useNetworkAndRetry,
        tone: 'warning',
      };
    } else if (error?.canRetry === true) {
      const networkRetry = snapshot.usingNetworkFallback;
      primaryAction = {
        accessibilityLabel: networkRetry
          ? '再次使用系统语音（可能联网）'
          : '重试语音',
        icon: 'refresh',
        label: networkRetry ? '再次使用系统语音（可能联网）' : '重试语音',
        onPress: actions.retry,
        tone: networkRetry ? 'warning' : 'brand',
      };
    } else if (['IDLE', 'SUCCEEDED', 'CANCELLED'].includes(snapshot.status)) {
      primaryAction = {
        accessibilityLabel: '开始语音',
        icon: 'microphone',
        label: '开始语音',
        onPress: actions.start,
      };
    }
  }

  const showBusyCancel =
    showActions && busy && snapshot.status !== 'PREPARING_MODEL';
  const showStatus = status !== undefined;
  const statusContainsPartial =
    partialText.length > 0 &&
    (snapshot.status === 'LISTENING' || snapshot.status === 'PROCESSING');

  if (
    !showStatus &&
    primaryAction === undefined &&
    secondaryAction === undefined &&
    !showBusyCancel
  ) {
    return null;
  }

  const renderAction = (spec: ActionSpec, primary: boolean) => (
    <Pressable
      accessibilityLabel={spec.accessibilityLabel}
      accessibilityRole="button"
      key={spec.accessibilityLabel}
      onPress={spec.onPress}
      style={[
        styles.action,
        primary ? styles.primary : styles.secondary,
        spec.tone === 'warning' &&
          (primary ? styles.warningPrimary : styles.warningSecondary),
      ]}
    >
      <View style={styles.buttonContent}>
        <MaterialDesignIcons
          color={
            primary
              ? colors.white
              : spec.tone === 'warning'
                ? colors.warningText
                : colors.brandPressed
          }
          name={spec.icon}
          size={20}
        />
        <Text
          style={[
            primary ? styles.primaryText : styles.secondaryText,
            !primary && spec.tone === 'warning' && styles.warningSecondaryText,
          ]}
        >
          {spec.label}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {showStatus ? (
        <View
          accessibilityLabel={status}
          accessibilityLiveRegion={statusContainsPartial ? 'none' : 'polite'}
          accessible
          style={[
            styles.status,
            listening && styles.listeningStatus,
            error !== undefined &&
              (localCapabilityNotice
                ? styles.capabilityStatus
                : styles.errorStatus),
          ]}
        >
          {busy ? (
            <ActivityIndicator
              accessible={false}
              color={colors.brand}
              size="small"
            />
          ) : null}
          <MaterialDesignIcons
            color={
              error === undefined || localCapabilityNotice
                ? colors.brand
                : colors.expenseText
            }
            name={
              listening
                ? 'waveform'
                : error === undefined
                  ? 'microphone-outline'
                  : localCapabilityNotice
                    ? 'information-outline'
                    : 'alert-circle-outline'
            }
            size={20}
          />
          <Text
            style={[
              styles.statusText,
              error !== undefined && !localCapabilityNotice && styles.errorText,
            ]}
          >
            {status}
          </Text>
        </View>
      ) : null}

      {primaryAction === undefined ? null : renderAction(primaryAction, true)}
      {secondaryAction === undefined
        ? null
        : renderAction(secondaryAction, false)}
      {showBusyCancel ? (
        <Pressable
          accessibilityLabel="取消语音"
          accessibilityRole="button"
          onPress={actions.cancel}
          style={[styles.action, styles.secondary]}
        >
          <Text style={styles.secondaryText}>取消</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  status: {
    minHeight: control.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  listeningStatus: { borderWidth: 1, borderColor: colors.brand },
  capabilityStatus: {
    borderWidth: 1,
    borderColor: colors.brandMuted,
    backgroundColor: colors.brandSoft,
  },
  errorStatus: { backgroundColor: colors.expenseSoft },
  statusText: {
    minWidth: 0,
    flex: 1,
    color: colors.inkSecondary,
    fontSize: typography.body,
    lineHeight: 21,
  },
  errorText: { color: colors.expenseText },
  action: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  primary: { backgroundColor: colors.brand },
  warningPrimary: { backgroundColor: colors.warning },
  primaryText: {
    color: colors.white,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondary: {
    borderWidth: 1,
    borderColor: colors.brandMuted,
    backgroundColor: colors.surface,
  },
  warningSecondary: {
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  secondaryText: {
    color: colors.brandPressed,
    fontSize: typography.body,
    fontWeight: '800',
    textAlign: 'center',
  },
  warningSecondaryText: { color: colors.warningText },
});
