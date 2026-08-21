import { NativeEventEmitter, NativeModules } from 'react-native';

import type {
  NativeSpeechState,
  SpeechCaptureOwnership,
  SpeechCapabilities,
  SpeechDiagnosticStage,
  SpeechErrorCode,
  SpeechEndReason,
  SpeechEndpointOwnership,
  SpeechModelDownloadResult,
  SpeechModelOption,
  SpeechModelState,
  SpeechPermissionResult,
  SpeechProvider,
  SpeechProviderCapability,
  SpeechRecognitionEvent,
  SpeechRecognitionPort,
  SpeechRoute,
  SpeechStartOptions,
} from './types';

type NativeSpeechEventNames = {
  state: string;
  partial: string;
  final: string;
  error: string;
  audioState?: string;
};

const SYSTEM_EVENT_NAMES: NativeSpeechEventNames = {
  state: 'SpeechRecognitionState',
  partial: 'SpeechRecognitionPartial',
  final: 'SpeechRecognitionFinal',
  error: 'SpeechRecognitionError',
};

const EMBEDDED_EVENT_NAMES: NativeSpeechEventNames = {
  state: 'EmbeddedSpeechRecognitionState',
  // App-owned streaming engines use a dedicated partial channel so PCM never
  // crosses the React Native bridge or mixes with system-provider events.
  partial: 'EmbeddedSpeechRecognitionPartial',
  final: 'EmbeddedSpeechRecognitionFinal',
  error: 'EmbeddedSpeechRecognitionError',
  audioState: 'EmbeddedSpeechRecognitionAudioState',
};

type NativeSpeechModule = {
  getCapabilities(locale: string): Promise<unknown>;
  getModels?: () => Promise<unknown>;
  selectModel?: (modelId: string) => Promise<unknown>;
  downloadModel?: (locale: string) => Promise<unknown>;
  requestPermission(sessionId: string): Promise<SpeechPermissionResult>;
  start(
    sessionId: string,
    locale: string,
    preferOnDevice: boolean,
    allowNetworkFallback: boolean,
  ): Promise<void>;
  start(
    sessionId: string,
    generation: number,
    locale: string,
    preferOnDevice: boolean,
    allowNetworkFallback: boolean,
  ): Promise<void>;
  stop(sessionId: string): Promise<unknown>;
  cancel(sessionId: string): Promise<void>;
  destroy(sessionId: string): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

type NativePayload = {
  sessionId?: unknown;
  generation?: unknown;
  state?: unknown;
  text?: unknown;
  transcript?: unknown;
  code?: unknown;
  message?: unknown;
  androidErrorCode?: unknown;
  nativeCode?: unknown;
  mode?: unknown;
  provider?: unknown;
  route?: unknown;
  modelState?: unknown;
  stage?: unknown;
  mayUseNetwork?: unknown;
  captureOwnership?: unknown;
  endpointOwnership?: unknown;
  endReason?: unknown;
  retryable?: unknown;
  recoverable?: unknown;
  acousticConfidence?: unknown;
  audioQuality?: unknown;
  endpointHinted?: unknown;
  volumeLevel?: unknown;
  speechDetected?: unknown;
  trailingSilenceMs?: unknown;
  speechModelId?: unknown;
};

const ERROR_CODES = new Set<SpeechErrorCode>([
  'permission-denied',
  'permission-blocked',
  'microphone-disabled',
  'microphone-unavailable',
  'service-unavailable',
  'service-incompatible',
  'model-missing',
  'model-status-unknown',
  'model-download-failed',
  'capability-timeout',
  'language-not-supported',
  'no-speech',
  'network',
  'audio',
  'busy',
  'recording-too-long',
  'result-too-long',
  'cancelled',
  'unknown',
]);

const PROVIDERS = new Set<SpeechProvider>([
  'app-owned-offline',
  'android-on-device',
  'android-system-activity',
  'android-direct-system',
  'ios-on-device',
  'ios-system',
  'unknown',
]);
const ROUTES = new Set<SpeechRoute>([
  'app-owned-offline',
  'on-device',
  'system-activity',
  'direct-system',
  'system-network',
  'unknown',
]);
const OWNERSHIP = new Set<SpeechCaptureOwnership>([
  'app',
  'system-provider',
  'external-provider',
  'unknown',
]);
const END_REASONS = new Set<SpeechEndReason>([
  'user-stop',
  'provider-endpoint',
  'external-activity',
  'cancelled',
  'unknown',
]);
const MODEL_STATES = new Set<SpeechModelState>([
  'READY',
  'DOWNLOADABLE',
  'DOWNLOADING',
  'UNSUPPORTED',
  'UNKNOWN',
]);
const STAGES = new Set<SpeechDiagnosticStage>([
  'capability',
  'permission',
  'model-preparation',
  'start',
  'listening',
  'result',
  'lifecycle',
  'unknown',
]);

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function valueFromSet<T extends string>(
  value: unknown,
  values: Set<T>,
  fallback: T,
): T {
  return typeof value === 'string' && values.has(value as T)
    ? (value as T)
    : fallback;
}

function providerOf(value: unknown): SpeechProvider {
  return valueFromSet(value, PROVIDERS, 'unknown');
}

function routeOf(value: unknown): SpeechRoute {
  return valueFromSet(value, ROUTES, 'unknown');
}

function modelStateOf(value: unknown): SpeechModelState {
  return valueFromSet(value, MODEL_STATES, 'UNKNOWN');
}

function stageOf(value: unknown): SpeechDiagnosticStage {
  return valueFromSet(value, STAGES, 'unknown');
}

function ownershipOf(value: unknown): SpeechCaptureOwnership {
  return valueFromSet(value, OWNERSHIP, 'unknown');
}

function endReasonOf(value: unknown): SpeechEndReason | undefined {
  const reason = valueFromSet(value, END_REASONS, 'unknown');
  return reason === 'unknown' ? undefined : reason;
}

function legacyOwnership(route: SpeechRoute): {
  captureOwnership: SpeechCaptureOwnership;
  endpointOwnership: SpeechEndpointOwnership;
} {
  if (route === 'app-owned-offline') {
    return { captureOwnership: 'app', endpointOwnership: 'app' };
  }
  if (route === 'system-activity') {
    return {
      captureOwnership: 'external-provider',
      endpointOwnership: 'external-provider',
    };
  }
  if (
    route === 'on-device' ||
    route === 'direct-system' ||
    route === 'system-network'
  ) {
    return {
      captureOwnership: 'system-provider',
      endpointOwnership: 'system-provider',
    };
  }
  return { captureOwnership: 'unknown', endpointOwnership: 'unknown' };
}

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

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function audioQualityOf(value: unknown) {
  const raw = recordOf(value);
  const clippingRatio = finiteNumber(raw.clippingRatio);
  const voicedDurationMs = finiteNumber(raw.voicedDurationMs);
  if (clippingRatio === undefined || voicedDurationMs === undefined) {
    return undefined;
  }
  return {
    estimatedSnrDb: finiteNumber(raw.estimatedSnrDb),
    clippingRatio,
    voicedDurationMs,
    noiseTooHigh: raw.noiseTooHigh === true,
  };
}

function metadataOf(payload: NativePayload) {
  const legacyMode =
    typeof payload.mode === 'string' ? payload.mode : undefined;
  const legacyProvider: SpeechProvider =
    legacyMode === 'on-device'
      ? 'android-on-device'
      : legacyMode === 'system-activity'
        ? 'android-system-activity'
        : legacyMode === 'direct-system'
          ? 'android-direct-system'
          : 'unknown';
  const legacyRoute: SpeechRoute =
    legacyMode === 'on-device' ||
    legacyMode === 'system-activity' ||
    legacyMode === 'direct-system'
      ? legacyMode
      : 'unknown';
  const provider = providerOf(payload.provider);
  const route = routeOf(payload.route);
  const normalizedRoute = route === 'unknown' ? legacyRoute : route;
  const ownership = legacyOwnership(normalizedRoute);
  const captureOwnership = ownershipOf(payload.captureOwnership);
  const endpointOwnership = ownershipOf(payload.endpointOwnership);
  return {
    generation:
      typeof payload.generation === 'number' &&
      Number.isInteger(payload.generation)
        ? payload.generation
        : undefined,
    provider: provider === 'unknown' ? legacyProvider : provider,
    route: normalizedRoute,
    modelState: modelStateOf(payload.modelState),
    stage: stageOf(payload.stage),
    mayUseNetwork:
      typeof payload.mayUseNetwork === 'boolean'
        ? payload.mayUseNetwork
        : undefined,
    captureOwnership:
      captureOwnership === 'unknown'
        ? ownership.captureOwnership
        : captureOwnership,
    endpointOwnership:
      endpointOwnership === 'unknown'
        ? ownership.endpointOwnership
        : endpointOwnership,
    endReason: endReasonOf(payload.endReason),
    speechModelId:
      typeof payload.speechModelId === 'string' && payload.speechModelId.length > 0
        ? payload.speechModelId
        : undefined,
  };
}

function normalizeProviderCapability(
  value: unknown,
): SpeechProviderCapability | undefined {
  const raw = recordOf(value);
  const provider = providerOf(raw.provider);
  if (provider === 'unknown') {
    return undefined;
  }
  const route = routeOf(raw.route);
  const ownership = legacyOwnership(route);
  const captureOwnership = ownershipOf(raw.captureOwnership);
  const endpointOwnership = ownershipOf(raw.endpointOwnership);
  return {
    provider,
    route,
    available: raw.available === true,
    modelState: modelStateOf(raw.modelState),
    requiresMicrophonePermission: raw.requiresMicrophonePermission !== false,
    mayUseNetwork: raw.mayUseNetwork === true,
    captureOwnership:
      captureOwnership === 'unknown'
        ? ownership.captureOwnership
        : captureOwnership,
    endpointOwnership:
      endpointOwnership === 'unknown'
        ? ownership.endpointOwnership
        : endpointOwnership,
    stage: stageOf(raw.stage),
    diagnosticCode:
      typeof raw.diagnosticCode === 'string' ? raw.diagnosticCode : undefined,
    speechModelId:
      typeof raw.speechModelId === 'string' ? raw.speechModelId : undefined,
  };
}

export function normalizeSpeechCapabilities(
  value: unknown,
  requestedLocale: string,
): SpeechCapabilities {
  const raw = recordOf(value);
  const platform =
    raw.platform === 'android' || raw.platform === 'ios'
      ? raw.platform
      : 'unknown';
  const onDeviceAvailable = raw.onDeviceAvailable === true;
  const hasExplicitModelState =
    typeof raw.modelState === 'string' &&
    MODEL_STATES.has(raw.modelState as SpeechModelState);
  const modelState = hasExplicitModelState
    ? modelStateOf(raw.modelState)
    : 'UNKNOWN';
  const richProviders = Array.isArray(raw.providers)
    ? raw.providers
        .map(normalizeProviderCapability)
        .filter(
          (provider): provider is SpeechProviderCapability =>
            provider !== undefined,
        )
    : [];

  // Synthesize a conservative provider view for an already installed old
  // native binary. Unknown never means that a local model is ready.
  const providers =
    richProviders.length > 0
      ? richProviders
      : [
          ...(onDeviceAvailable
            ? [
                {
                  provider:
                    platform === 'android'
                      ? ('android-on-device' as const)
                      : platform === 'ios'
                        ? ('ios-on-device' as const)
                        : ('unknown' as const),
                  route: 'on-device' as const,
                  available: true,
                  modelState: 'UNKNOWN' as const,
                  requiresMicrophonePermission: true,
                  mayUseNetwork: false,
                  stage: 'capability' as const,
                },
              ]
            : []),
          ...(raw.available === true
            ? [
                {
                  provider:
                    platform === 'ios'
                      ? ('ios-system' as const)
                      : platform === 'android'
                        ? ('android-direct-system' as const)
                        : ('unknown' as const),
                  route:
                    platform === 'ios'
                      ? ('system-network' as const)
                      : platform === 'android'
                        ? ('direct-system' as const)
                        : ('unknown' as const),
                  available: true,
                  modelState: 'UNKNOWN' as const,
                  requiresMicrophonePermission: true,
                  mayUseNetwork: true,
                  stage: 'capability' as const,
                },
              ]
            : []),
        ].filter(provider => provider.provider !== 'unknown');

  return {
    available:
      raw.available === true || providers.some(provider => provider.available),
    onDeviceAvailable:
      onDeviceAvailable ||
      providers.some(
        provider =>
          provider.route === 'on-device' &&
          provider.available &&
          provider.modelState === 'READY',
      ),
    locale:
      typeof raw.locale === 'string' && raw.locale.length > 0
        ? raw.locale
        : requestedLocale,
    platform,
    modelState,
    providers,
    stage: stageOf(raw.stage) === 'unknown' ? 'capability' : stageOf(raw.stage),
    permissionStatus:
      raw.permissionStatus === 'granted' ||
      raw.permissionStatus === 'denied' ||
      raw.permissionStatus === 'blocked' ||
      raw.permissionStatus === 'restricted' ||
      raw.permissionStatus === 'not-determined'
        ? raw.permissionStatus
        : undefined,
    speechModelId:
      typeof raw.speechModelId === 'string' ? raw.speechModelId : undefined,
  };
}

export type EmbeddedSpeechModelCatalog = {
  models: SpeechModelOption[];
  selectedModelId?: string;
};

export async function getEmbeddedSpeechModels(): Promise<EmbeddedSpeechModelCatalog> {
  const module = nativeModule('EmbeddedSpeechRecognition');
  if (module?.getModels === undefined) return { models: [] };
  const raw = recordOf(await module.getModels());
  const models = Array.isArray(raw.models)
    ? raw.models.flatMap(value => {
        const model = recordOf(value);
        const size = finiteNumber(model.compressedSizeBytes);
        if (
          typeof model.id !== 'string' ||
          model.id.length === 0 ||
          typeof model.label !== 'string' ||
          typeof model.description !== 'string' ||
          size === undefined ||
          size < 0
        ) {
          return [];
        }
        return [{
          id: model.id,
          label: model.label,
          description: model.description,
          compressedSizeBytes: size,
        }];
      })
    : [];
  return {
    models,
    selectedModelId:
      typeof raw.selectedModelId === 'string' ? raw.selectedModelId : undefined,
  };
}

export async function selectEmbeddedSpeechModel(modelId: string): Promise<string> {
  const module = nativeModule('EmbeddedSpeechRecognition');
  if (module?.selectModel === undefined) {
    throw Object.assign(new Error('This build does not support speech model switching.'), {
      code: 'service-unavailable',
    });
  }
  const raw = recordOf(await module.selectModel(modelId));
  return typeof raw.selectedModelId === 'string' ? raw.selectedModelId : modelId;
}

function nativeModule(name: string): NativeSpeechModule | undefined {
  return NativeModules[name] as NativeSpeechModule | undefined;
}

class UnavailableSpeechRecognitionPort implements SpeechRecognitionPort {
  async getCapabilities(locale: string): Promise<SpeechCapabilities> {
    return {
      available: false,
      onDeviceAvailable: false,
      locale,
      platform: 'unknown',
      modelState: 'UNKNOWN',
      providers: [],
      stage: 'capability',
    };
  }

  async downloadModel(locale: string): Promise<SpeechModelDownloadResult> {
    return {
      locale,
      provider: 'unknown',
      modelState: 'UNKNOWN',
      stage: 'model-preparation',
    };
  }

  async requestPermission(_sessionId: string): Promise<SpeechPermissionResult> {
    return { status: 'denied', canAskAgain: false };
  }

  async start(_options: SpeechStartOptions): Promise<void> {
    throw Object.assign(new Error('Speech recognition is unavailable.'), {
      code: 'service-unavailable',
    });
  }

  async stop(_sessionId: string): Promise<boolean> {
    return false;
  }

  async cancel(_sessionId: string): Promise<void> {}

  async destroy(_sessionId: string): Promise<void> {}

  subscribe(_listener: (event: SpeechRecognitionEvent) => void): () => void {
    return () => undefined;
  }
}

class NativeSpeechRecognitionPort implements SpeechRecognitionPort {
  constructor(
    private readonly module: NativeSpeechModule,
    private readonly eventNames: NativeSpeechEventNames,
    private readonly passesGeneration = false,
  ) {}

  async getCapabilities(locale: string): Promise<SpeechCapabilities> {
    return normalizeSpeechCapabilities(
      await this.module.getCapabilities(locale),
      locale,
    );
  }

  async downloadModel(locale: string): Promise<SpeechModelDownloadResult> {
    if (this.module.downloadModel === undefined) {
      return {
        locale,
        provider: 'unknown',
        modelState: 'UNKNOWN',
        stage: 'model-preparation',
      };
    }
    const raw = recordOf(await this.module.downloadModel(locale));
    return {
      locale:
        typeof raw.locale === 'string' && raw.locale.length > 0
          ? raw.locale
          : locale,
      provider: providerOf(raw.provider),
      modelState: modelStateOf(raw.modelState),
      stage: 'model-preparation',
    };
  }

  requestPermission(sessionId: string): Promise<SpeechPermissionResult> {
    return this.module.requestPermission(sessionId);
  }

  start(options: SpeechStartOptions): Promise<void> {
    if (this.passesGeneration) {
      return this.module.start(
        options.sessionId,
        options.generation ?? 0,
        options.locale,
        options.preferOnDevice,
        options.allowNetworkFallback,
      );
    }
    return this.module.start(
      options.sessionId,
      options.locale,
      options.preferOnDevice,
      options.allowNetworkFallback,
    );
  }

  async stop(sessionId: string): Promise<boolean> {
    return (await this.module.stop(sessionId)) === true;
  }

  cancel(sessionId: string): Promise<void> {
    return this.module.cancel(sessionId);
  }

  destroy(sessionId: string): Promise<void> {
    return this.module.destroy(sessionId);
  }

  subscribe(listener: (event: SpeechRecognitionEvent) => void): () => void {
    const emitter = new NativeEventEmitter(this.module);
    const subscriptions = [
      emitter.addListener(this.eventNames.state, (payload: NativePayload) => {
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
            ...metadataOf(payload),
          });
        }
      }),
      emitter.addListener(this.eventNames.partial, (payload: NativePayload) => {
        const sessionId = sessionIdOf(payload);
        const text = textOf(payload);
        if (sessionId !== undefined && text !== undefined) {
          listener({
            type: 'partial',
            sessionId,
            text,
            ...metadataOf(payload),
          });
        }
      }),
      emitter.addListener(this.eventNames.final, (payload: NativePayload) => {
        const sessionId = sessionIdOf(payload);
        const text = textOf(payload);
        if (sessionId !== undefined && text !== undefined) {
          listener({
            type: 'final',
            sessionId,
            text,
            acousticConfidence: finiteNumber(payload.acousticConfidence),
            audioQuality: audioQualityOf(payload.audioQuality),
            endpointHinted:
              typeof payload.endpointHinted === 'boolean'
                ? payload.endpointHinted
                : undefined,
            ...metadataOf(payload),
          });
        }
      }),
      emitter.addListener(this.eventNames.error, (payload: NativePayload) => {
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
            nativeCode:
              typeof payload.nativeCode === 'number'
                ? payload.nativeCode
                : undefined,
            mode: typeof payload.mode === 'string' ? payload.mode : undefined,
            retryable:
              typeof payload.retryable === 'boolean'
                ? payload.retryable
                : typeof payload.recoverable === 'boolean'
                  ? payload.recoverable
                  : undefined,
            ...metadataOf(payload),
          });
        }
      }),
    ];
    if (this.eventNames.audioState !== undefined) {
      subscriptions.push(
        emitter.addListener(
          this.eventNames.audioState,
          (payload: NativePayload) => {
            const sessionId = sessionIdOf(payload);
            const volumeLevel = finiteNumber(payload.volumeLevel);
            const trailingSilenceMs = finiteNumber(payload.trailingSilenceMs);
            if (
              sessionId !== undefined &&
              volumeLevel !== undefined &&
              trailingSilenceMs !== undefined
            ) {
              listener({
                type: 'audio-state',
                sessionId,
                volumeLevel: Math.max(0, Math.min(1, volumeLevel)),
                speechDetected: payload.speechDetected === true,
                trailingSilenceMs: Math.max(0, trailingSilenceMs),
                endpointHinted: payload.endpointHinted === true,
                ...metadataOf(payload),
              });
            }
          },
        ),
      );
    }
    return () => subscriptions.forEach(subscription => subscription.remove());
  }
}

export function createNativeSpeechRecognitionPort(): SpeechRecognitionPort {
  const module = nativeModule('SpeechRecognition');
  return module === undefined
    ? new UnavailableSpeechRecognitionPort()
    : new NativeSpeechRecognitionPort(module, SYSTEM_EVENT_NAMES);
}

export function createNativeEmbeddedSpeechRecognitionPort(): SpeechRecognitionPort {
  const module = nativeModule('EmbeddedSpeechRecognition');
  return module === undefined
    ? new UnavailableSpeechRecognitionPort()
    : new NativeSpeechRecognitionPort(module, EMBEDDED_EVENT_NAMES, true);
}
