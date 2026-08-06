import { NativeEventEmitter, NativeModules } from 'react-native';

import type {
  NativeSpeechState,
  SpeechCapabilities,
  SpeechErrorCode,
  SpeechPermissionResult,
  SpeechRecognitionEvent,
  SpeechRecognitionPort,
  SpeechStartOptions,
} from './types';

const EVENT_STATE = 'SpeechRecognitionState';
const EVENT_PARTIAL = 'SpeechRecognitionPartial';
const EVENT_FINAL = 'SpeechRecognitionFinal';
const EVENT_ERROR = 'SpeechRecognitionError';

type NativeSpeechModule = {
  getCapabilities(locale: string): Promise<SpeechCapabilities>;
  requestPermission(): Promise<SpeechPermissionResult>;
  start(
    sessionId: string,
    locale: string,
    preferOnDevice: boolean,
    allowNetworkFallback: boolean,
  ): Promise<void>;
  stop(sessionId: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  destroy(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

type NativePayload = {
  sessionId?: unknown;
  state?: unknown;
  text?: unknown;
  transcript?: unknown;
  code?: unknown;
  message?: unknown;
  androidErrorCode?: unknown;
  mode?: unknown;
  retryable?: unknown;
};

const ERROR_CODES = new Set<SpeechErrorCode>([
  'permission-denied',
  'permission-blocked',
  'service-unavailable',
  'service-incompatible',
  'model-missing',
  'language-not-supported',
  'no-speech',
  'network',
  'audio',
  'busy',
  'cancelled',
  'unknown',
]);

function sessionIdOf(payload: NativePayload): string | undefined {
  return typeof payload.sessionId === 'string' && payload.sessionId.length > 0
    ? payload.sessionId
    : undefined;
}

function errorCodeOf(value: unknown): SpeechErrorCode {
  return typeof value === 'string' && ERROR_CODES.has(value as SpeechErrorCode)
    ? (value as SpeechErrorCode)
    : 'unknown';
}

function textOf(payload: NativePayload): string | undefined {
  if (typeof payload.text === 'string') {
    return payload.text;
  }
  // Accept the former Android field during upgrades from an already installed build.
  return typeof payload.transcript === 'string'
    ? payload.transcript
    : undefined;
}

function nativeModule(): NativeSpeechModule | undefined {
  return NativeModules.SpeechRecognition as NativeSpeechModule | undefined;
}

class UnavailableSpeechRecognitionPort implements SpeechRecognitionPort {
  async getCapabilities(locale: string): Promise<SpeechCapabilities> {
    return {
      available: false,
      onDeviceAvailable: false,
      locale,
      platform: 'unknown',
    };
  }

  async requestPermission(): Promise<SpeechPermissionResult> {
    return { status: 'denied', canAskAgain: false };
  }

  async start(_options: SpeechStartOptions): Promise<void> {
    throw Object.assign(new Error('Speech recognition is unavailable.'), {
      code: 'service-unavailable',
    });
  }

  async stop(_sessionId: string): Promise<void> {}

  async cancel(_sessionId: string): Promise<void> {}

  async destroy(): Promise<void> {}

  subscribe(_listener: (event: SpeechRecognitionEvent) => void): () => void {
    return () => undefined;
  }
}

class NativeSpeechRecognitionPort implements SpeechRecognitionPort {
  constructor(private readonly module: NativeSpeechModule) {}

  getCapabilities(locale: string): Promise<SpeechCapabilities> {
    return this.module.getCapabilities(locale);
  }

  requestPermission(): Promise<SpeechPermissionResult> {
    return this.module.requestPermission();
  }

  start(options: SpeechStartOptions): Promise<void> {
    return this.module.start(
      options.sessionId,
      options.locale,
      options.preferOnDevice,
      options.allowNetworkFallback,
    );
  }

  stop(sessionId: string): Promise<void> {
    return this.module.stop(sessionId);
  }

  cancel(sessionId: string): Promise<void> {
    return this.module.cancel(sessionId);
  }

  destroy(): Promise<void> {
    return this.module.destroy();
  }

  subscribe(listener: (event: SpeechRecognitionEvent) => void): () => void {
    const emitter = new NativeEventEmitter(this.module);
    const subscriptions = [
      emitter.addListener(EVENT_STATE, (payload: NativePayload) => {
        const sessionId = sessionIdOf(payload);
        if (
          sessionId !== undefined &&
          typeof payload.state === 'string' &&
          ['starting', 'listening', 'processing', 'cancelled'].includes(
            payload.state,
          )
        ) {
          listener({
            type: 'state',
            sessionId,
            state: payload.state as NativeSpeechState,
          });
        }
      }),
      emitter.addListener(EVENT_PARTIAL, (payload: NativePayload) => {
        const sessionId = sessionIdOf(payload);
        const text = textOf(payload);
        if (sessionId !== undefined && text !== undefined) {
          listener({ type: 'partial', sessionId, text });
        }
      }),
      emitter.addListener(EVENT_FINAL, (payload: NativePayload) => {
        const sessionId = sessionIdOf(payload);
        const text = textOf(payload);
        if (sessionId !== undefined && text !== undefined) {
          listener({ type: 'final', sessionId, text });
        }
      }),
      emitter.addListener(EVENT_ERROR, (payload: NativePayload) => {
        const sessionId = sessionIdOf(payload);
        if (sessionId !== undefined) {
          listener({
            type: 'error',
            sessionId,
            code: errorCodeOf(payload.code),
            message:
              typeof payload.message === 'string' ? payload.message : undefined,
            androidErrorCode:
              typeof payload.androidErrorCode === 'number'
                ? payload.androidErrorCode
                : undefined,
            mode: typeof payload.mode === 'string' ? payload.mode : undefined,
            retryable:
              typeof payload.retryable === 'boolean'
                ? payload.retryable
                : undefined,
          });
        }
      }),
    ];
    return () => subscriptions.forEach(subscription => subscription.remove());
  }
}

export function createNativeSpeechRecognitionPort(): SpeechRecognitionPort {
  const module = nativeModule();
  return module === undefined
    ? new UnavailableSpeechRecognitionPort()
    : new NativeSpeechRecognitionPort(module);
}
