export type SpeechRecognitionStatus =
  | 'IDLE'
  | 'CHECKING_AVAILABILITY'
  | 'PREPARING_MODEL'
  | 'REQUESTING_PERMISSION'
  | 'STARTING'
  | 'LISTENING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'ERROR'
  | 'CANCELLED';

export type SpeechPermissionStatus =
  'granted' | 'denied' | 'blocked' | 'restricted';

export type SpeechProvider =
  | 'app-owned-offline'
  | 'android-on-device'
  | 'android-system-activity'
  | 'android-direct-system'
  | 'ios-on-device'
  | 'ios-system'
  | 'unknown';

export type SpeechRoute =
  | 'app-owned-offline'
  | 'on-device'
  | 'system-activity'
  | 'direct-system'
  | 'system-network'
  | 'unknown';

/** Who opens and closes the microphone/audio source for one speech route. */
export type SpeechCaptureOwnership =
  'app' | 'system-provider' | 'external-provider' | 'unknown';

/** Who decides that the user has finished speaking. */
export type SpeechEndpointOwnership =
  'app' | 'system-provider' | 'external-provider' | 'unknown';

export type SpeechEndReason =
  | 'user-stop'
  | 'provider-endpoint'
  | 'external-activity'
  | 'cancelled'
  | 'unknown';

export type SpeechModelState =
  'READY' | 'DOWNLOADABLE' | 'DOWNLOADING' | 'UNSUPPORTED' | 'UNKNOWN';

export type SpeechModelOption = {
  id: string;
  label: string;
  description: string;
  compressedSizeBytes: number;
};

export type SpeechDiagnosticStage =
  | 'capability'
  | 'permission'
  | 'model-preparation'
  | 'start'
  | 'listening'
  | 'result'
  | 'lifecycle'
  | 'unknown';

export type SpeechErrorCode =
  | 'permission-denied'
  | 'permission-blocked'
  | 'microphone-disabled'
  | 'microphone-unavailable'
  | 'service-unavailable'
  | 'service-incompatible'
  | 'model-missing'
  | 'model-status-unknown'
  | 'model-download-failed'
  | 'capability-timeout'
  | 'language-not-supported'
  | 'no-speech'
  | 'network'
  | 'audio'
  | 'busy'
  | 'recording-too-long'
  | 'result-too-long'
  | 'cancelled'
  | 'unknown';

export type SpeechCapabilities = {
  available: boolean;
  onDeviceAvailable: boolean;
  locale: string;
  platform: 'android' | 'ios' | 'unknown';
  /** Aggregate state of the requested locale's app-local/on-device model. */
  modelState?: SpeechModelState;
  /** Provider-specific facts. Optional to remain compatible with older installed native builds. */
  providers?: SpeechProviderCapability[];
  stage?: SpeechDiagnosticStage;
  permissionStatus?: SpeechPermissionStatus | 'not-determined';
  speechModelId?: string;
};

export type SpeechProviderCapability = {
  provider: SpeechProvider;
  route: SpeechRoute;
  available: boolean;
  modelState: SpeechModelState;
  requiresMicrophonePermission: boolean;
  mayUseNetwork: boolean;
  captureOwnership?: SpeechCaptureOwnership;
  endpointOwnership?: SpeechEndpointOwnership;
  stage?: SpeechDiagnosticStage;
  diagnosticCode?: string;
  speechModelId?: string;
};

export type SpeechModelDownloadResult = {
  locale: string;
  provider: SpeechProvider;
  modelState: SpeechModelState;
  stage: SpeechDiagnosticStage;
};

export type SpeechPermissionResult = {
  status: SpeechPermissionStatus;
  canAskAgain: boolean;
  reason?: 'microphone-disabled' | 'microphone-unavailable';
};

export type SpeechStartOptions = {
  sessionId: string;
  /** App-owned monotonically increasing turn generation. */
  generation?: number;
  locale: string;
  preferOnDevice: boolean;
  allowNetworkFallback: boolean;
};

export type NativeSpeechState =
  'starting' | 'listening' | 'processing' | 'cancelled';

export type SpeechAudioQuality = {
  estimatedSnrDb?: number;
  clippingRatio: number;
  voicedDurationMs: number;
  noiseTooHigh: boolean;
};

export type SpeechRecognitionEvent =
  | {
      type: 'state';
      sessionId: string;
      generation?: number;
      state: NativeSpeechState;
      provider?: SpeechProvider;
      route?: SpeechRoute;
      modelState?: SpeechModelState;
      stage?: SpeechDiagnosticStage;
      mayUseNetwork?: boolean;
      captureOwnership?: SpeechCaptureOwnership;
      endpointOwnership?: SpeechEndpointOwnership;
      endReason?: SpeechEndReason;
    }
  | {
      type: 'partial';
      sessionId: string;
      generation?: number;
      text: string;
      provider?: SpeechProvider;
      route?: SpeechRoute;
      modelState?: SpeechModelState;
      stage?: SpeechDiagnosticStage;
      mayUseNetwork?: boolean;
      captureOwnership?: SpeechCaptureOwnership;
      endpointOwnership?: SpeechEndpointOwnership;
      endReason?: SpeechEndReason;
    }
  | {
      type: 'final';
      sessionId: string;
      generation?: number;
      text: string;
      provider?: SpeechProvider;
      route?: SpeechRoute;
      modelState?: SpeechModelState;
      stage?: SpeechDiagnosticStage;
      mayUseNetwork?: boolean;
      captureOwnership?: SpeechCaptureOwnership;
      endpointOwnership?: SpeechEndpointOwnership;
      endReason?: SpeechEndReason;
      acousticConfidence?: number;
      audioQuality?: SpeechAudioQuality;
      endpointHinted?: boolean;
    }
  | {
      type: 'audio-state';
      sessionId: string;
      generation?: number;
      volumeLevel: number;
      speechDetected: boolean;
      trailingSilenceMs: number;
      endpointHinted: boolean;
      provider?: SpeechProvider;
      route?: SpeechRoute;
      modelState?: SpeechModelState;
      stage?: SpeechDiagnosticStage;
      mayUseNetwork?: boolean;
      captureOwnership?: SpeechCaptureOwnership;
      endpointOwnership?: SpeechEndpointOwnership;
      endReason?: SpeechEndReason;
    }
  | {
      type: 'error';
      sessionId: string;
      generation?: number;
      code: SpeechErrorCode;
      message?: string;
      androidErrorCode?: number;
      nativeCode?: number;
      mode?: string;
      provider?: SpeechProvider;
      route?: SpeechRoute;
      modelState?: SpeechModelState;
      stage?: SpeechDiagnosticStage;
      mayUseNetwork?: boolean;
      captureOwnership?: SpeechCaptureOwnership;
      endpointOwnership?: SpeechEndpointOwnership;
      endReason?: SpeechEndReason;
      retryable?: boolean;
    };

export interface SpeechRecognitionPort {
  getCapabilities(
    locale: string,
    sessionId?: string,
  ): Promise<SpeechCapabilities>;
  downloadModel(locale: string): Promise<SpeechModelDownloadResult>;
  requestPermission(sessionId: string): Promise<SpeechPermissionResult>;
  start(options: SpeechStartOptions): Promise<void>;
  /** True only when this exact live session accepted the user's stop command. */
  stop(sessionId: string): Promise<boolean>;
  cancel(sessionId: string): Promise<void>;
  destroy(sessionId: string): Promise<void>;
  subscribe(listener: (event: SpeechRecognitionEvent) => void): () => void;
}

export type SpeechRecognitionError = {
  code: SpeechErrorCode;
  message: string;
  canRetry: boolean;
  canUseNetwork: boolean;
  canDownloadModel: boolean;
  canOpenSettings: boolean;
  /** A passive capability/permission check is available; it never starts audio. */
  canRecheck?: boolean;
  provider?: SpeechProvider;
  route?: SpeechRoute;
  modelState?: SpeechModelState;
  stage?: SpeechDiagnosticStage;
  nativeCode?: number;
};

export type SpeechRecognitionSnapshot = {
  /** Invalidates every result belonging to a previous bookkeeping draft. */
  draftGeneration: number;
  /** Invalidates callbacks belonging to an earlier recognition turn. */
  turnGeneration: number;
  status: SpeechRecognitionStatus;
  partialText: string;
  finalText?: string;
  error?: SpeechRecognitionError;
  usingNetworkFallback: boolean;
  capabilities?: SpeechCapabilities;
  provider?: SpeechProvider;
  route?: SpeechRoute;
  modelState?: SpeechModelState;
  stage?: SpeechDiagnosticStage;
  mayUseNetwork?: boolean;
  captureOwnership?: SpeechCaptureOwnership;
  endpointOwnership?: SpeechEndpointOwnership;
  endReason?: SpeechEndReason;
  /** A provider-ended segment can be followed by another segment before bookkeeping. */
  canContinue?: boolean;
  /** Single-use capability for consuming the currently displayed transcript. */
  resultToken?: string;
  /** True only after non-empty partial/final evidence arrived in this turn. */
  hasFreshTurnEvidence?: boolean;
  notice?: string;
  /** UI may expose “重新检测”; invoking it must not record or enable networking. */
  canRecheck?: boolean;
  /** Derived, throttled levels only; raw PCM never reaches JavaScript. */
  volumeLevel?: number;
  speechDetected?: boolean;
  trailingSilenceMs?: number;
  endpointHinted?: boolean;
  acousticConfidence?: number;
  audioQuality?: SpeechAudioQuality;
};

export const INITIAL_SPEECH_SNAPSHOT: SpeechRecognitionSnapshot = {
  draftGeneration: 0,
  turnGeneration: 0,
  status: 'IDLE',
  partialText: '',
  usingNetworkFallback: false,
};
