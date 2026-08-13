import {
  AppOwnedOfflineSpeechRecognitionPort,
  createUnavailableAppOwnedOfflineSpeechRecognitionPort,
  type AppOwnedAudioCapture,
  type AppOwnedAudioCaptureHandlers,
  type OfflineSpeechDecoder,
  type Pcm16AudioChunk,
} from '../speech/AppOwnedOfflineSpeechRecognitionPort';
import type {
  SpeechRecognitionEvent,
  SpeechStartOptions,
} from '../speech/types';

class FakeCapture implements AppOwnedAudioCapture {
  handlers?: AppOwnedAudioCaptureHandlers;
  stopCount = 0;
  cancelCount = 0;

  async getAvailability() {
    return { available: true, permissionStatus: 'granted' as const };
  }

  async requestPermission() {
    return { status: 'granted' as const, canAskAgain: true };
  }

  async start(_sessionId: string, handlers: AppOwnedAudioCaptureHandlers) {
    this.handlers = handlers;
  }

  async stop() {
    this.stopCount += 1;
  }

  async cancel() {
    this.cancelCount += 1;
  }

  async destroy() {}
}

class FakeDecoder implements OfflineSpeechDecoder {
  onPartial?: (text: string) => void;
  accepted: number[] = [];
  finishCount = 0;
  cancelCount = 0;

  async getModelState() {
    return { modelState: 'READY' as const };
  }

  async start(
    _sessionId: string,
    _locale: string,
    onPartial: (text: string) => void,
  ) {
    this.onPartial = onPartial;
  }

  async acceptAudio(_sessionId: string, chunk: Pcm16AudioChunk) {
    this.accepted.push(chunk.samples[0] ?? -1);
  }

  async finish() {
    this.finishCount += 1;
    return '午饭25元';
  }

  async cancel() {
    this.cancelCount += 1;
  }

  async destroy() {}
}

const options: SpeechStartOptions = {
  sessionId: 'owned-1',
  locale: 'zh-CN',
  preferOnDevice: true,
  allowNetworkFallback: false,
};

const chunk = (value: number): Pcm16AudioChunk => ({
  sessionId: 'owned-1',
  samples: new Uint8Array([value]),
  sampleRateHz: 16_000,
  channelCount: 1,
  encoding: 'pcm16',
});

describe('app-owned offline speech provider contract', () => {
  it('defaults to unavailable and never advertises network or fake offline readiness', async () => {
    const port = createUnavailableAppOwnedOfflineSpeechRecognitionPort();
    const capabilities = await port.getCapabilities('zh-CN');

    expect(capabilities.available).toBe(false);
    expect(capabilities.onDeviceAvailable).toBe(false);
    expect(capabilities.providers).toEqual([
      expect.objectContaining({
        provider: 'app-owned-offline',
        route: 'app-owned-offline',
        available: false,
        mayUseNetwork: false,
        captureOwnership: 'app',
        endpointOwnership: 'app',
      }),
    ]);
  });

  it('serializes PCM, makes stop idempotent, and emits one user-owned final', async () => {
    const capture = new FakeCapture();
    const decoder = new FakeDecoder();
    const port = new AppOwnedOfflineSpeechRecognitionPort(capture, decoder);
    const events: SpeechRecognitionEvent[] = [];
    port.subscribe(event => events.push(event));

    await port.start(options);
    capture.handlers?.onAudio(chunk(1));
    capture.handlers?.onAudio(chunk(2));
    decoder.onPartial?.('午饭');
    await Promise.all([port.stop('owned-1'), port.stop('owned-1')]);

    expect(decoder.accepted).toEqual([1, 2]);
    expect(capture.stopCount).toBe(1);
    expect(decoder.finishCount).toBe(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'partial',
          text: '午饭',
          captureOwnership: 'app',
          endpointOwnership: 'app',
        }),
        expect.objectContaining({
          type: 'final',
          text: '午饭25元',
          endReason: 'user-stop',
        }),
      ]),
    );
    expect(events.filter(event => event.type === 'final')).toHaveLength(1);
  });

  it('invalidates callbacks before cancellation dependencies complete', async () => {
    const capture = new FakeCapture();
    const decoder = new FakeDecoder();
    const port = new AppOwnedOfflineSpeechRecognitionPort(capture, decoder);
    const events: SpeechRecognitionEvent[] = [];
    port.subscribe(event => events.push(event));
    await port.start(options);

    await port.cancel('owned-1');
    const eventCountAfterCancel = events.length;
    capture.handlers?.onAudio(chunk(3));
    capture.handlers?.onError('audio', 'late error');
    decoder.onPartial?.('迟到结果');
    await Promise.resolve();

    expect(events).toHaveLength(eventCountAfterCancel);
    expect(events.at(-1)).toMatchObject({
      type: 'state',
      state: 'cancelled',
      endReason: 'cancelled',
    });
  });
});
