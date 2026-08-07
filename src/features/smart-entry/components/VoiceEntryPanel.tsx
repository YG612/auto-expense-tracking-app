import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons/static';
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
  onUsePartial: (text: string) => void;
};

const SUSPICIOUS_COMPONENT_MARKERS = [
  'trampoline',
  'bridge',
  'proxy',
  'stub',
  'forwarder',
];

function isSuspiciousEngine(engine: {
  component: string;
  suspicious?: boolean;
}): boolean {
  if (engine.suspicious === true) {
    return true;
  }
  const lowered = engine.component.toLowerCase();
  return SUSPICIOUS_COMPONENT_MARKERS.some(marker => lowered.includes(marker));
}

const BUSY_STATUSES = [
  'CHECKING_AVAILABILITY',
  'REQUESTING_PERMISSION',
  'STARTING',
  'PROCESSING',
] as const;

function statusText(snapshot: SpeechRecognitionSnapshot): string {
  switch (snapshot.status) {
    case 'CHECKING_AVAILABILITY':
      return '正在检查设备语音能力…';
    case 'REQUESTING_PERMISSION':
      return '等待系统语音权限…';
    case 'STARTING':
      return '正在打开麦克风…';
    case 'LISTENING':
      return snapshot.partialText || '正在听，请说出金额、用途、账户和时间';
    case 'PROCESSING':
      return snapshot.partialText || '正在完成系统语音转写…';
    case 'SUCCEEDED':
      return `已转写：${snapshot.finalText ?? ''}`;
    case 'CANCELLED':
      return '已取消，本次语音没有生成候选或写入账本。';
    case 'ERROR':
      return snapshot.error?.message ?? '语音识别暂时失败。';
    default:
      return '点按后说出一笔或多笔账，例如“午饭二十五，微信付的”。';
  }
}

export function VoiceEntryPanel({ snapshot, actions, onUsePartial }: Props) {
  const busy = BUSY_STATUSES.includes(
    snapshot.status as (typeof BUSY_STATUSES)[number],
  );
  const listening = snapshot.status === 'LISTENING';
  const error = snapshot.status === 'ERROR' ? snapshot.error : undefined;
  const canStart = ['IDLE', 'SUCCEEDED', 'CANCELLED', 'ERROR'].includes(
    snapshot.status,
  );
  const failedEngineIds = snapshot.failedEngineIds ?? [];
  const visibleEngines =
    snapshot.engines?.filter(engine => !isSuspiciousEngine(engine)) ?? [];
  const usableEngines = visibleEngines.filter(
    engine => !failedEngineIds.includes(engine.id),
  );
  const offerEngineChoice =
    error !== undefined &&
    usableEngines.length > 0 &&
    (error.canUseNetwork === true || error.code === 'service-unavailable');
  const showNoUsableEngine =
    error !== undefined &&
    usableEngines.length === 0 &&
    (error.canUseNetwork === true || error.code === 'service-unavailable');

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          <Text accessibilityRole="header" style={styles.title}>
            语音记账
          </Text>
          <Text style={styles.badge}>系统识别 · 本地优先</Text>
        </View>
        <View style={styles.microphoneIcon}>
          <MaterialDesignIcons
            color={colors.brand}
            name={listening ? 'waveform' : 'microphone-outline'}
            size={25}
          />
        </View>
      </View>

      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.status,
          listening && styles.listeningStatus,
          error !== undefined && styles.errorStatus,
        ]}
      >
        {busy ? <ActivityIndicator color={colors.brand} size="small" /> : null}
        <Text
          accessibilityRole={error === undefined ? undefined : 'alert'}
          style={[styles.statusText, error !== undefined && styles.errorText]}
        >
          {statusText(snapshot)}
        </Text>
      </View>

      {listening ? (
        <View style={styles.row}>
          <Pressable
            accessibilityLabel="说完了"
            accessibilityRole="button"
            onPress={actions.stop}
            style={[styles.action, styles.primary]}
          >
            <View style={styles.buttonContent}>
              <MaterialDesignIcons
                color={colors.white}
                name="check"
                size={19}
              />
              <Text
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1.6}
                minimumFontScale={0.75}
                numberOfLines={1}
                style={styles.primaryText}
              >
                说完了
              </Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel="取消"
            accessibilityRole="button"
            onPress={actions.cancel}
            style={[styles.action, styles.secondary]}
          >
            <View style={styles.buttonContent}>
              <MaterialDesignIcons
                color={colors.brand}
                name="close"
                size={19}
              />
              <Text
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1.6}
                minimumFontScale={0.75}
                numberOfLines={1}
                style={styles.secondaryText}
              >
                取消
              </Text>
            </View>
          </Pressable>
        </View>
      ) : busy ? (
        <Pressable
          accessibilityLabel="取消本次语音"
          accessibilityRole="button"
          onPress={actions.cancel}
          style={[styles.action, styles.secondary]}
        >
          <Text
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.6}
            minimumFontScale={0.75}
            numberOfLines={1}
            style={styles.secondaryText}
          >
            取消本次语音
          </Text>
        </Pressable>
      ) : null}

      {canStart &&
      error?.canUseNetwork !== true &&
      (error === undefined || error.canRetry) ? (
        <Pressable
          accessibilityLabel={
            snapshot.status === 'ERROR' ? '重试语音识别' : '开始语音记账'
          }
          accessibilityRole="button"
          onPress={error?.canRetry === true ? actions.retry : actions.start}
          style={[styles.action, styles.primary]}
        >
          <View style={styles.buttonContent}>
            <MaterialDesignIcons
              color={colors.white}
              name={snapshot.status === 'ERROR' ? 'refresh' : 'microphone'}
              size={20}
            />
            <Text
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.6}
              minimumFontScale={0.75}
              numberOfLines={1}
              style={styles.primaryText}
            >
              {snapshot.status === 'ERROR' ? '重试语音识别' : '开始语音记账'}
            </Text>
          </View>
        </Pressable>
      ) : null}

      {error?.canUseNetwork === true ? (
        <Pressable
          accessibilityLabel="使用系统语音输入"
          accessibilityRole="button"
          onPress={actions.useNetworkAndRetry}
          style={[styles.action, styles.networkAction]}
        >
          <View style={styles.buttonContent}>
            <MaterialDesignIcons
              color={colors.warning}
              name="account-voice"
              size={20}
            />
            <Text
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.6}
              minimumFontScale={0.75}
              numberOfLines={1}
              style={styles.networkText}
            >
              使用系统语音输入
            </Text>
          </View>
        </Pressable>
      ) : null}

      {offerEngineChoice ? (
        <View style={styles.engineSection}>
          <Text style={styles.engineTitle}>选择语音识别引擎</Text>
          {visibleEngines.map(engine => {
            const failed = failedEngineIds.includes(engine.id);
            return (
              <Pressable
                accessibilityLabel={`使用${engine.label}`}
                accessibilityRole="button"
                disabled={failed}
                key={engine.id}
                onPress={() => actions.selectEngine(engine.id)}
                style={[
                  styles.engineOption,
                  failed && styles.engineOptionFailed,
                  snapshot.selectedEngineId === engine.id &&
                    styles.engineOptionSelected,
                ]}
              >
                <View style={styles.engineOptionContent}>
                  <MaterialDesignIcons
                    color={failed ? colors.inkMuted : colors.brand}
                    name={
                      engine.type === 'activity' ? 'open-in-new' : 'cog-outline'
                    }
                    size={17}
                  />
                  <Text
                    adjustsFontSizeToFit
                    maxFontSizeMultiplier={1.4}
                    minimumFontScale={0.8}
                    numberOfLines={1}
                    style={[
                      styles.engineOptionText,
                      failed && styles.engineOptionTextFailed,
                    ]}
                  >
                    {engine.label}
                  </Text>
                </View>
                {engine.isDefault ? (
                  <Text style={styles.engineBadge}>默认</Text>
                ) : null}
                {engine.supportsOnDevice ? (
                  <Text style={styles.engineBadge}>本地</Text>
                ) : null}
                {failed ? (
                  <Text style={styles.engineBadgeFailed}>不可用</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {showNoUsableEngine ? (
        <View style={styles.engineSection}>
          <Text style={styles.engineTitle}>当前没有可用的语音识别引擎</Text>
          <Text style={styles.engineHint}>
            检测到的引擎都无法完成识别。请安装
            Google「语音识别与合成」并下载中文离线包,或安装讯飞/百度输入法并开启「系统语音」;安装后重新检测即可使用。
          </Text>
          <Pressable
            accessibilityLabel="重新检测语音引擎"
            accessibilityRole="button"
            onPress={actions.start}
            style={[styles.action, styles.primary]}
          >
            <Text
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.6}
              minimumFontScale={0.75}
              numberOfLines={1}
              style={styles.primaryText}
            >
              重新检测
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="前往语音输入设置"
            accessibilityRole="button"
            onPress={actions.openVoiceInputSettings}
            style={[styles.action, styles.secondary]}
          >
            <Text
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.6}
              minimumFontScale={0.75}
              numberOfLines={1}
              style={styles.secondaryText}
            >
              前往语音输入设置
            </Text>
          </Pressable>
        </View>
      ) : null}

      {error?.canOpenSettings === true ? (
        <Pressable
          accessibilityLabel="前往系统设置"
          accessibilityRole="button"
          onPress={actions.openSettings}
          style={[styles.action, styles.secondary]}
        >
          <Text
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.6}
            minimumFontScale={0.75}
            numberOfLines={1}
            style={styles.secondaryText}
          >
            前往系统设置
          </Text>
        </Pressable>
      ) : null}

      {error !== undefined && snapshot.partialText.length > 0 ? (
        <Pressable
          accessibilityLabel="使用屏幕上的文字继续解析"
          accessibilityRole="button"
          onPress={() => onUsePartial(snapshot.partialText)}
          style={styles.textAction}
        >
          <Text style={styles.textActionText}>使用屏幕上的文字继续解析</Text>
        </Pressable>
      ) : null}

      <Text style={styles.privacy}>
        只把最终转写文字送入本地记账解析，App
        不创建或保存录音文件。设备没有本地中文模型或限制直接调用时，只有你明确点击后才打开可能联网的系统语音输入。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.brandMuted,
    backgroundColor: colors.brandSoft,
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  titleGroup: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  badge: {
    flexShrink: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.brandMuted,
    color: colors.brandPressed,
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  microphoneIcon: {
    flexShrink: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  status: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: 12,
  },
  listeningStatus: { borderWidth: 1, borderColor: colors.brand },
  errorStatus: { backgroundColor: colors.expenseSoft },
  statusText: {
    flex: 1,
    color: colors.inkSecondary,
    fontSize: typography.body,
    lineHeight: 21,
  },
  errorText: { color: colors.expenseText },
  row: { flexDirection: 'row', gap: 9 },
  action: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  primary: { flex: 1, backgroundColor: colors.brand },
  primaryText: {
    color: colors.white,
    fontSize: typography.body,
    fontWeight: '800',
  },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.brandMuted,
    backgroundColor: colors.surface,
  },
  secondaryText: {
    color: colors.brandPressed,
    fontSize: typography.body,
    fontWeight: '800',
  },
  networkAction: {
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  networkText: {
    color: colors.warningText,
    fontSize: 13,
    fontWeight: '800',
  },
  engineSection: { gap: spacing.xs },
  engineTitle: {
    color: colors.inkSecondary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  engineOption: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandMuted,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  engineOptionSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  engineOptionFailed: {
    opacity: 0.55,
    borderColor: colors.inkMuted,
  },
  engineOptionContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  engineOptionText: {
    flex: 1,
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '600',
  },
  engineOptionTextFailed: { color: colors.inkMuted },
  engineBadge: {
    borderRadius: radius.pill,
    backgroundColor: colors.brandMuted,
    color: colors.brandPressed,
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  engineBadgeFailed: {
    borderRadius: radius.pill,
    backgroundColor: colors.inkMuted,
    color: colors.surface,
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  engineHint: {
    color: colors.inkSecondary,
    fontSize: typography.caption,
    lineHeight: 17,
  },
  textAction: { alignItems: 'center', paddingVertical: 5 },
  textActionText: {
    color: colors.brandPressed,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  privacy: { color: colors.inkMuted, fontSize: 11, lineHeight: 17 },
});
