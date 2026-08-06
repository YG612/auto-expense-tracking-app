import { SpeechRecognitionController } from '../speech/SpeechRecognitionController';
import type {
  SpeechCapabilities,
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
  };
  permission: SpeechPermissionResult = {
    status: 'granted',
    canAskAgain: true,
  };
  starts: SpeechStartOptions[] = [];
  stops: string[] = [];
  cancellations: string[] = [];
  destroyCount = 0;
  capabilityChecks = 0;
  permissionRequests = 0;
  private listener?: (event: SpeechRecognitionEvent) => void;

  async getCapabilities(): Promise<SpeechCapabilities> {
    this.capabilityChecks += 1;
    return this.capabilities;
  }

  async requestPermission(): Promise<SpeechPermissionResult> {
    this.permissionRequests += 1;
    return this.permission;
  }

  async start(options: SpeechStartOptions): Promise<void> {
    this.starts.push(options);
  }

  async stop(sessionId: string): Promise<void> {
    this.stops.push(sessionId);
  }

  async cancel(sessionId: string): Promise<void> {
    this.cancellations.push(sessionId);
  }

  async destroy(): Promise<void> {
    this.destroyCount += 1;
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

function createController(port: FakeSpeechPort, onFinalResult = jest.fn()) {
  let sequence = 0;
  const controller = new SpeechRecognitionController(port, {
    createSessionId: () => `session-${++sequence}`,
    onFinalResult,
  });
  return { controller, onFinalResult };
}

describe('stage 6 speech recognition controller', () => {
  it('previews partial text and delivers one final result only once', async () => {
    const port = new FakeSpeechPort();
    const { controller, onFinalResult } = createController(port);

    await controller.start();
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
    });
    expect(onFinalResult).toHaveBeenCalledTimes(1);
    expect(onFinalResult).toHaveBeenCalledWith('午饭二十五，微信付的');
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

  it('requires explicit consent before a network-capable system fallback', async () => {
    const port = new FakeSpeechPort();
    port.capabilities.onDeviceAvailable = false;
    const { controller } = createController(port);

    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ERROR',
      error: { code: 'model-missing', canUseNetwork: true },
    });
    expect(port.permissionRequests).toBe(1);
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
    expect(onFinalResult).toHaveBeenCalledWith('打车十八元');
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

  it('prevents concurrent starts and releases the native recognizer on dispose', async () => {
    const port = new FakeSpeechPort();
    const { controller } = createController(port);

    await Promise.all([controller.start(), controller.start()]);
    expect(port.capabilityChecks).toBe(1);
    expect(port.starts).toHaveLength(1);
    await controller.dispose();
    expect(port.cancellations).toEqual(['session-1']);
    expect(port.destroyCount).toBe(1);
  });
});
