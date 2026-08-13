import {
  mergeSpeechTranscripts,
  SpeechRecognitionController,
} from '../speech/SpeechRecognitionController';
import { normalizeSpeechCapabilities } from '../speech/nativeSpeechRecognition';
import type {
  SpeechCapabilities,
  SpeechModelDownloadResult,
  SpeechModelState,
  SpeechPermissionResult,
  SpeechRecognitionEvent,
  SpeechRecognitionPort,
  SpeechStartOptions,
} from '../speech/types';

class FakeSpeechPort implements SpeechRecognitionPort {
  capabilities: SpeechCapabilities = {
    available: true,
    onDeviceAvailable: true,
    locale: 'zh-CN',
    platform: 'android',
    modelState: 'READY',
    stage: 'capability',
    permissionStatus: 'granted',
    providers: [
      {
        provider: 'android-on-device',
        route: 'on-device',
        available: true,
        modelState: 'READY',
        requiresMicrophonePermission: true,
        mayUseNetwork: false,
      },
      {
        provider: 'android-direct-system',
        route: 'direct-system',
        available: true,
        modelState: 'UNKNOWN',
        requiresMicrophonePermission: true,
        mayUseNetwork: true,
      },
      {
        provider: 'android-system-activity',
        route: 'system-activity',
        available: true,
        modelState: 'UNKNOWN',
        requiresMicrophonePermission: false,
        mayUseNetwork: true,
      },
    ],
  };
  downloadResult: SpeechModelDownloadResult = {
    locale: 'zh-CN',
    provider: 'android-on-device',
    modelState: 'DOWNLOADING',
    stage: 'model-preparation',
  };
  permission: SpeechPermissionResult = {
    status: 'granted',
    canAskAgain: true,
  };
  starts: SpeechStartOptions[] = [];
  stops: string[] = [];
  stopAccepted = true;
  stopResolver?: () => Promise<boolean>;
  cancellations: string[] = [];
  destroyCount = 0;
  capabilityChecks = 0;
  permissionRequests = 0;
  permissionSessionIds: string[] = [];
  modelDownloadRequests = 0;
  destroyedSessionIds: string[] = [];
  capabilityResolver?: () => Promise<SpeechCapabilities>;
  private listener?: (event: SpeechRecognitionEvent) => void;

  async getCapabilities(): Promise<SpeechCapabilities> {
    this.capabilityChecks += 1;
    return this.capabilityResolver?.() ?? this.capabilities;
  }

  async requestPermission(sessionId: string): Promise<SpeechPermissionResult> {
    this.permissionRequests += 1;
    this.permissionSessionIds.push(sessionId);
    return this.permission;
  }

  async downloadModel(): Promise<SpeechModelDownloadResult> {
    this.modelDownloadRequests += 1;
    return this.downloadResult;
  }

  async start(options: SpeechStartOptions): Promise<void> {
    this.starts.push(options);
  }

  async stop(sessionId: string): Promise<boolean> {
    this.stops.push(sessionId);
    return this.stopResolver?.() ?? this.stopAccepted;
  }

  async cancel(sessionId: string): Promise<void> {
    this.cancellations.push(sessionId);
  }

  async destroy(sessionId: string): Promise<void> {
    this.destroyCount += 1;
    this.destroyedSessionIds.push(sessionId);
  }

  subscribe(listener: (event: SpeechRecognitionEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  emit(event: SpeechRecognitionEvent): void {
    this.listener?.(event);
  }
}

function setLocalModelState(
  port: FakeSpeechPort,
  modelState: SpeechModelState,
): void {
  port.capabilities.modelState = modelState;
  port.capabilities.onDeviceAvailable = modelState === 'READY';
  const local = port.capabilities.providers?.find(
    provider => provider.route === 'on-device',
  );
  if (local !== undefined) {
    local.modelState = modelState;
    local.available = modelState === 'READY';
  }
}

function createController(
  port: FakeSpeechPort,
  onFinalResult = jest.fn(),
  recheckTimeoutMs?: number,
) {
  let sequence = 0;
  const controller = new SpeechRecognitionController(port, {
    createSessionId: () => `session-${++sequence}`,
    onFinalResult,
    recheckTimeoutMs,
  });
  return { controller, onFinalResult };
}

describe('stage 6 speech recognition controller', () => {
  it('preserves an explicit UNKNOWN model state from a modern native provider', () => {
    const capabilities = normalizeSpeechCapabilities(
      {
        available: true,
        onDeviceAvailable: true,
        platform: 'android',
        modelState: 'UNKNOWN',
        providers: [
          {
            provider: 'android-on-device',
            route: 'on-device',
            available: true,
            modelState: 'UNKNOWN',
            requiresMicrophonePermission: true,
            mayUseNetwork: false,
          },
        ],
      },
      'zh-CN',
    );

    expect(capabilities.modelState).toBe('UNKNOWN');
    expect(capabilities.providers?.[0]?.modelState).toBe('UNKNOWN');
  });

  it('keeps a legacy onDeviceAvailable payload UNKNOWN until the provider is tried', () => {
    const capabilities = normalizeSpeechCapabilities(
      {
        available: true,
        onDeviceAvailable: true,
        platform: 'android',
      },
      'zh-CN',
    );

    expect(capabilities.modelState).toBe('UNKNOWN');
    expect(capabilities.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: 'on-device',
          available: true,
          modelState: 'UNKNOWN',
          mayUseNetwork: false,
        }),
      ]),
    );
  });

  it('keeps a provider-ended result pending and ignores duplicate final callbacks', async () => {
    const port = new FakeSpeechPort();
    const { controller, onFinalResult } = createController(port);

    await controller.start();
    expect(port.permissionSessionIds).toEqual(['session-1']);
    expect(port.starts).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        preferOnDevice: true,
        allowNetworkFallback: false,
      }),
    ]);
    expect(controller.getSnapshot().status).toBe('STARTING');
    port.emit({
      type: 'state',
      sessionId: 'session-1',
      state: 'listening',
    });
    port.emit({
      type: 'partial',
      sessionId: 'session-1',
      text: '午饭二十五',
    });
    expect(controller.getSnapshot()).toMatchObject({
      status: 'LISTENING',
      partialText: '午饭二十五',
    });
    expect(onFinalResult).not.toHaveBeenCalled();

    port.emit({
      type: 'final',
      sessionId: 'session-1',
      text: ' 午饭二十五，微信付的 ',
    });
    port.emit({
      type: 'final',
      sessionId: 'session-1',
      text: '午饭二十五，微信付的',
    });
    expect(controller.getSnapshot()).toMatchObject({
      status: 'SUCCEEDED',
      finalText: '午饭二十五，微信付的',
      endReason: 'provider-endpoint',
      canContinue: true,
    });
    expect(onFinalResult).not.toHaveBeenCalled();
  });

  it('continues provider-ended segments, removes overlap, and submits only after user stop', async () => {
    const port = new FakeSpeechPort();
    const { controller, onFinalResult } = createController(port);

    await controller.start();
    port.emit({
      type: 'final',
      sessionId: 'session-1',
      text: '下午去商场买两瓶牛奶',
      endReason: 'provider-endpoint',
    });
    expect(onFinalResult).not.toHaveBeenCalled();

    await controller.continueDictation();
    expect(port.starts[1]?.sessionId).toBe('session-2');
    port.emit({
      type: 'partial',
      sessionId: 'session-2',
      text: '两瓶牛奶花了25元',
    });
    expect(controller.getSnapshot().partialText).toBe(
      '下午去商场买两瓶牛奶花了25元',
    );
    port.emit({
      type: 'final',
      sessionId: 'session-2',
      text: '两瓶牛奶花了25元',
      endReason: 'provider-endpoint',
    });
    expect(controller.getSnapshot()).toMatchObject({
      finalText: '下午去商场买两瓶牛奶花了25元',
      canContinue: true,
    });
    expect(onFinalResult).not.toHaveBeenCalled();

    await controller.continueDictation();
    await controller.stop();
    port.emit({
      type: 'final',
      sessionId: 'session-3',
      text: '花了25元',
    });
    expect(onFinalResult).toHaveBeenCalledTimes(1);
    expect(onFinalResult).toHaveBeenCalledWith(
      '下午去商场买两瓶牛奶花了25元',
      expect.any(String),
    );

    port.emit({
      type: 'final',
      sessionId: 'session-2',
      text: '不应拼入的乱序结果',
    });
    port.emit({
      type: 'final',
      sessionId: 'session-3',
      text: '重复结果',
    });
    expect(onFinalResult).toHaveBeenCalledTimes(1);
  });

  it('merges segment boundaries deterministically', () => {
    expect(mergeSpeechTranscripts('午饭25元', '25元微信付的')).toBe(
      '午饭25元微信付的',
    );
    expect(mergeSpeechTranscripts('午饭25元', '午饭25元')).toBe('午饭25元');
    expect(mergeSpeechTranscripts('午饭25元。', '微信付的')).toBe(
      '午饭25元。微信付的',
    );
    expect(mergeSpeechTranscripts('午饭25元', '微信付的')).toBe(
      '午饭25元，微信付的',
    );
  });

  it('rejects an oversized provider result before it reaches bookkeeping', async () => {
    const port = new FakeSpeechPort();
    const { controller, onFinalResult } = createController(port);
    await controller.start();

    port.emit({
      type: 'final',
      sessionId: 'session-1',
      text: '账'.repeat(501),
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      error: {
        code: 'result-too-long',
        canRetry: true,
        canUseNetwork: false,
      },
    });
    expect(onFinalResult).not.toHaveBeenCalled();
  });

  it('never exposes or submits a partial transcript after the app-owned recording limit', async () => {
    const port = new FakeSpeechPort();
    port.capabilities = {
      ...port.capabilities,
      providers: [
        {
          provider: 'app-owned-offline',
          route: 'app-owned-offline',
          available: true,
          modelState: 'READY',
          requiresMicrophonePermission: true,
          mayUseNetwork: false,
          captureOwnership: 'app',
          endpointOwnership: 'app',
        },
      ],
    };
    const { controller, onFinalResult } = createController(port);
    await controller.start();

    port.emit({
      type: 'partial',
      sessionId: 'session-1',
      generation: 1,
      text: '网吧消费10元',
    });
    port.emit({
      type: 'error',
      sessionId: 'session-1',
      generation: 1,
      code: 'recording-too-long',
      retryable: true,
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      partialText: '网吧消费10元',
      resultToken: undefined,
      hasFreshTurnEvidence: false,
      error: {
        code: 'recording-too-long',
        message: expect.stringContaining('不会生成账单'),
      },
    });
    expect(onFinalResult).not.toHaveBeenCalled();
  });

  it('invalidates a cancelled session and ignores its late callbacks', async () => {
    const port = new FakeSpeechPort();
    const { controller, onFinalResult } = createController(port);
    await controller.start();

    await controller.cancel();
    expect(port.cancellations).toEqual(['session-1']);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'CANCELLED',
      partialText: '',
    });
    port.emit({
      type: 'final',
      sessionId: 'session-1',
      text: '不应处理的迟到结果',
    });
    expect(onFinalResult).not.toHaveBeenCalled();

    await controller.start();
    expect(port.starts[1]?.sessionId).toBe('session-2');
  });

  it('requires the first native generation to match the active turn', async () => {
    const port = new FakeSpeechPort();
    const { controller } = createController(port);
    await controller.start();

    expect(port.starts[0]?.generation).toBe(1);
    port.emit({
      type: 'partial',
      sessionId: 'session-1',
      generation: 0,
      text: '迟到的旧代文字',
    });
    expect(controller.getSnapshot()).toMatchObject({
      status: 'STARTING',
      partialText: '',
      hasFreshTurnEvidence: false,
    });

    port.emit({
      type: 'partial',
      sessionId: 'session-1',
      generation: 1,
      text: '本轮文字',
    });
    expect(controller.getSnapshot()).toMatchObject({
      status: 'LISTENING',
      partialText: '本轮文字',
      hasFreshTurnEvidence: true,
    });
  });

  it('waits for a packaged App-owned engine to warm without opening any microphone route', async () => {
    const port = new FakeSpeechPort();
    port.capabilities = {
      available: false,
      onDeviceAvailable: false,
      locale: 'zh-CN',
      platform: 'android',
      modelState: 'DOWNLOADING',
      permissionStatus: 'granted',
      providers: [
        {
          provider: 'app-owned-offline',
          route: 'app-owned-offline',
          available: false,
          modelState: 'DOWNLOADING',
          requiresMicrophonePermission: true,
          mayUseNetwork: false,
          captureOwnership: 'app',
          endpointOwnership: 'app',
        },
      ],
    };
    const { controller } = createController(port);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({
      status: 'PREPARING_MODEL',
      provider: 'app-owned-offline',
      route: 'app-owned-offline',
      modelState: 'DOWNLOADING',
      mayUseNetwork: false,
      canRecheck: true,
    });
    expect(port.permissionRequests).toBe(0);
    expect(port.starts).toHaveLength(0);
    await Promise.resolve();
    expect(port.destroyedSessionIds).toEqual(['session-1']);
  });

  it('requires explicit consent before a network-capable system fallback', async () => {
    const port = new FakeSpeechPort();
    setLocalModelState(port, 'DOWNLOADABLE');
    const { controller } = createController(port);

    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      error: {
        code: 'model-missing',
        canUseNetwork: true,
        canDownloadModel: true,
        modelState: 'DOWNLOADABLE',
      },
    });
    expect(port.permissionRequests).toBe(0);
    expect(port.starts).toHaveLength(0);

    await controller.useNetworkAndRetry();
    expect(port.starts).toEqual([
      expect.objectContaining({
        sessionId: 'session-2',
        preferOnDevice: false,
        allowNetworkFallback: true,
      }),
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'STARTING',
      usingNetworkFallback: true,
      provider: 'android-direct-system',
      route: 'direct-system',
    });
    expect(port.permissionRequests).toBe(1);
  });

  it('downloads a downloadable model only after the explicit user action', async () => {
    const port = new FakeSpeechPort();
    setLocalModelState(port, 'DOWNLOADABLE');
    const { controller } = createController(port);

    await controller.start();
    expect(port.modelDownloadRequests).toBe(0);
    expect(port.starts).toHaveLength(0);

    await controller.downloadModel();
    expect(port.modelDownloadRequests).toBe(1);
    expect(port.starts).toHaveLength(0);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'PREPARING_MODEL',
      modelState: 'DOWNLOADING',
      canRecheck: true,
    });

    await controller.start();
    expect(port.starts).toHaveLength(0);

    setLocalModelState(port, 'READY');
    await controller.recheck();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'IDLE',
      modelState: 'READY',
      canRecheck: false,
    });
    expect(port.starts).toHaveLength(0);
  });

  it('treats an unknown model state honestly and never auto-enables networking', async () => {
    const port = new FakeSpeechPort();
    setLocalModelState(port, 'UNKNOWN');
    const { controller } = createController(port);

    await controller.start();

    expect(port.permissionRequests).toBe(0);
    expect(port.starts).toHaveLength(0);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      usingNetworkFallback: false,
      error: {
        code: 'model-status-unknown',
        canDownloadModel: false,
        canUseNetwork: true,
      },
    });
  });

  it('probes an available unknown local provider without enabling networking', async () => {
    const port = new FakeSpeechPort();
    setLocalModelState(port, 'UNKNOWN');
    const local = port.capabilities.providers?.find(
      provider => provider.route === 'on-device',
    );
    if (local !== undefined) {
      local.available = true;
    }
    port.capabilities.onDeviceAvailable = true;
    const { controller } = createController(port);

    await controller.start();

    expect(port.permissionRequests).toBe(1);
    expect(port.starts).toEqual([
      expect.objectContaining({
        preferOnDevice: true,
        allowNetworkFallback: false,
      }),
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'STARTING',
      modelState: 'UNKNOWN',
      usingNetworkFallback: false,
      mayUseNetwork: false,
    });
  });

  it('keeps processing monotonic when a provider sends a late listening callback', async () => {
    const port = new FakeSpeechPort();
    const { controller } = createController(port);
    await controller.start();
    await controller.stop();

    port.emit({
      type: 'state',
      sessionId: 'session-1',
      state: 'listening',
    });

    expect(controller.getSnapshot().status).toBe('PROCESSING');
  });

  it('reports the global microphone switch separately from app permission', async () => {
    const port = new FakeSpeechPort();
    port.permission = {
      status: 'restricted',
      canAskAgain: false,
      reason: 'microphone-disabled',
    };
    const { controller } = createController(port);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      error: {
        code: 'microphone-disabled',
        canRetry: false,
        canOpenSettings: false,
      },
    });
  });

  it('does not gate the system Activity route on this app microphone permission', async () => {
    const port = new FakeSpeechPort();
    setLocalModelState(port, 'UNKNOWN');
    port.permission = { status: 'blocked', canAskAgain: false };
    port.capabilities.permissionStatus = 'blocked';
    const { controller } = createController(port);

    await controller.start(true);

    expect(port.permissionRequests).toBe(0);
    expect(port.starts).toEqual([
      expect.objectContaining({
        preferOnDevice: false,
        allowNetworkFallback: true,
      }),
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      provider: 'android-system-activity',
      route: 'system-activity',
    });
  });

  it('uses the controllable direct system route only after explicit consent and a healthy permission state', async () => {
    const port = new FakeSpeechPort();
    setLocalModelState(port, 'UNSUPPORTED');
    const { controller } = createController(port);

    await controller.start();
    expect(port.starts).toHaveLength(0);
    expect(controller.getSnapshot()).toMatchObject({
      usingNetworkFallback: false,
      error: {
        code: 'language-not-supported',
        message: '本机未检测到可用的离线普通话语音模型。',
        canUseNetwork: true,
      },
    });

    await controller.useNetworkAndRetry();
    expect(port.starts).toHaveLength(1);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'STARTING',
      provider: 'android-direct-system',
      route: 'direct-system',
      usingNetworkFallback: true,
      mayUseNetwork: true,
    });
  });

  it.each([
    ['denied', 'permission-denied', true],
    ['blocked', 'permission-blocked', true],
    ['restricted', 'permission-blocked', true],
  ] as const)(
    'maps %s permission without starting the recognizer',
    async (status, code, canOpenSettings) => {
      const port = new FakeSpeechPort();
      port.permission = { status, canAskAgain: status === 'denied' };
      const { controller } = createController(port);

      await controller.start();
      expect(port.starts).toHaveLength(0);
      expect(controller.getSnapshot()).toMatchObject({
        status: 'ERROR',
        error: { code, canOpenSettings },
      });
    },
  );

  it('distinguishes stop from cancel and waits for the final result', async () => {
    const port = new FakeSpeechPort();
    const { controller, onFinalResult } = createController(port);
    await controller.start();

    await controller.stop();
    expect(port.stops).toEqual(['session-1']);
    expect(port.cancellations).toHaveLength(0);
    expect(controller.getSnapshot().status).toBe('PROCESSING');
    port.emit({
      type: 'final',
      sessionId: 'session-1',
      text: '打车十八元',
    });
    expect(onFinalResult).toHaveBeenCalledWith(
      '打车十八元',
      expect.any(String),
    );
  });

  it('retries no-speech on the same route without escalating to system recognition', async () => {
    const port = new FakeSpeechPort();
    const { controller, onFinalResult } = createController(port);
    await controller.start();
    port.emit({ type: 'final', sessionId: 'session-1', text: '   ' });

    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      error: { code: 'no-speech', canRetry: true, canUseNetwork: false },
    });
    expect(onFinalResult).not.toHaveBeenCalled();
  });

  it('honours a non-retryable native service error', async () => {
    const port = new FakeSpeechPort();
    const { controller } = createController(port);
    await controller.start();

    port.emit({
      type: 'error',
      sessionId: 'session-1',
      code: 'unknown',
      retryable: false,
      androidErrorCode: 9,
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      error: { code: 'unknown', canRetry: false },
    });
  });

  it('maps an OEM direct-service incompatibility to the explicit system input action', async () => {
    const port = new FakeSpeechPort();
    const { controller } = createController(port);
    await controller.start();

    port.emit({
      type: 'error',
      sessionId: 'session-1',
      code: 'service-incompatible',
      retryable: true,
      androidErrorCode: 9,
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      error: {
        code: 'service-incompatible',
        canUseNetwork: true,
        canOpenSettings: false,
      },
    });
    await controller.useNetworkAndRetry();
    expect(port.starts[1]).toMatchObject({
      preferOnDevice: false,
      allowNetworkFallback: true,
    });
  });

  it('routes an iOS missing local asset error to explicit system recognition', async () => {
    const port = new FakeSpeechPort();
    const { controller } = createController(port);
    await controller.start();

    port.emit({
      type: 'error',
      sessionId: 'session-1',
      code: 'model-missing',
      provider: 'ios-on-device',
      route: 'on-device',
      modelState: 'UNKNOWN',
      stage: 'result',
      retryable: false,
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      provider: 'ios-on-device',
      modelState: 'UNKNOWN',
      error: {
        code: 'model-missing',
        canUseNetwork: true,
        canDownloadModel: false,
      },
    });
  });

  it('passively rechecks a blocked permission after Settings without recording', async () => {
    const port = new FakeSpeechPort();
    port.permission = { status: 'blocked', canAskAgain: false };
    const { controller } = createController(port);

    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      error: {
        code: 'permission-blocked',
        canRecheck: true,
      },
    });

    port.capabilities.permissionStatus = 'blocked';
    await controller.recheck();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      error: { code: 'permission-blocked', canRecheck: true },
    });
    expect(port.permissionRequests).toBe(1);
    expect(port.starts).toHaveLength(0);

    port.capabilities.permissionStatus = 'granted';
    port.permission = { status: 'granted', canAskAgain: true };
    await controller.recheck();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'IDLE',
      canRecheck: false,
    });
    expect(port.permissionRequests).toBe(1);
    expect(port.starts).toHaveLength(0);

    await controller.start();
    expect(port.starts).toHaveLength(1);
  });

  it('keeps microphone privacy separate and recovers only after a passive recheck', async () => {
    const port = new FakeSpeechPort();
    port.permission = {
      status: 'restricted',
      canAskAgain: false,
      reason: 'microphone-disabled',
    };
    const { controller } = createController(port);

    await controller.start();
    port.capabilities.permissionStatus = 'restricted';
    await controller.recheck();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      error: {
        code: 'microphone-disabled',
        canOpenSettings: false,
        canRecheck: true,
      },
    });
    expect(port.starts).toHaveLength(0);

    port.capabilities.permissionStatus = 'granted';
    await controller.recheck();
    expect(controller.getSnapshot()).toMatchObject({ status: 'IDLE' });
    expect(port.starts).toHaveLength(0);
  });

  it('single-flights rechecks and never requests permission or a network route', async () => {
    const port = new FakeSpeechPort();
    let resolveCapabilities: ((value: SpeechCapabilities) => void) | undefined;
    port.capabilityResolver = () =>
      new Promise(resolve => {
        resolveCapabilities = resolve;
      });
    const { controller } = createController(port);

    const first = controller.recheck();
    const second = controller.recheck();
    expect(first).toBe(second);
    expect(port.capabilityChecks).toBe(1);
    resolveCapabilities?.(port.capabilities);
    await Promise.all([first, second]);

    expect(controller.getSnapshot()).toMatchObject({ status: 'IDLE' });
    expect(port.permissionRequests).toBe(0);
    expect(port.starts).toHaveLength(0);
  });

  it('ignores a late capability result after the recheck owner is cancelled', async () => {
    const port = new FakeSpeechPort();
    let resolveCapabilities: ((value: SpeechCapabilities) => void) | undefined;
    port.capabilityResolver = () =>
      new Promise(resolve => {
        resolveCapabilities = resolve;
      });
    const { controller } = createController(port);

    const recheck = controller.recheck();
    await controller.cancel();
    await recheck;
    expect(controller.getSnapshot().status).toBe('CANCELLED');

    resolveCapabilities?.(port.capabilities);
    await Promise.resolve();
    expect(controller.getSnapshot().status).toBe('CANCELLED');
    expect(port.starts).toHaveLength(0);
  });

  it('times out an abandoned capability recheck without accepting a late result', async () => {
    const port = new FakeSpeechPort();
    let resolveCapabilities: ((value: SpeechCapabilities) => void) | undefined;
    port.capabilityResolver = () =>
      new Promise(resolve => {
        resolveCapabilities = resolve;
      });
    const { controller } = createController(port, jest.fn(), 5);

    await controller.recheck();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      error: { code: 'capability-timeout', canRecheck: true },
    });

    resolveCapabilities?.(port.capabilities);
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      error: { code: 'capability-timeout' },
    });
    expect(port.starts).toHaveLength(0);
  });

  it('prevents concurrent starts and releases the native recognizer on dispose', async () => {
    const port = new FakeSpeechPort();
    const { controller } = createController(port);

    await Promise.all([controller.start(), controller.start()]);
    expect(port.capabilityChecks).toBe(1);
    expect(port.starts).toHaveLength(1);
    await controller.dispose();
    expect(port.cancellations).toEqual(['session-1']);
    expect(port.destroyCount).toBe(1);
    expect(port.destroyedSessionIds).toEqual(['session-1']);
  });

  it('never exposes an accepted prefix after a continuation errors without fresh evidence', async () => {
    const port = new FakeSpeechPort();
    const { controller } = createController(port);
    await controller.start();
    port.emit({
      type: 'final',
      sessionId: 'session-1',
      text: '午饭二十五元',
      endReason: 'provider-endpoint',
    });
    await controller.continueDictation();
    port.emit({
      type: 'error',
      sessionId: 'session-2',
      code: 'no-speech',
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      partialText: '',
      hasFreshTurnEvidence: false,
    });
    expect(controller.getSnapshot().resultToken).toBeUndefined();
  });

  it('resetForNewDraft atomically clears results and ignores every late callback', async () => {
    const port = new FakeSpeechPort();
    const { controller, onFinalResult } = createController(port);
    await controller.start();
    port.emit({
      type: 'partial',
      sessionId: 'session-1',
      text: '旧的十元',
    });
    const before = controller.getSnapshot();
    controller.resetForNewDraft();

    port.emit({ type: 'partial', sessionId: 'session-1', text: '迟到片段' });
    port.emit({ type: 'final', sessionId: 'session-1', text: '迟到结果' });
    port.emit({ type: 'error', sessionId: 'session-1', code: 'audio' });

    expect(controller.getSnapshot()).toMatchObject({
      status: 'IDLE',
      partialText: '',
      draftGeneration: before.draftGeneration + 1,
    });
    expect(controller.getSnapshot().resultToken).toBeUndefined();
    expect(controller.getSnapshot().hasFreshTurnEvidence).toBeUndefined();
    expect(onFinalResult).not.toHaveBeenCalled();
  });

  it('requires the current single-use result token and rejects replay', async () => {
    const port = new FakeSpeechPort();
    const { controller } = createController(port);
    await controller.start();
    port.emit({
      type: 'final',
      sessionId: 'session-1',
      text: '咖啡二十元',
      endReason: 'provider-endpoint',
    });
    const token = controller.getSnapshot().resultToken!;

    expect(controller.consumeResult('wrong-token')).toBe(false);
    expect(controller.consumeResult(token)).toBe(true);
    expect(controller.consumeResult(token)).toBe(false);
    expect(controller.getSnapshot().partialText).toBe('');
  });

  it('creates cross-controller unique result tokens', async () => {
    const firstPort = new FakeSpeechPort();
    const secondPort = new FakeSpeechPort();
    const first = createController(firstPort).controller;
    const second = createController(secondPort).controller;
    await first.start();
    await second.start();
    firstPort.emit({ type: 'final', sessionId: 'session-1', text: '午饭十元' });
    secondPort.emit({
      type: 'final',
      sessionId: 'session-1',
      text: '午饭十元',
    });

    expect(first.getSnapshot().resultToken).toBeDefined();
    expect(second.getSnapshot().resultToken).toBeDefined();
    expect(first.getSnapshot().resultToken).not.toBe(
      second.getSnapshot().resultToken,
    );
  });

  it('keeps one logical dictation across continue turns but only the latest token consumable', async () => {
    const port = new FakeSpeechPort();
    const { controller } = createController(port);
    await controller.start();
    port.emit({ type: 'final', sessionId: 'session-1', text: '超市' });
    const firstToken = controller.getSnapshot().resultToken!;
    await controller.continueDictation();
    port.emit({ type: 'final', sessionId: 'session-2', text: '牛奶二十元' });
    const finalToken = controller.getSnapshot().resultToken!;

    expect(firstToken.split(':d')[0]).toBe(finalToken.split(':d')[0]);
    expect(firstToken).not.toBe(finalToken);
    expect(controller.consumeResult(firstToken)).toBe(false);
    expect(controller.consumeResult(finalToken)).toBe(true);
  });

  it('does not relabel a provider final when the pending user stop is rejected', async () => {
    const port = new FakeSpeechPort();
    let resolveStop: ((accepted: boolean) => void) | undefined;
    port.stopResolver = () =>
      new Promise(resolve => {
        resolveStop = resolve;
      });
    const { controller, onFinalResult } = createController(port);
    await controller.start();

    const stopping = controller.stop();
    port.emit({
      type: 'final',
      sessionId: 'session-1',
      text: '系统先结束的十元',
      endReason: 'provider-endpoint',
    });
    expect(onFinalResult).not.toHaveBeenCalled();
    resolveStop?.(false);
    await stopping;

    expect(controller.getSnapshot()).toMatchObject({
      status: 'SUCCEEDED',
      endReason: 'provider-endpoint',
      canContinue: true,
    });
    expect(onFinalResult).not.toHaveBeenCalled();
  });
});
