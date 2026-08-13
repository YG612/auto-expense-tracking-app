import type {
  SpeechCapabilities,
  SpeechErrorCode,
  SpeechModelDownloadResult,
  SpeechModelState,
  SpeechPermissionResult,
  SpeechRecognitionEvent,
  SpeechRecognitionPort,
  SpeechStartOptions,
} from './types';

export type Pcm16AudioChunk = {
  sessionId: string;
  samples: Uint8Array;
  sampleRateHz: number;
  channelCount: 1 | 2;
  encoding: 'pcm16';
};

export type AppOwnedAudioCaptureAvailability = {
  available: boolean;
  permissionStatus?: SpeechCapabilities['permissionStatus'];
  diagnosticCode?: string;
};

export type AppOwnedAudioCaptureHandlers = {
  onAudio: (chunk: Pcm16AudioChunk) => void;
  onError: (code: SpeechErrorCode, message?: string) => void;
  onInterrupted: (message?: string) => void;
};

/**
 * Owns microphone lifetime. Implementations must keep capture active until
 * stop/cancel is called; decoder endpointing must never close this session.
 */
export interface AppOwnedAudioCapture {
  getAvailability(): Promise<AppOwnedAudioCaptureAvailability>;
  requestPermission(sessionId: string): Promise<SpeechPermissionResult>;
  start(
    sessionId: string,
    handlers: AppOwnedAudioCaptureHandlers,
  ): Promise<void>;
  stop(sessionId: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  destroy(): Promise<void>;
}

export type OfflineDecoderModelState = {
  modelState: SpeechModelState;
  diagnosticCode?: string;
};

/** A decoder consumes app-owned PCM and never opens the microphone/network. */
export interface OfflineSpeechDecoder {
  getModelState(locale: string): Promise<OfflineDecoderModelState>;
  start(
    sessionId: string,
    locale: string,
    onPartial: (text: string) => void,
  ): Promise<void>;
  acceptAudio(sessionId: string, chunk: Pcm16AudioChunk): Promise<void>;
  finish(sessionId: string): Promise<string>;
  cancel(sessionId: string): Promise<void>;
  destroy(): Promise<void>;
  /** Optional and only invoked by the user's explicit download action. */
  prepareModel?(locale: string): Promise<SpeechModelState>;
}

type ActiveSession = {
  id: string;
  locale: string;
  generation: number;
  phase: 'starting' | 'listening' | 'stopping';
  audioChain: Promise<void>;
  stopPromise?: Promise<boolean>;
};

const APP_OWNED_METADATA = {
  provider: 'app-owned-offline' as const,
  route: 'app-owned-offline' as const,
  modelState: 'READY' as const,
  mayUseNetwork: false,
  captureOwnership: 'app' as const,
  endpointOwnership: 'app' as const,
};

function codedError(code: SpeechErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export class AppOwnedOfflineSpeechRecognitionPort implements SpeechRecognitionPort {
  private readonly listeners = new Set<
    (event: SpeechRecognitionEvent) => void
  >();
  private active?: ActiveSession;
  private generation = 0;

  constructor(
    private readonly capture: AppOwnedAudioCapture,
    private readonly decoder: OfflineSpeechDecoder,
  ) {}

  async getCapabilities(locale: string): Promise<SpeechCapabilities> {
    const [capture, decoder] = await Promise.all([
      this.capture.getAvailability(),
      this.decoder.getModelState(locale),
    ]);
    const available = capture.available && decoder.modelState === 'READY';
    return {
      available,
      onDeviceAvailable: available,
      locale,
      platform: 'unknown',
      modelState: decoder.modelState,
      permissionStatus: capture.permissionStatus,
      stage: 'capability',
      providers: [
        {
          ...APP_OWNED_METADATA,
          available,
          modelState: decoder.modelState,
          requiresMicrophonePermission: true,
          stage: 'capability',
          diagnosticCode: decoder.diagnosticCode ?? capture.diagnosticCode,
        },
      ],
    };
  }

  async downloadModel(locale: string): Promise<SpeechModelDownloadResult> {
    const current = await this.decoder.getModelState(locale);
    const modelState =
      this.decoder.prepareModel === undefined
        ? current.modelState
        : await this.decoder.prepareModel(locale);
    return {
      locale,
      provider: 'app-owned-offline',
      modelState,
      stage: 'model-preparation',
    };
  }

  requestPermission(sessionId: string): Promise<SpeechPermissionResult> {
    return this.capture.requestPermission(sessionId);
  }

  async start(options: SpeechStartOptions): Promise<void> {
    if (this.active !== undefined) {
      throw codedError(
        'busy',
        'An app-owned speech session is already active.',
      );
    }
    const capabilities = await this.getCapabilities(options.locale);
    if (!capabilities.available) {
      throw codedError(
        capabilities.modelState === 'READY'
          ? 'service-unavailable'
          : 'model-missing',
        'App-owned offline speech is not ready.',
      );
    }

    const generation = ++this.generation;
    const session: ActiveSession = {
      id: options.sessionId,
      locale: options.locale,
      generation,
      phase: 'starting',
      audioChain: Promise.resolve(),
    };
    this.active = session;
    this.emit({
      type: 'state',
      sessionId: session.id,
      generation: session.generation,
      state: 'starting',
      stage: 'start',
      ...APP_OWNED_METADATA,
    });

    try {
      await this.decoder.start(session.id, session.locale, text => {
        if (this.isCurrent(session.id, generation)) {
          this.emit({
            type: 'partial',
            sessionId: session.id,
            generation: session.generation,
            text,
            stage: 'listening',
            ...APP_OWNED_METADATA,
          });
        }
      });
      await this.capture.start(session.id, {
        onAudio: chunk => this.enqueueAudio(session.id, generation, chunk),
        onError: (code, message) =>
          this.finishWithError(session.id, generation, code, message),
        onInterrupted: message =>
          this.finishWithError(session.id, generation, 'audio', message),
      });
    } catch (error) {
      if (this.isCurrent(session.id, generation)) {
        await this.cancelDependencies(session.id);
        this.active = undefined;
      }
      throw error;
    }

    if (!this.isCurrent(session.id, generation)) {
      return;
    }
    session.phase = 'listening';
    this.emit({
      type: 'state',
      sessionId: session.id,
      generation: session.generation,
      state: 'listening',
      stage: 'listening',
      ...APP_OWNED_METADATA,
    });
  }

  stop(sessionId: string): Promise<boolean> {
    const session = this.active;
    if (session === undefined || session.id !== sessionId) {
      return Promise.resolve(false);
    }
    if (session.stopPromise !== undefined) {
      return session.stopPromise;
    }
    session.phase = 'stopping';
    this.emit({
      type: 'state',
      sessionId,
      generation: session.generation,
      state: 'processing',
      stage: 'result',
      endReason: 'user-stop',
      ...APP_OWNED_METADATA,
    });
    session.stopPromise = this.finishAfterUserStop(session);
    return session.stopPromise;
  }

  async cancel(sessionId: string): Promise<void> {
    const session = this.active;
    if (session === undefined || session.id !== sessionId) {
      return;
    }
    this.active = undefined;
    this.generation += 1;
    await this.cancelDependencies(sessionId);
    this.emit({
      type: 'state',
      sessionId,
      generation: session.generation,
      state: 'cancelled',
      stage: 'lifecycle',
      endReason: 'cancelled',
      ...APP_OWNED_METADATA,
    });
  }

  async destroy(sessionId: string): Promise<void> {
    await this.cancel(sessionId);
    await Promise.all([this.capture.destroy(), this.decoder.destroy()]);
    this.listeners.clear();
  }

  subscribe(listener: (event: SpeechRecognitionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private enqueueAudio(
    sessionId: string,
    generation: number,
    chunk: Pcm16AudioChunk,
  ): void {
    const session = this.active;
    if (
      session === undefined ||
      session.id !== sessionId ||
      session.generation !== generation ||
      session.phase === 'stopping'
    ) {
      return;
    }
    session.audioChain = session.audioChain
      .then(() => {
        if (!this.isCurrent(sessionId, generation)) {
          return;
        }
        return this.decoder.acceptAudio(sessionId, chunk);
      })
      .catch(() => {
        this.finishWithError(
          sessionId,
          generation,
          'audio',
          '离线语音音频处理失败，请重试。',
        );
      });
  }

  private async finishAfterUserStop(session: ActiveSession): Promise<boolean> {
    try {
      await this.capture.stop(session.id);
      await session.audioChain;
      const text = await this.decoder.finish(session.id);
      if (!this.isCurrent(session.id, session.generation)) {
        return false;
      }
      this.active = undefined;
      this.emit({
        type: 'final',
        sessionId: session.id,
        generation: session.generation,
        text,
        stage: 'result',
        endReason: 'user-stop',
        ...APP_OWNED_METADATA,
      });
      return true;
    } catch {
      this.finishWithError(
        session.id,
        session.generation,
        'audio',
        '离线语音收尾失败，请重试。',
      );
      return true;
    }
  }

  private finishWithError(
    sessionId: string,
    generation: number,
    code: SpeechErrorCode,
    message?: string,
  ): void {
    if (!this.isCurrent(sessionId, generation)) {
      return;
    }
    this.active = undefined;
    this.generation += 1;
    this.cancelDependencies(sessionId).catch(() => undefined);
    this.emit({
      type: 'error',
      sessionId,
      generation,
      code,
      message,
      retryable: true,
      stage: 'result',
      ...APP_OWNED_METADATA,
    });
  }

  private async cancelDependencies(sessionId: string): Promise<void> {
    await Promise.allSettled([
      this.capture.cancel(sessionId),
      this.decoder.cancel(sessionId),
    ]);
  }

  private isCurrent(sessionId: string, generation: number): boolean {
    return (
      this.active?.id === sessionId && this.active.generation === generation
    );
  }

  private emit(event: SpeechRecognitionEvent): void {
    this.listeners.forEach(listener => listener(event));
  }
}

const UNAVAILABLE_CAPTURE: AppOwnedAudioCapture = {
  async getAvailability() {
    return {
      available: false,
      permissionStatus: 'not-determined',
      diagnosticCode: 'app-owned-audio-capture-not-configured',
    };
  },
  async requestPermission() {
    return { status: 'restricted', canAskAgain: false };
  },
  async start() {
    throw codedError(
      'service-unavailable',
      'App-owned audio capture is unavailable.',
    );
  },
  async stop() {},
  async cancel() {},
  async destroy() {},
};

const UNAVAILABLE_DECODER: OfflineSpeechDecoder = {
  async getModelState() {
    return {
      modelState: 'UNSUPPORTED',
      diagnosticCode: 'offline-decoder-not-configured',
    };
  },
  async start() {
    throw codedError('model-missing', 'Offline speech decoder is unavailable.');
  },
  async acceptAudio() {},
  async finish() {
    return '';
  },
  async cancel() {},
  async destroy() {},
};

/** Safe default: advertises unavailable and cannot open a microphone/network. */
export function createUnavailableAppOwnedOfflineSpeechRecognitionPort(): SpeechRecognitionPort {
  return new AppOwnedOfflineSpeechRecognitionPort(
    UNAVAILABLE_CAPTURE,
    UNAVAILABLE_DECODER,
  );
}
