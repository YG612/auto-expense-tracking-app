import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { VoiceEntryPanel } from '../features/smart-entry/components/VoiceEntryPanel';
import type { SpeechRecognitionActions } from '../speech/useSpeechRecognition';
import type { SpeechRecognitionSnapshot } from '../speech/types';
import { colors } from '../theme/tokens';

function actions(): jest.Mocked<SpeechRecognitionActions> {
  return {
    start: jest.fn(),
    continueDictation: jest.fn(),
    stop: jest.fn(),
    cancel: jest.fn(),
    retry: jest.fn(),
    downloadModel: jest.fn(),
    useNetworkAndRetry: jest.fn(),
    openSettings: jest.fn(),
    consumeResult: jest.fn(),
    resetForNewDraft: jest.fn(),
    recheck: jest.fn(),
  };
}

function snapshot(
  overrides: Partial<SpeechRecognitionSnapshot> = {},
): SpeechRecognitionSnapshot {
  return {
    draftGeneration: 0,
    turnGeneration: 0,
    status: 'IDLE',
    partialText: '',
    usingNetworkFallback: false,
    ...overrides,
  };
}

describe('voice entry panel', () => {
  it('offers one contextual start action only after the user presses it', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot()}
      />,
    );

    expect(handlers.start).not.toHaveBeenCalled();
    expect(panel.getAllByRole('button')).toHaveLength(1);
    await fireEvent.press(panel.getByRole('button', { name: '开始语音' }));
    expect(handlers.start).toHaveBeenCalledTimes(1);
  });

  it('can suppress speech actions while typed text owns the primary action', async () => {
    const panel = await render(
      <VoiceEntryPanel
        actions={actions()}
        onUsePartial={jest.fn()}
        showActions={false}
        snapshot={snapshot()}
      />,
    );

    expect(panel.queryAllByRole('button')).toHaveLength(0);
  });

  it('shows partial text without a live announcement and keeps stop and cancel separate', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'LISTENING',
          partialText: '午饭二十五微信付的',
        })}
      />,
    );

    const partial = panel.getByText('午饭二十五微信付的');
    expect(partial.parent?.props.accessibilityLiveRegion).toBe('none');
    await fireEvent.press(panel.getByRole('button', { name: '说完了' }));
    await fireEvent.press(panel.getByRole('button', { name: '取消' }));
    expect(handlers.stop).toHaveBeenCalledTimes(1);
    expect(handlers.cancel).toHaveBeenCalledTimes(1);
  });

  it('makes model download primary and labels the secondary network route explicitly', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'ERROR',
          error: {
            code: 'model-missing',
            message: '本地中文模型不可用。',
            canRetry: true,
            canUseNetwork: true,
            canDownloadModel: true,
            canOpenSettings: false,
            modelState: 'DOWNLOADABLE',
          },
        })}
      />,
    );

    await fireEvent.press(panel.getByRole('button', { name: '下载中文语音' }));
    expect(handlers.downloadModel).toHaveBeenCalledTimes(1);
    await fireEvent.press(
      panel.getByRole('button', { name: '使用可能联网的系统语音' }),
    );
    expect(handlers.useNetworkAndRetry).toHaveBeenCalledTimes(1);
    expect(panel.queryByRole('button', { name: '重试语音' })).toBeNull();
  });

  it('renders a missing local Mandarin model as a capability notice instead of a red failure', async () => {
    const message = '本机未检测到可用的离线普通话语音模型。';
    const panel = await render(
      <VoiceEntryPanel
        actions={actions()}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'ERROR',
          stage: 'capability',
          modelState: 'UNSUPPORTED',
          error: {
            code: 'language-not-supported',
            message,
            canRetry: false,
            canUseNetwork: true,
            canDownloadModel: false,
            canOpenSettings: false,
            stage: 'capability',
            modelState: 'UNSUPPORTED',
          },
        })}
      />,
    );

    const notice = panel.getByLabelText(message);
    expect(StyleSheet.flatten(notice.props.style)).toMatchObject({
      backgroundColor: colors.brandSoft,
      borderColor: colors.brandMuted,
    });
    expect(
      StyleSheet.flatten(panel.getByText(message).props.style).color,
    ).not.toBe(colors.expenseText);
  });

  it('passively rechecks a downloading model without starting audio or networking', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'PREPARING_MODEL',
          modelState: 'DOWNLOADING',
          canRecheck: true,
        })}
      />,
    );

    expect(panel.getAllByRole('button')).toHaveLength(1);
    await fireEvent.press(
      panel.getByRole('button', { name: '检查语音包是否就绪' }),
    );
    expect(handlers.recheck).toHaveBeenCalledTimes(1);
    expect(handlers.start).not.toHaveBeenCalled();
    expect(handlers.retry).not.toHaveBeenCalled();
    expect(handlers.useNetworkAndRetry).not.toHaveBeenCalled();
    expect(handlers.cancel).not.toHaveBeenCalled();
  });

  it('offers one explicit possible-network action for an incompatible OEM service', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'ERROR',
          error: {
            code: 'service-incompatible',
            message: '当前语音服务不兼容。',
            canRetry: true,
            canUseNetwork: true,
            canDownloadModel: false,
            canOpenSettings: false,
          },
        })}
      />,
    );

    expect(panel.getAllByRole('button')).toHaveLength(1);
    await fireEvent.press(
      panel.getByRole('button', { name: '使用可能联网的系统语音' }),
    );
    expect(handlers.useNetworkAndRetry).toHaveBeenCalledTimes(1);
  });

  it('prioritizes usable partial text over every speech retry route', async () => {
    const handlers = actions();
    const onUsePartial = jest.fn();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={onUsePartial}
        snapshot={snapshot({
          status: 'ERROR',
          partialText: '水果三十二',
          resultToken: 'result-partial',
          hasFreshTurnEvidence: true,
          error: {
            code: 'network',
            message: '网络失败。',
            canRetry: true,
            canUseNetwork: true,
            canDownloadModel: true,
            canOpenSettings: false,
          },
        })}
      />,
    );

    expect(panel.getAllByRole('button')).toHaveLength(1);
    await fireEvent.press(
      panel.getByRole('button', { name: '使用已转写文字继续' }),
    );
    expect(onUsePartial).toHaveBeenCalledWith('水果三十二', 'result-partial');
    expect(handlers.retry).not.toHaveBeenCalled();
    expect(handlers.useNetworkAndRetry).not.toHaveBeenCalled();
  });

  it('labels a same-route network retry without implying offline recognition', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'ERROR',
          usingNetworkFallback: true,
          error: {
            code: 'network',
            message: '系统语音输入暂时失败。',
            canRetry: true,
            canUseNetwork: false,
            canDownloadModel: false,
            canOpenSettings: false,
          },
        })}
      />,
    );

    await fireEvent.press(
      panel.getByRole('button', { name: '再次使用系统语音（可能联网）' }),
    );
    expect(handlers.retry).toHaveBeenCalledTimes(1);
  });

  it('discloses possible network use and provider-controlled ending while listening', async () => {
    const panel = await render(
      <VoiceEntryPanel
        actions={actions()}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'LISTENING',
          usingNetworkFallback: true,
          mayUseNetwork: true,
          provider: 'android-direct-system',
          route: 'direct-system',
        })}
      />,
    );

    expect(
      panel.getByText('正在听（系统服务可能联网，也可能自动结束）'),
    ).toBeTruthy();
    expect(panel.getByRole('button', { name: '说完了' })).toBeTruthy();
  });

  it('keeps an automatically ended segment in the app until the user continues or accepts it', async () => {
    const handlers = actions();
    const onUsePartial = jest.fn();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={onUsePartial}
        snapshot={snapshot({
          status: 'SUCCEEDED',
          finalText: '下午去商场买两瓶牛奶花了25元',
          resultToken: 'result-ended',
          hasFreshTurnEvidence: true,
          canContinue: true,
          endReason: 'provider-endpoint',
          captureOwnership: 'system-provider',
          endpointOwnership: 'system-provider',
        })}
      />,
    );

    expect(
      panel.getByText('系统语音已结束本段。你可以继续说，或使用当前文字。'),
    ).toBeTruthy();
    await fireEvent.press(panel.getByRole('button', { name: '继续说' }));
    expect(handlers.continueDictation).toHaveBeenCalledTimes(1);
    expect(onUsePartial).not.toHaveBeenCalled();
    await fireEvent.press(panel.getByRole('button', { name: '使用这段文字' }));
    expect(onUsePartial).toHaveBeenCalledWith(
      '下午去商场买两瓶牛奶花了25元',
      'result-ended',
    );
  });

  it('does not expose stale text without fresh result ownership', async () => {
    const panel = await render(
      <VoiceEntryPanel
        actions={actions()}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'ERROR',
          partialText: '上一笔网吧10元',
          resultToken: 'result-from-previous-draft',
          hasFreshTurnEvidence: false,
          error: {
            code: 'no-speech',
            message: '没有听清有效内容。',
            canRetry: true,
            canUseNetwork: false,
            canDownloadModel: false,
            canOpenSettings: false,
          },
        })}
      />,
    );

    expect(
      panel.queryByRole('button', { name: '使用已转写文字继续' }),
    ).toBeNull();
  });

  it('uses settings as the only recovery when system privacy blocks recognition', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'ERROR',
          error: {
            code: 'permission-blocked',
            message: '系统麦克风隐私控制阻止了语音识别。',
            canRetry: false,
            canUseNetwork: false,
            canDownloadModel: false,
            canOpenSettings: true,
          },
        })}
      />,
    );

    expect(panel.getAllByRole('button')).toHaveLength(1);
    await fireEvent.press(panel.getByRole('button', { name: '打开权限设置' }));
    expect(handlers.openSettings).toHaveBeenCalledTimes(1);
  });

  it('passively rechecks after the user re-enables the system microphone', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'ERROR',
          error: {
            code: 'microphone-disabled',
            message: '系统总麦克风开关已关闭。',
            canRetry: false,
            canUseNetwork: false,
            canDownloadModel: false,
            canOpenSettings: false,
            canRecheck: true,
          },
        })}
      />,
    );

    expect(panel.getAllByRole('button')).toHaveLength(1);
    await fireEvent.press(
      panel.getByRole('button', { name: '我已开启，重新检测' }),
    );
    expect(handlers.recheck).toHaveBeenCalledTimes(1);
    expect(handlers.start).not.toHaveBeenCalled();
    expect(handlers.retry).not.toHaveBeenCalled();
    expect(handlers.useNetworkAndRetry).not.toHaveBeenCalled();
  });
});
