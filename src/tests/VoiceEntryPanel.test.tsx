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
    selectEngine: jest.fn(),
    openSettings: jest.fn(),
    openVoiceInputSettings: jest.fn(),
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
            canOpenVoiceInputSettings: false,
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
            canOpenVoiceInputSettings: false,
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
            canOpenVoiceInputSettings: false,
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
            canOpenVoiceInputSettings: false,
          },
        })}
      />,
    );

    expect(panel.queryByRole('button', { name: '重试语音识别' })).toBeNull();
    await fireEvent.press(panel.getByRole('button', { name: '前往系统设置' }));
    expect(handlers.openSettings).toHaveBeenCalledTimes(1);
  });

  it('lists detected engines and lets the user select one', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'ERROR',
          engines: [
            {
              id: 'service:com.example.ime/.SpeechService',
              type: 'service',
              label: '示例输入法语音',
              packageName: 'com.example.ime',
              component: 'com.example.ime/.SpeechService',
              isDefault: true,
              supportsOnDevice: false,
            },
            {
              id: 'activity:com.example.assistant/.SpeechActivity',
              type: 'activity',
              label: '示例语音输入',
              packageName: 'com.example.assistant',
              component: 'com.example.assistant/.SpeechActivity',
              isDefault: false,
              supportsOnDevice: false,
            },
          ],
          error: {
            code: 'model-missing',
            message: '本地中文模型不可用。',
            canRetry: true,
            canUseNetwork: true,
            canOpenSettings: false,
            canOpenVoiceInputSettings: false,
          },
        })}
      />,
    );

    expect(panel.getByText('选择语音识别引擎')).toBeOnTheScreen();
    await fireEvent.press(
      panel.getByRole('button', { name: '使用示例输入法语音' }),
    );
    await fireEvent.press(
      panel.getByRole('button', { name: '使用示例语音输入' }),
    );
    expect(handlers.selectEngine).toHaveBeenNthCalledWith(
      1,
      'service:com.example.ime/.SpeechService',
    );
    expect(handlers.selectEngine).toHaveBeenNthCalledWith(
      2,
      'activity:com.example.assistant/.SpeechActivity',
    );
  });

  it('hides suspicious trampoline engines from the selector', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'ERROR',
          engines: [
            {
              id: 'service:com.arlosoft.macrodroid/.voiceservice.RecognitionServiceTrampoline',
              type: 'service',
              label: 'RecognitionServiceTrampoline',
              packageName: 'com.arlosoft.macrodroid',
              component:
                'com.arlosoft.macrodroid/.voiceservice.RecognitionServiceTrampoline',
              isDefault: true,
              supportsOnDevice: false,
              suspicious: true,
            },
            {
              id: 'service:com.google.example/.SpeechService',
              type: 'service',
              label: 'Google 语音',
              packageName: 'com.google.example',
              component: 'com.google.example/.SpeechService',
              isDefault: false,
              supportsOnDevice: false,
            },
          ],
          error: {
            code: 'model-missing',
            message: '本地中文模型不可用。',
            canRetry: true,
            canUseNetwork: true,
            canOpenSettings: false,
            canOpenVoiceInputSettings: false,
          },
        })}
      />,
    );

    expect(
      panel.queryByRole('button', {
        name: '使用RecognitionServiceTrampoline',
      }),
    ).toBeNull();
    await fireEvent.press(
      panel.getByRole('button', { name: '使用Google 语音' }),
    );
    expect(handlers.selectEngine).toHaveBeenCalledWith(
      'service:com.google.example/.SpeechService',
    );
  });

  it('marks a failed engine as unavailable while keeping usable engines selectable', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'ERROR',
          engines: [
            {
              id: 'service:com.example.ime/.SpeechService',
              type: 'service',
              label: '示例输入法语音',
              packageName: 'com.example.ime',
              component: 'com.example.ime/.SpeechService',
              isDefault: true,
              supportsOnDevice: false,
            },
            {
              id: 'service:com.example.assistant/.SpeechService',
              type: 'service',
              label: '示例助手语音',
              packageName: 'com.example.assistant',
              component: 'com.example.assistant/.SpeechService',
              isDefault: false,
              supportsOnDevice: false,
            },
          ],
          selectedEngineId: 'service:com.example.ime/.SpeechService',
          failedEngineIds: ['service:com.example.ime/.SpeechService'],
          error: {
            code: 'service-unavailable',
            message: '没有可用的系统语音识别服务。',
            canRetry: false,
            canUseNetwork: false,
            canOpenSettings: false,
            canOpenVoiceInputSettings: true,
          },
        })}
      />,
    );

    expect(panel.getByText('不可用')).toBeOnTheScreen();
    expect(panel.queryByText('当前没有可用的语音识别引擎')).toBeNull();
    await fireEvent.press(
      panel.getByRole('button', { name: '使用示例输入法语音' }),
    );
    expect(handlers.selectEngine).not.toHaveBeenCalled();
    await fireEvent.press(
      panel.getByRole('button', { name: '使用示例助手语音' }),
    );
    expect(handlers.selectEngine).toHaveBeenCalledWith(
      'service:com.example.assistant/.SpeechService',
    );
  });

  it('shows actionable guidance when every detected engine is unusable', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'ERROR',
          engines: [
            {
              id: 'service:com.arlosoft.macrodroid/.voiceservice.RecognitionServiceTrampoline',
              type: 'service',
              label: 'RecognitionServiceTrampoline',
              packageName: 'com.arlosoft.macrodroid',
              component:
                'com.arlosoft.macrodroid/.voiceservice.RecognitionServiceTrampoline',
              isDefault: true,
              supportsOnDevice: false,
              suspicious: true,
            },
          ],
          error: {
            code: 'model-missing',
            message: '本地中文模型不可用。',
            canRetry: true,
            canUseNetwork: true,
            canOpenSettings: false,
            canOpenVoiceInputSettings: false,
          },
        })}
      />,
    );

    expect(panel.getByText('当前没有可用的语音识别引擎')).toBeOnTheScreen();
    expect(panel.getByText(/安装 Google「语音识别与合成」/)).toBeOnTheScreen();
    expect(
      panel.queryByRole('button', {
        name: '使用RecognitionServiceTrampoline',
      }),
    ).toBeNull();
    await fireEvent.press(
      panel.getByRole('button', { name: '重新检测语音引擎' }),
    );
    expect(handlers.start).toHaveBeenCalledTimes(1);
  });

  it('opens the system voice input settings when no engine is available', async () => {
    const handlers = actions();
    const panel = await render(
      <VoiceEntryPanel
        actions={handlers}
        onUsePartial={jest.fn()}
        snapshot={snapshot({
          status: 'ERROR',
          error: {
            code: 'service-unavailable',
            message: '没有可用的系统语音识别服务。',
            canRetry: false,
            canUseNetwork: false,
            canOpenSettings: false,
            canOpenVoiceInputSettings: true,
          },
        })}
      />,
    );

    await fireEvent.press(
      panel.getByRole('button', { name: '前往语音输入设置' }),
    );
    expect(handlers.openVoiceInputSettings).toHaveBeenCalledTimes(1);
  });
});
