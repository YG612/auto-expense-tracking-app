import { PreferredSpeechRecognitionPort } from '../speech/preferredSpeechRecognition';
import type {
  SpeechCapabilities,
  SpeechRecognitionEvent,
  SpeechRecognitionPort,
  SpeechStartOptions,
} from '../speech/types';

const embeddedCapabilities: SpeechCapabilities = {
  available: true,
  onDeviceAvailable: true,
  locale: 'zh-CN',
  platform: 'android',
  modelState: 'READY',
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

const unavailableEmbedded: SpeechCapabilities = {
  ...embeddedCapabilities,
  available: false,
  onDeviceAvailable: false,
  modelState: 'UNSUPPORTED',
  providers: [
    {
      ...embeddedCapabilities.providers![0],
      available: false,
      modelState: 'UNSUPPORTED',
    },
  ],
};

const preparingEmbedded: SpeechCapabilities = {
  ...embeddedCapabilities,
  available: false,
  onDeviceAvailable: false,
  modelState: 'DOWNLOADING',
  providers: [
    {
      ...embeddedCapabilities.providers![0],
      available: false,
      modelState: 'DOWNLOADING',
    },
  ],
};

function brokenPackagedEmbedded(diagnosticCode: string): SpeechCapabilities {
  return {
    ...unavailableEmbedded,
    providers: [
      {
        ...unavailableEmbedded.providers![0],
        diagnosticCode,
      },
    ],
  };
}

const systemCapabilities: SpeechCapabilities = {
  available: true,
  onDeviceAvailable: false,
  locale: 'zh-CN',
  platform: 'android',
  modelState: 'UNSUPPORTED',
  providers: [
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

function fakePort(
  capabilities: SpeechCapabilities,
): jest.Mocked<SpeechRecognitionPort> {
  return {
    getCapabilities: jest.fn(async (_locale: string) => capabilities),
    downloadModel: jest.fn(async locale => ({
      locale,
      provider: capabilities.providers?.[0]?.provider ?? 'unknown',
      modelState: capabilities.modelState ?? 'UNKNOWN',
      stage: 'model-preparation' as const,
    })),
    requestPermission: jest.fn(async (_sessionId: string) => ({
      status: 'granted' as const,
      canAskAgain: true,
    })),
    start: jest.fn(async (_options: SpeechStartOptions) => undefined),
    stop: jest.fn(async (_sessionId: string) => true),
    cancel: jest.fn(async (_sessionId: string) => undefined),
    destroy: jest.fn(async (_sessionId: string) => undefined),
    subscribe: jest.fn((_listener: (event: SpeechRecognitionEvent) => void) =>
      jest.fn(),
    ),
  };
}

const startOptions = {
  sessionId: 'voice-1',
  locale: 'zh-CN',
  preferOnDevice: true,
  allowNetworkFallback: false,
};

describe('PreferredSpeechRecognitionPort', () => {
  it('keeps capabilities, permission and capture on the ready embedded port', async () => {
    const embedded = fakePort(embeddedCapabilities);
    const system = fakePort(systemCapabilities);
    const port = new PreferredSpeechRecognitionPort(embedded, system);

    await expect(port.getCapabilities('zh-CN')).resolves.toBe(
      embeddedCapabilities,
    );
    await port.requestPermission('voice-1');
    await port.start(startOptions);
    await port.stop('voice-1');

    expect(system.getCapabilities).not.toHaveBeenCalled();
    expect(embedded.requestPermission).toHaveBeenCalledWith('voice-1');
    expect(embedded.start).toHaveBeenCalledWith(startOptions);
    expect(embedded.stop).toHaveBeenCalledWith('voice-1');
  });

  it('uses the established system path when the optional model is absent', async () => {
    const embedded = fakePort(unavailableEmbedded);
    const system = fakePort(systemCapabilities);
    const port = new PreferredSpeechRecognitionPort(embedded, system);

    await expect(port.getCapabilities('zh-CN')).resolves.toBe(
      systemCapabilities,
    );
    await port.requestPermission('voice-1');
    await port.start(startOptions);

    expect(system.getCapabilities).toHaveBeenCalledWith('zh-CN');
    expect(system.requestPermission).toHaveBeenCalledWith('voice-1');
    expect(system.start).toHaveBeenCalledWith(startOptions);
    expect(embedded.start).not.toHaveBeenCalled();
  });

  it('never falls back to the system endpoint while the packaged engine is warming', async () => {
    const embedded = fakePort(preparingEmbedded);
    const system = fakePort(systemCapabilities);
    const port = new PreferredSpeechRecognitionPort(embedded, system);

    await expect(port.getCapabilities('zh-CN', 'voice-warming')).resolves.toBe(
      preparingEmbedded,
    );
    await port.requestPermission('voice-warming');

    expect(system.getCapabilities).not.toHaveBeenCalled();
    expect(embedded.requestPermission).toHaveBeenCalledWith('voice-warming');
    expect(system.requestPermission).not.toHaveBeenCalled();
  });

  it.each([
    'embedded-streaming-runtime-failed',
    'embedded-engine-factory-failed',
    'embedded-runtime-load-failed',
  ])(
    'fails closed instead of restoring the OEM endpoint for %s',
    async diagnosticCode => {
      const broken = brokenPackagedEmbedded(diagnosticCode);
      const embedded = fakePort(broken);
      const system = fakePort(systemCapabilities);
      const port = new PreferredSpeechRecognitionPort(embedded, system);

      await expect(port.getCapabilities('zh-CN', 'voice-broken')).resolves.toBe(
        broken,
      );

      expect(system.getCapabilities).not.toHaveBeenCalled();
      expect(system.requestPermission).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the embedded capability probe rejects', async () => {
    const embedded = fakePort(unavailableEmbedded);
    embedded.getCapabilities.mockRejectedValueOnce(new Error('linkage'));
    const system = fakePort(systemCapabilities);
    const port = new PreferredSpeechRecognitionPort(embedded, system);

    await expect(port.getCapabilities('zh-CN')).rejects.toThrow('linkage');
    expect(system.getCapabilities).not.toHaveBeenCalled();
    await port.destroy('voice-1');

    expect(embedded.destroy).toHaveBeenCalledWith('voice-1');
    expect(system.destroy).toHaveBeenCalledWith('voice-1');
  });

  it('binds each session to the capability request that owns it despite out-of-order probes', async () => {
    const embedded = fakePort(embeddedCapabilities);
    const system = fakePort(systemCapabilities);
    let resolveFirst: ((value: SpeechCapabilities) => void) | undefined;
    embedded.getCapabilities
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(unavailableEmbedded);
    const port = new PreferredSpeechRecognitionPort(embedded, system);

    const first = port.getCapabilities('zh-CN', 'voice-old');
    const second = port.getCapabilities('zh-CN', 'voice-new');
    await second;
    resolveFirst?.(embeddedCapabilities);
    await first;

    await port.requestPermission('voice-old');
    await port.requestPermission('voice-new');
    expect(embedded.requestPermission).toHaveBeenCalledWith('voice-old');
    expect(system.requestPermission).toHaveBeenCalledWith('voice-new');
  });

  it('destroys a reset session on its original owner after the next session starts', async () => {
    const embedded = fakePort(embeddedCapabilities);
    const system = fakePort(systemCapabilities);
    embedded.getCapabilities
      .mockResolvedValueOnce(embeddedCapabilities)
      .mockResolvedValueOnce(unavailableEmbedded);
    const port = new PreferredSpeechRecognitionPort(embedded, system);

    await port.getCapabilities('zh-CN', 'voice-old');
    await port.requestPermission('voice-old');
    await port.cancel('voice-old');
    await port.getCapabilities('zh-CN', 'voice-new');
    await port.requestPermission('voice-new');
    await port.destroy('voice-old');

    expect(embedded.destroy).toHaveBeenCalledWith('voice-old');
    expect(system.destroy).not.toHaveBeenCalledWith('voice-old');
    expect(system.requestPermission).toHaveBeenCalledWith('voice-new');
  });

  it('releases retired ownership after destroy so a reused id can bind normally', async () => {
    const embedded = fakePort(embeddedCapabilities);
    const system = fakePort(systemCapabilities);
    embedded.getCapabilities
      .mockResolvedValueOnce(embeddedCapabilities)
      .mockResolvedValueOnce(unavailableEmbedded);
    const port = new PreferredSpeechRecognitionPort(embedded, system);

    await port.getCapabilities('zh-CN', 'voice-reused');
    await port.cancel('voice-reused');
    await port.destroy('voice-reused');
    await port.getCapabilities('zh-CN', 'voice-reused');
    await port.requestPermission('voice-reused');

    expect(system.requestPermission).toHaveBeenCalledWith('voice-reused');
  });
});
