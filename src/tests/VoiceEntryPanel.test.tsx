import { fireEvent, render } from '@testing-library/react-native';

import { VoiceEntryPanel } from '../features/smart-entry/components/VoiceEntryPanel';
import type { SpeechRecognitionActions } from '../speech/useSpeechRecognition';
import type { SpeechRecognitionSnapshot } from '../speech/types';

function actions(): jest.Mocked<SpeechRecognitionActions> {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    cancel: jest.fn(),
    retry: jest.fn(),
    useNetworkAndRetry: jest.fn(),
    openSettings: jest.fn(),
  };
}

function snapshot(
  overrides: Partial<SpeechRecognitionSnapshot> = {},
): SpeechRecognitionSnapshot {
  return {
    status: 'IDLE',
    partialText: '',
    usingNetworkFallback: false,
    ...overrides,
  };
}

describe('voice entry panel', () => {
  it('starts only after the user presses the voice button', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot()}
      />,
    );
    expect(handlers.start).not.toHaveBeenCalled();
    await fireEvent.press(panel.getByRole('button', { name: '开始语音记账' }));
    expect(handlers.start).toHaveBeenCalledTimes(1);
    expect(panel.getByText(/App 不创建或保存录音文件/)).toBeOnTheScreen();
  });

  it('shows partial text and keeps stop and cancel as separate actions', async () => {
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
    expect(panel.getByText('午饭二十五微信付的')).toBeOnTheScreen();
    await fireEvent.press(panel.getByRole('button', { name: '说完了' }));
    await fireEvent.press(panel.getByRole('button', { name: '取消' }));
    expect(handlers.stop).toHaveBeenCalledTimes(1);
    expect(handlers.cancel).toHaveBeenCalledTimes(1);
  });

  it('requires a distinct action to allow possible network recognition', async () => {
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
            canOpenSettings: false,
          },
        })}
      />,
    );
    expect(panel.queryByRole('button', { name: '重试语音识别' })).toBeNull();
    await fireEvent.press(
      panel.getByRole('button', { name: '使用系统语音输入' }),
    );
    expect(handlers.useNetworkAndRetry).toHaveBeenCalledTimes(1);
  });

  it('offers the OEM system input instead of sending granted users back to settings', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'ERROR',
          error: {
            code: 'service-incompatible',
            message: '麦克风权限已开启，请改用系统语音输入。',
            canRetry: true,
            canUseNetwork: true,
            canOpenSettings: false,
          },
        })}
      />,
    );

    expect(panel.queryByRole('button', { name: '前往系统设置' })).toBeNull();
    await fireEvent.press(
      panel.getByRole('button', { name: '使用系统语音输入' }),
    );
    expect(handlers.useNetworkAndRetry).toHaveBeenCalledTimes(1);
  });

  it('can explicitly continue with partial text after a recoverable error', async () => {
    const handlers = actions();
    const onUsePartial = jest.fn();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={onUsePartial}
        snapshot={snapshot({
          status: 'ERROR',
          partialText: '水果三十二',
          error: {
            code: 'network',
            message: '网络失败。',
            canRetry: true,
            canUseNetwork: false,
            canOpenSettings: false,
          },
        })}
      />,
    );
    await fireEvent.press(
      panel.getByRole('button', { name: '使用屏幕上的文字继续解析' }),
    );
    expect(onUsePartial).toHaveBeenCalledWith('水果三十二');
  });

  it('does not offer a futile retry when system privacy blocks recognition', async () => {
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
            canOpenSettings: true,
          },
        })}
      />,
    );

    expect(panel.queryByRole('button', { name: '重试语音识别' })).toBeNull();
    await fireEvent.press(panel.getByRole('button', { name: '前往系统设置' }));
    expect(handlers.openSettings).toHaveBeenCalledTimes(1);
  });
});
