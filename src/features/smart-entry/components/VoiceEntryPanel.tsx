import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons/static';
import { useEffect, useState, type ComponentProps } from 'react';
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
        (snapshot.endpointHinted === true
          ? '似乎说完了，可点击“说完了”进行识别'
          : undefined) ||
        (possibleNetworkRoute
          ? '正在听（系统服务可能联网，也可能自动结束）'
          : '正在听，请说出金额和用途')
      );
    case 'PROCESSING':
      return (
        snapshot.partialText ||
        (possibleNetworkRoute
          ? '系统语音正在完成转写（可能联网）…'
          : '正在识别…')
      );
    case 'SUCCEEDED':
      if (snapshot.canContinue === true && snapshot.finalText) {
        return '系统语音已结束本段。你可以继续说，或使用当前文字。';
      }
      if (snapshot.finalText) {
        const quality = snapshot.audioQuality;
        const warning =
          quality !== undefined && quality.clippingRatio >= 0.05
            ? '；录音存在削波，请重点核对金额'
            : quality?.noiseTooHigh === true
              ? '；环境噪声较高，请核对识别内容'
              : '';
        return `已转为文字：${snapshot.finalText}${warning}`;
      }
      return undefined;
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
  const [listeningSeconds, setListeningSeconds] = useState(0);
  const busy = BUSY_STATUSES.includes(
    snapshot.status as (typeof BUSY_STATUSES)[number],
  );
  const listening = snapshot.status === 'LISTENING';
  const models = actions.models ?? [];
  const modelSessionBusy = [
    'REQUESTING_PERMISSION',
    'STARTING',
    'PROCESSING',
  ].includes(snapshot.status);
  const modelSelectionDisabled =
    modelSessionBusy || listening || actions.modelSwitching === true;
  useEffect(() => {
    if (!listening) {
      setListeningSeconds(0);
      return undefined;
    }
    const startedAt = Date.now();
    const timer = setInterval(
      () => setListeningSeconds(Math.min(30, (Date.now() - startedAt) / 1_000)),
      250,
    );
    return () => clearInterval(timer);
  }, [listening]);
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
    !showBusyCancel &&
    models.length <= 1
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
      {models.length > 1 ? (
        <View accessibilityLabel="离线语音模型" style={styles.modelPicker}>
          <View style={styles.modelHeadingRow}>
            <Text style={styles.modelHeading}>测试模型</Text>
            <Text style={styles.modelHint}>
              {actions.modelSwitching === true ? '正在加载…' : '录音前可切换'}
            </Text>
          </View>
          <View style={styles.modelGrid}>
            {models.map(model => {
              const selected = actions.selectedModelId === model.id;
              const sizeMiB = model.compressedSizeBytes / (1024 * 1024);
              return (
                <Pressable
                  accessibilityLabel={`选择语音模型 ${model.label}`}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: modelSelectionDisabled,
                    selected,
                  }}
                  disabled={modelSelectionDisabled || selected}
                  key={model.id}
                  onPress={() => actions.selectModel?.(model.id)}
                  style={[
                    styles.modelCard,
                    selected && styles.modelCardSelected,
                    modelSelectionDisabled && styles.modelCardDisabled,
                  ]}
                >
                  <View style={styles.modelLabelRow}>
                    <Text
                      style={[
                        styles.modelLabel,
                        selected && styles.modelLabelSelected,
                      ]}
                    >
                      {model.label}
                    </Text>
                    {selected ? (
                      <MaterialDesignIcons
                        color={colors.brand}
                        name="check-circle"
                        size={17}
                      />
                    ) : null}
                  </View>
                  <Text style={styles.modelDescription}>
                    {model.description}
                  </Text>
                  <Text style={styles.modelSize}>
                    {sizeMiB.toFixed(1)} MiB 压缩包
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {actions.modelSwitchError === undefined ? null : (
            <Text
              accessibilityLiveRegion="polite"
              style={styles.modelSwitchError}
            >
              {actions.modelSwitchError}
            </Text>
          )}
        </View>
      ) : null}

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

      {listening && snapshot.captureOwnership === 'app' ? (
        <View
          accessibilityLabel={`录音 ${listeningSeconds.toFixed(1)} 秒，最长 30 秒`}
        >
          <View accessible={false} style={styles.waveform}>
            {Array.from({ length: 12 }, (_, index) => {
              const level = snapshot.volumeLevel ?? 0;
              const active = level * 12 >= index + 1;
              return (
                <View
                  key={index}
                  style={[
                    styles.waveBar,
                    { height: 6 + ((index * 7) % 16) },
                    active && styles.waveBarActive,
                  ]}
                />
              );
            })}
          </View>
          <Text style={styles.recordingTime}>
            {listeningSeconds.toFixed(1)} 秒 / 30 秒
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
  modelPicker: {
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandMuted,
    backgroundColor: colors.surface,
    padding: spacing.sm,
  },
  modelHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  modelHeading: {
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '800',
  },
  modelHint: { color: colors.inkSecondary, fontSize: typography.caption },
  modelGrid: { gap: spacing.xs },
  modelCard: {
    gap: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  modelCardSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  modelCardDisabled: { opacity: 0.65 },
  modelLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  modelLabel: {
    flex: 1,
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '700',
  },
  modelLabelSelected: { color: colors.brandPressed },
  modelDescription: {
    color: colors.inkSecondary,
    fontSize: typography.caption,
  },
  modelSize: { color: colors.inkMuted, fontSize: typography.caption },
  modelSwitchError: {
    color: colors.expenseText,
    fontSize: typography.caption,
  },
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
  waveform: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  waveBar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: colors.brandMuted,
    opacity: 0.45,
  },
  waveBarActive: { backgroundColor: colors.brand, opacity: 1 },
  recordingTime: {
    color: colors.inkSecondary,
    fontSize: typography.caption,
    textAlign: 'center',
  },
});
