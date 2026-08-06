import type {
  SpeechErrorCode,
  SpeechRecognitionError,
  SpeechRecognitionEvent,
  SpeechRecognitionPort,
  SpeechRecognitionSnapshot,
} from './types';
import { INITIAL_SPEECH_SNAPSHOT } from './types';

const KNOWN_ERROR_CODES = new Set<SpeechErrorCode>([
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

const ERROR_MESSAGES: Readonly<Record<SpeechErrorCode, string>> = {
  'permission-denied':
    '没有获得麦克风权限。可以再次授权；在 ColorOS 等系统上也可前往应用权限设置中手动允许。',
  'permission-blocked':
    '麦克风权限已被系统关闭，请前往应用权限设置中允许后再试。',
  'service-unavailable':
    '这台设备没有可用的系统语音识别服务，请继续使用文字记账。',
  'service-incompatible':
    '麦克风权限已经开启，但当前系统不允许 App 直接调用语音服务。可以改用系统语音输入窗口。',
  'model-missing':
    '设备没有可用的本地中文语音模型。你可以明确允许系统语音服务联网转写。',
  'language-not-supported': '系统语音服务暂不支持中文普通话识别。',
  'no-speech': '没有听清有效内容，请靠近麦克风后重试。',
  network: '系统联网语音识别失败，请检查网络后重试。',
  audio: '麦克风暂时不可用，请确认没有被通话或其他应用占用。',
  busy: '系统语音识别正在忙，请稍后重试。',
  cancelled: '本次语音输入已取消。',
  unknown: '语音识别暂时失败，请重试或改用文字记账。',
};

type ControllerOptions = {
  locale?: string;
  createSessionId?: () => string;
  onFinalResult?: (text: string) => void;
};

type Listener = (snapshot: SpeechRecognitionSnapshot) => void;

function errorCodeFrom(value: unknown): SpeechErrorCode {
  if (typeof value === 'object' && value !== null && 'code' in value) {
    const raw = String((value as { code: unknown }).code)
      .toLowerCase()
      .replace(/^e[_-]/, '')
      .replaceAll('_', '-');
    if (KNOWN_ERROR_CODES.has(raw as SpeechErrorCode)) {
      return raw as SpeechErrorCode;
    }
  }
  return 'unknown';
}

function errorFor(
  code: SpeechErrorCode,
  usingNetworkFallback = false,
  nativeRetryable?: boolean,
): SpeechRecognitionError {
  return {
    code,
    message: ERROR_MESSAGES[code],
    canRetry:
      nativeRetryable ??
      ![
        'permission-blocked',
        'service-unavailable',
        'language-not-supported',
      ].includes(code),
    // System recognition is a different privacy/engine choice, not a generic
    // recovery for poor audio or an already-authorized system attempt.
    canUseNetwork:
      !usingNetworkFallback &&
      (code === 'model-missing' || code === 'service-incompatible'),
    canOpenSettings:
      code === 'permission-denied' || code === 'permission-blocked',
  };
}

function defaultSessionId(): string {
  return `speech-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

export class SpeechRecognitionController {
  private snapshot: SpeechRecognitionSnapshot = INITIAL_SPEECH_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribePort: () => void;
  private activeSessionId?: string;
  private disposed = false;
  private lastAllowNetworkFallback = false;

  constructor(
    private readonly port: SpeechRecognitionPort,
    private readonly options: ControllerOptions = {},
  ) {
    this.unsubscribePort = port.subscribe(event => this.handleEvent(event));
  }

  getSnapshot(): SpeechRecognitionSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async start(allowNetworkFallback = false): Promise<void> {
    if (this.disposed || this.activeSessionId !== undefined) {
      return;
    }
    const sessionId = this.options.createSessionId?.() ?? defaultSessionId();
    this.activeSessionId = sessionId;
    this.lastAllowNetworkFallback = allowNetworkFallback;
    this.publish({
      status: 'CHECKING_AVAILABILITY',
      partialText: '',
      usingNetworkFallback: allowNetworkFallback,
    });

    try {
      const capabilities = await this.port.getCapabilities(
        this.options.locale ?? 'zh-CN',
      );
      if (!this.isActive(sessionId)) {
        return;
      }
      if (!capabilities.available) {
        this.fail(sessionId, 'service-unavailable');
        return;
      }

      this.publish({
        status: 'REQUESTING_PERMISSION',
        partialText: '',
        usingNetworkFallback: allowNetworkFallback,
      });
      const permission = await this.port.requestPermission();
      if (!this.isActive(sessionId)) {
        return;
      }
      if (permission.status !== 'granted') {
        this.fail(
          sessionId,
          permission.status === 'blocked' || permission.status === 'restricted'
            ? 'permission-blocked'
            : 'permission-denied',
        );
        return;
      }
      if (!capabilities.onDeviceAvailable && !allowNetworkFallback) {
        this.fail(sessionId, 'model-missing');
        return;
      }

      this.publish({
        status: 'STARTING',
        partialText: '',
        usingNetworkFallback: allowNetworkFallback,
      });
      await this.port.start({
        sessionId,
        locale: capabilities.locale || this.options.locale || 'zh-CN',
        // The network action is explicit consent to use the system service.
        // Do not silently retry the same on-device engine after a no-match.
        preferOnDevice: !allowNetworkFallback,
        allowNetworkFallback,
      });
    } catch (error) {
      if (this.isActive(sessionId)) {
        this.fail(sessionId, errorCodeFrom(error));
      }
    }
  }

  async stop(): Promise<void> {
    const sessionId = this.activeSessionId;
    if (
      sessionId === undefined ||
      !['STARTING', 'LISTENING'].includes(this.snapshot.status)
    ) {
      return;
    }
    this.publish({ ...this.snapshot, status: 'PROCESSING' });
    try {
      await this.port.stop(sessionId);
    } catch (error) {
      if (this.isActive(sessionId)) {
        this.fail(sessionId, errorCodeFrom(error));
      }
    }
  }

  async cancel(): Promise<void> {
    const sessionId = this.activeSessionId;
    if (sessionId === undefined) {
      return;
    }
    this.activeSessionId = undefined;
    this.publish({
      status: 'CANCELLED',
      partialText: '',
      usingNetworkFallback: false,
    });
    try {
      await this.port.cancel(sessionId);
    } catch {
      // Cancellation is best-effort; the invalidated session cannot update UI.
    }
  }

  retry(): Promise<void> {
    return this.start(this.lastAllowNetworkFallback);
  }

  useNetworkAndRetry(): Promise<void> {
    return this.start(true);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const sessionId = this.activeSessionId;
    this.activeSessionId = undefined;
    this.unsubscribePort();
    if (sessionId !== undefined) {
      try {
        await this.port.cancel(sessionId);
      } catch {
        // Cleanup continues even when the platform recognizer already ended.
      }
    }
    try {
      await this.port.destroy();
    } catch {
      // There is no user-visible recovery action during unmount cleanup.
    }
    this.listeners.clear();
  }

  private isActive(sessionId: string): boolean {
    return !this.disposed && this.activeSessionId === sessionId;
  }

  private handleEvent(event: SpeechRecognitionEvent): void {
    if (!this.isActive(event.sessionId)) {
      return;
    }
    if (event.type === 'partial') {
      if (['STARTING', 'LISTENING'].includes(this.snapshot.status)) {
        this.publish({
          ...this.snapshot,
          status: 'LISTENING',
          partialText: event.text.trim(),
        });
      }
      return;
    }
    if (event.type === 'state') {
      if (event.state === 'listening') {
        this.publish({ ...this.snapshot, status: 'LISTENING' });
      } else if (event.state === 'processing') {
        this.publish({ ...this.snapshot, status: 'PROCESSING' });
      } else if (event.state === 'cancelled') {
        this.activeSessionId = undefined;
        this.publish({
          status: 'CANCELLED',
          partialText: '',
          usingNetworkFallback: false,
        });
      }
      return;
    }
    if (event.type === 'error') {
      if (event.code === 'cancelled') {
        this.activeSessionId = undefined;
        this.publish({
          status: 'CANCELLED',
          partialText: '',
          usingNetworkFallback: false,
        });
      } else {
        this.fail(event.sessionId, event.code, event.retryable);
      }
      return;
    }

    const finalText = event.text.trim();
    this.activeSessionId = undefined;
    if (finalText.length === 0) {
      this.publish({
        status: 'ERROR',
        partialText: '',
        error: errorFor('no-speech', this.snapshot.usingNetworkFallback),
        usingNetworkFallback: this.snapshot.usingNetworkFallback,
      });
      return;
    }
    this.publish({
      status: 'SUCCEEDED',
      partialText: '',
      finalText,
      usingNetworkFallback: this.snapshot.usingNetworkFallback,
    });
    this.options.onFinalResult?.(finalText);
  }

  private fail(
    sessionId: string,
    code: SpeechErrorCode,
    nativeRetryable?: boolean,
  ): void {
    if (!this.isActive(sessionId)) {
      return;
    }
    this.activeSessionId = undefined;
    this.publish({
      status: 'ERROR',
      partialText: this.snapshot.partialText,
      error: errorFor(
        code,
        this.snapshot.usingNetworkFallback,
        nativeRetryable,
      ),
      usingNetworkFallback: this.snapshot.usingNetworkFallback,
    });
  }

  private publish(snapshot: SpeechRecognitionSnapshot): void {
    if (this.disposed) {
      return;
    }
    this.snapshot = snapshot;
    this.listeners.forEach(listener => listener(snapshot));
  }
}
