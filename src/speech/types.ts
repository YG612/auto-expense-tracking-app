export type SpeechRecognitionStatus =
  | 'IDLE'
  | 'CHECKING_AVAILABILITY'
  | 'REQUESTING_PERMISSION'
  | 'STARTING'
  | 'LISTENING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'ERROR'
  | 'CANCELLED';

export type SpeechPermissionStatus =
  'granted' | 'denied' | 'blocked' | 'restricted';

export type SpeechErrorCode =
  | 'permission-denied'
  | 'permission-blocked'
  | 'service-unavailable'
  | 'service-incompatible'
  | 'model-missing'
  | 'language-not-supported'
  | 'no-speech'
  | 'network'
  | 'audio'
  | 'busy'
  | 'cancelled'
  | 'unknown';

export type SpeechCapabilities = {
  available: boolean;
  onDeviceAvailable: boolean;
  locale: string;
  platform: 'android' | 'ios' | 'unknown';
};

export type SpeechPermissionResult = {
  status: SpeechPermissionStatus;
  canAskAgain: boolean;
};

export type SpeechStartOptions = {
  sessionId: string;
  locale: string;
  preferOnDevice: boolean;
  allowNetworkFallback: boolean;
};

export type NativeSpeechState =
  'starting' | 'listening' | 'processing' | 'cancelled';

export type SpeechRecognitionEvent =
  | {
      type: 'state';
      sessionId: string;
      state: NativeSpeechState;
    }
  | {
      type: 'partial';
      sessionId: string;
      text: string;
    }
  | {
      type: 'final';
      sessionId: string;
      text: string;
    }
  | {
      type: 'error';
      sessionId: string;
      code: SpeechErrorCode;
      message?: string;
      androidErrorCode?: number;
      mode?: string;
      retryable?: boolean;
    };

export interface SpeechRecognitionPort {
  getCapabilities(locale: string): Promise<SpeechCapabilities>;
  requestPermission(): Promise<SpeechPermissionResult>;
  start(options: SpeechStartOptions): Promise<void>;
  stop(sessionId: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  destroy(): Promise<void>;
  subscribe(listener: (event: SpeechRecognitionEvent) => void): () => void;
}

export type SpeechRecognitionError = {
  code: SpeechErrorCode;
  message: string;
  canRetry: boolean;
  canUseNetwork: boolean;
  canOpenSettings: boolean;
};

export type SpeechRecognitionSnapshot = {
  status: SpeechRecognitionStatus;
  partialText: string;
  finalText?: string;
  error?: SpeechRecognitionError;
  usingNetworkFallback: boolean;
};

export const INITIAL_SPEECH_SNAPSHOT: SpeechRecognitionSnapshot = {
  status: 'IDLE',
  partialText: '',
  usingNetworkFallback: false,
};
