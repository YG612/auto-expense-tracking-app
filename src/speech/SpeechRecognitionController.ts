import type {
  SpeechCapabilities,
  SpeechDiagnosticStage,
  SpeechEndReason,
  SpeechErrorCode,
  SpeechModelState,
  SpeechProvider,
  SpeechProviderCapability,
  SpeechRecognitionError,
  SpeechRecognitionEvent,
  SpeechRecognitionPort,
  SpeechRecognitionSnapshot,
  SpeechRoute,
} from './types';
import { isBookkeepingTextWithinLimit } from '../domain/policies/bookkeepingInputPolicy';
import { INITIAL_SPEECH_SNAPSHOT } from './types';

const KNOWN_ERROR_CODES = new Set<SpeechErrorCode>([
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

const ERROR_MESSAGES: Readonly<Record<SpeechErrorCode, string>> = {
  'permission-denied':
    '没有获得麦克风或语音识别权限。你可以再次授权，或继续使用文字记账。',
  'permission-blocked': '语音权限已被系统关闭，请在应用权限设置中允许后再试。',
  'microphone-disabled':
    '系统总麦克风或隐私麦克风开关已关闭。应用权限已经允许也无法录音，请先在快捷设置或系统隐私设置中打开麦克风。',
  'microphone-unavailable':
    '这台设备没有可用的麦克风硬件，请继续使用文字记账。',
  'service-unavailable':
    '这台设备没有可用的系统语音识别服务，请继续使用文字记账。',
  'service-incompatible':
    '当前系统不允许 App 直接调用语音服务，可以改用系统语音输入窗口。',
  'model-missing':
    '本机未检测到可用的离线普通话语音模型。可以下载系统语音包，或明确改用可能联网的系统语音。',
  'model-status-unknown':
    '本机暂时无法确认离线普通话语音模型是否可用。可以重新检测，或明确改用可能联网的系统语音。',
  'model-download-failed':
    '系统未能准备本地中文语音模型，请稍后重试或改用系统语音输入。',
  'capability-timeout': '重新检测语音能力超时，请稍后再试或改用文字记账。',
  'language-not-supported': '当前语音服务无法识别中文普通话。',
  'no-speech': '没有听清有效内容，请靠近麦克风后重试。',
  network: '系统联网语音识别失败，请检查网络后重试。',
  audio: '麦克风暂时不可用，请确认没有被通话或其他应用占用。',
  busy: '系统语音识别正在忙，请稍后重试。',
  'recording-too-long':
    '本次语音已达到录音时长上限，已停止且不会生成账单。请分段重新说，或改用文字输入。',
  'result-too-long': '本次语音内容超过 500 个字符，请拆分后重新记账。',
  cancelled: '本次语音输入已取消。',
  unknown: '语音识别暂时失败，请重试或改用文字记账。',
};

type ControllerOptions = {
  locale?: string;
  createSessionId?: () => string;
  createLogicalDictationId?: () => string;
  onFinalResult?: (text: string, resultToken: string) => void;
  recheckTimeoutMs?: number;
};

type Listener = (snapshot: SpeechRecognitionSnapshot) => void;

type ErrorContext = {
  usingNetworkFallback?: boolean;
  canUseNetwork?: boolean;
  provider?: SpeechProvider;
  route?: SpeechRoute;
  modelState?: SpeechModelState;
  stage?: SpeechDiagnosticStage;
  nativeRetryable?: boolean;
  nativeCode?: number;
  canRecheck?: boolean;
};

type ActiveRecheck = {
  id: number;
  cancel: () => void;
  promise: Promise<void>;
};

type PendingStop = {
  sessionId: string;
  draftGeneration: number;
  turnGeneration: number;
  acknowledged: boolean;
  bufferedFinal?: Extract<SpeechRecognitionEvent, { type: 'final' }>;
};

type SpeechSnapshotInput = Omit<
  SpeechRecognitionSnapshot,
  'draftGeneration' | 'turnGeneration'
> &
  Partial<
    Pick<SpeechRecognitionSnapshot, 'draftGeneration' | 'turnGeneration'>
  >;

const RECHECK_CANCELLED = Symbol('speech-recheck-cancelled');
const DEFAULT_RECHECK_TIMEOUT_MS = 8_000;

const SENTENCE_BOUNDARY = /[，。！？；：,.!?;:]$/u;

/**
 * Joins independently recognised segments without repeating the overlap that
 * many platform recognisers include at a continuation boundary.
 */
export function mergeSpeechTranscripts(
  existing: string,
  incoming: string,
): string {
  const left = existing.trim();
  const right = incoming.trim();
  if (left.length === 0) {
    return right;
  }
  if (right.length === 0 || left === right || left.endsWith(right)) {
    return left;
  }
  if (right.startsWith(left)) {
    return right;
  }

  const overlapLimit = Math.min(left.length, right.length);
  for (let overlap = overlapLimit; overlap > 0; overlap -= 1) {
    if (left.slice(-overlap) === right.slice(0, overlap)) {
      return left + right.slice(overlap);
    }
  }

  return `${left}${SENTENCE_BOUNDARY.test(left) ? '' : '，'}${right}`;
}

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
  context: ErrorContext = {},
): SpeechRecognitionError {
  const localCapabilityLimitation =
    context.usingNetworkFallback !== true &&
    (context.stage === 'capability' || context.route === 'on-device') &&
    [
      'model-missing',
      'model-status-unknown',
      'language-not-supported',
    ].includes(code);
  return {
    code,
    message:
      code === 'language-not-supported' && localCapabilityLimitation
        ? '本机未检测到可用的离线普通话语音模型。'
        : ERROR_MESSAGES[code],
    canRetry:
      context.nativeRetryable ??
      (![
        'permission-blocked',
        'microphone-disabled',
        'microphone-unavailable',
        'service-unavailable',
        'language-not-supported',
        'model-status-unknown',
      ].includes(code) &&
        context.modelState !== 'DOWNLOADING'),
    canUseNetwork:
      context.canUseNetwork === true &&
      context.usingNetworkFallback !== true &&
      [
        'model-missing',
        'model-status-unknown',
        'model-download-failed',
        'language-not-supported',
        'service-incompatible',
      ].includes(code),
    canDownloadModel:
      context.modelState === 'DOWNLOADABLE' &&
      (code === 'model-missing' || code === 'model-download-failed'),
    canOpenSettings:
      code === 'permission-denied' || code === 'permission-blocked',
    canRecheck:
      context.canRecheck ??
      [
        'permission-denied',
        'permission-blocked',
        'microphone-disabled',
        'model-missing',
        'model-status-unknown',
        'model-download-failed',
        'capability-timeout',
      ].includes(code),
    provider: context.provider,
    route: context.route,
    modelState: context.modelState,
    stage: context.stage,
    nativeCode: context.nativeCode,
  };
}

function defaultSessionId(): string {
  return (
    'speech-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 9)
  );
}

function legacyProviders(
  capabilities: SpeechCapabilities,
): SpeechProviderCapability[] {
  const localProvider: SpeechProvider =
    capabilities.platform === 'android'
      ? 'android-on-device'
      : capabilities.platform === 'ios'
        ? 'ios-on-device'
        : 'unknown';
  const systemProvider: SpeechProvider =
    capabilities.platform === 'android'
      ? 'android-direct-system'
      : capabilities.platform === 'ios'
        ? 'ios-system'
        : 'unknown';
  const providers: SpeechProviderCapability[] = [];
  if (capabilities.onDeviceAvailable && localProvider !== 'unknown') {
    providers.push({
      provider: localProvider,
      route: 'on-device',
      available: true,
      modelState: 'UNKNOWN',
      requiresMicrophonePermission: true,
      mayUseNetwork: false,
      stage: 'capability',
    });
  }
  if (capabilities.available && systemProvider !== 'unknown') {
    providers.push({
      provider: systemProvider,
      route:
        capabilities.platform === 'ios' ? 'system-network' : 'direct-system',
      available: true,
      modelState: 'UNKNOWN',
      requiresMicrophonePermission: true,
      mayUseNetwork: true,
      stage: 'capability',
    });
  }
  return providers;
}

function providersOf(
  capabilities: SpeechCapabilities,
): SpeechProviderCapability[] {
  return capabilities.providers !== undefined &&
    capabilities.providers.length > 0
    ? capabilities.providers
    : legacyProviders(capabilities);
}

function localModelStateOf(capabilities: SpeechCapabilities): SpeechModelState {
  const local = providersOf(capabilities).find(
    provider => provider.route === 'on-device',
  );
  return local?.modelState ?? capabilities.modelState ?? 'UNKNOWN';
}

function preparingLocalProvider(
  capabilities: SpeechCapabilities,
): SpeechProviderCapability | undefined {
  return providersOf(capabilities).find(
    provider =>
      !provider.available &&
      provider.modelState === 'DOWNLOADING' &&
      provider.mayUseNetwork === false &&
      (provider.route === 'app-owned-offline' ||
        provider.route === 'on-device'),
  );
}

function selectProvider(
  capabilities: SpeechCapabilities,
  allowNetworkFallback: boolean,
): SpeechProviderCapability | undefined {
  const available = providersOf(capabilities).filter(
    provider => provider.available,
  );
  if (!allowNetworkFallback) {
    return ['app-owned-offline', 'on-device']
      .map(route =>
        available.find(
          provider =>
            provider.route === route &&
            (provider.modelState === 'READY' ||
              (route === 'on-device' && provider.modelState === 'UNKNOWN')) &&
            !provider.mayUseNetwork,
        ),
      )
      .find(
        (provider): provider is SpeechProviderCapability =>
          provider !== undefined,
      );
  }

  // Keep capture in the App when Android has already confirmed microphone
  // access and exposes a direct system recognizer. This preserves our own
  // stop/cancel controls. A blocked/restricted/unknown permission state uses
  // the external system Activity instead, because that provider owns capture.
  const directSystemIsHealthy = capabilities.permissionStatus === 'granted';
  const preference: SpeechRoute[] = directSystemIsHealthy
    ? ['direct-system', 'system-network', 'system-activity']
    : ['system-network', 'system-activity', 'direct-system'];
  return preference
    .map(route =>
      available.find(
        provider => provider.route === route && provider.mayUseNetwork,
      ),
    )
    .find(
      (provider): provider is SpeechProviderCapability =>
        provider !== undefined,
    );
}

function hasSystemAlternative(capabilities?: SpeechCapabilities): boolean {
  return (
    capabilities !== undefined &&
    providersOf(capabilities).some(
      provider => provider.available && provider.mayUseNetwork,
    )
  );
}

function missingLocalError(modelState: SpeechModelState): SpeechErrorCode {
  if (modelState === 'UNKNOWN') {
    return 'model-status-unknown';
  }
  if (modelState === 'UNSUPPORTED') {
    return 'language-not-supported';
  }
  return 'model-missing';
}

export class SpeechRecognitionController {
  private snapshot: SpeechRecognitionSnapshot = INITIAL_SPEECH_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribePort: () => void;
  private activeSessionId?: string;
  private disposed = false;
  private lastAllowNetworkFallback = false;
  private modelPreparationInProgress = false;
  private awaitingDownloadedModelReady = false;
  private recheckSequence = 0;
  private activeRecheck?: ActiveRecheck;
  private acceptedTranscript = '';
  private freshTurnTranscript = '';
  private draftGeneration = 0;
  private turnGeneration = 0;
  private activeDraftGeneration?: number;
  private activeTurnGeneration?: number;
  private activeNativeGeneration?: number;
  private activeResultToken?: string;
  private resultSequence = 0;
  private logicalDictationId = defaultSessionId();
  private readonly issuedSessionIds = new Set<string>();
  private pendingStop?: PendingStop;

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
    return this.startInternal(allowNetworkFallback, false);
  }

  async continueDictation(): Promise<void> {
    if (
      this.snapshot.status !== 'SUCCEEDED' ||
      this.snapshot.canContinue !== true ||
      this.snapshot.hasFreshTurnEvidence !== true ||
      this.snapshot.resultToken === undefined ||
      (this.snapshot.finalText ?? '').trim().length === 0
    ) {
      return;
    }
    this.acceptedTranscript = this.snapshot.finalText?.trim() ?? '';
    return this.startInternal(this.lastAllowNetworkFallback, true);
  }

  private async startInternal(
    allowNetworkFallback: boolean,
    retainTranscript: boolean,
  ): Promise<void> {
    if (
      this.disposed ||
      this.activeSessionId !== undefined ||
      this.modelPreparationInProgress ||
      this.activeRecheck !== undefined ||
      this.awaitingDownloadedModelReady ||
      this.snapshot.modelState === 'DOWNLOADING'
    ) {
      return;
    }
    if (!retainTranscript) {
      this.acceptedTranscript = '';
      this.logicalDictationId =
        this.options.createLogicalDictationId?.() ?? defaultSessionId();
      this.resultSequence = 0;
    }
    this.freshTurnTranscript = '';
    this.turnGeneration += 1;
    const proposedSessionId =
      this.options.createSessionId?.() ?? defaultSessionId();
    const sessionId = this.ensureUniqueSessionId(proposedSessionId);
    const requestedLocale = this.options.locale ?? 'zh-CN';
    this.activeSessionId = sessionId;
    this.activeDraftGeneration = this.draftGeneration;
    this.activeTurnGeneration = this.turnGeneration;
    this.activeNativeGeneration = undefined;
    this.activeResultToken = undefined;
    this.pendingStop = undefined;
    this.lastAllowNetworkFallback = allowNetworkFallback;
    this.publish({
      status: 'CHECKING_AVAILABILITY',
      partialText: '',
      usingNetworkFallback: allowNetworkFallback,
      stage: 'capability',
      finalText: undefined,
      resultToken: undefined,
      hasFreshTurnEvidence: false,
      canContinue: false,
    });

    try {
      const capabilities = await this.port.getCapabilities(
        requestedLocale,
        sessionId,
      );
      if (!this.isActive(sessionId)) {
        return;
      }
      const selected = selectProvider(capabilities, allowNetworkFallback);
      const modelState = localModelStateOf(capabilities);
      if (selected === undefined) {
        const preparingProvider = preparingLocalProvider(capabilities);
        if (preparingProvider !== undefined) {
          this.awaitingDownloadedModelReady = true;
          this.closeActiveTurn();
          this.publish({
            status: 'PREPARING_MODEL',
            partialText: '',
            usingNetworkFallback: false,
            capabilities,
            provider: preparingProvider.provider,
            route: preparingProvider.route,
            modelState: preparingProvider.modelState,
            stage: 'model-preparation',
            mayUseNetwork: false,
            captureOwnership: preparingProvider.captureOwnership,
            endpointOwnership: preparingProvider.endpointOwnership,
            notice:
              preparingProvider.route === 'app-owned-offline'
                ? '应用正在准备轻量离线中文语音，完成后请重新检测。'
                : '系统仍在准备本地中文语音模型，完成后请重新检测。',
            canRecheck: true,
          });
          this.port.destroy(sessionId).catch(() => undefined);
          return;
        }
        this.fail(
          sessionId,
          allowNetworkFallback
            ? 'service-unavailable'
            : missingLocalError(modelState),
          {
            usingNetworkFallback: allowNetworkFallback,
            canUseNetwork: hasSystemAlternative(capabilities),
            modelState,
            stage: 'capability',
            capabilities,
          },
        );
        return;
      }

      const commonSnapshot = {
        partialText: '',
        usingNetworkFallback: allowNetworkFallback && selected.mayUseNetwork,
        capabilities,
        provider: selected.provider,
        route: selected.route,
        modelState: selected.modelState,
        mayUseNetwork: selected.mayUseNetwork,
        captureOwnership: selected.captureOwnership,
        endpointOwnership: selected.endpointOwnership,
        canContinue: false,
        finalText: undefined,
        volumeLevel: 0,
        speechDetected: false,
        trailingSilenceMs: 0,
        endpointHinted: false,
        acousticConfidence: undefined,
        audioQuality: undefined,
        resultToken: undefined,
        hasFreshTurnEvidence: false,
      } as const;

      if (selected.requiresMicrophonePermission) {
        this.publish({
          ...commonSnapshot,
          status: 'REQUESTING_PERMISSION',
          stage: 'permission',
        });
        const permission = await this.port.requestPermission(sessionId);
        if (!this.isActive(sessionId)) {
          return;
        }
        if (permission.status !== 'granted') {
          this.fail(
            sessionId,
            permission.reason ??
              (permission.status === 'blocked'
                ? 'permission-blocked'
                : permission.status === 'restricted'
                  ? 'permission-blocked'
                  : 'permission-denied'),
            {
              usingNetworkFallback: commonSnapshot.usingNetworkFallback,
              canUseNetwork:
                selected.route !== 'system-activity' &&
                hasSystemAlternative(capabilities),
              provider: selected.provider,
              route: selected.route,
              modelState: selected.modelState,
              stage: 'permission',
              capabilities,
            },
          );
          return;
        }
      }

      this.publish({
        ...commonSnapshot,
        status: 'STARTING',
        stage: 'start',
      });
      await this.port.start({
        sessionId,
        generation: this.turnGeneration,
        locale: capabilities.locale || requestedLocale,
        preferOnDevice: !allowNetworkFallback,
        allowNetworkFallback,
      });
    } catch (error) {
      if (this.isActive(sessionId)) {
        this.fail(sessionId, errorCodeFrom(error), {
          usingNetworkFallback: allowNetworkFallback,
          canUseNetwork: hasSystemAlternative(this.snapshot.capabilities),
          provider: this.snapshot.provider,
          route: this.snapshot.route,
          modelState: this.snapshot.modelState,
          stage: this.snapshot.stage ?? 'start',
          capabilities: this.snapshot.capabilities,
        });
      }
    }
  }

  /**
   * Refreshes permission, microphone privacy and provider/model facts only.
   * It never requests permission, opens a recognizer or selects a network path.
   */
  recheck(): Promise<void> {
    if (
      this.disposed ||
      this.activeSessionId !== undefined ||
      this.modelPreparationInProgress
    ) {
      return Promise.resolve();
    }
    if (this.activeRecheck !== undefined) {
      return this.activeRecheck.promise;
    }

    const id = ++this.recheckSequence;
    const previousErrorCode = this.snapshot.error?.code;
    let cancel: () => void = () => undefined;
    const cancellation = new Promise<never>((_, reject) => {
      cancel = () => reject(RECHECK_CANCELLED);
    });
    let resolveOwner: () => void = () => undefined;
    let rejectOwner: (error: unknown) => void = () => undefined;
    const ownerPromise = new Promise<void>((resolve, reject) => {
      resolveOwner = resolve;
      rejectOwner = reject;
    });
    const owner: ActiveRecheck = { id, cancel, promise: ownerPromise };
    // Establish ownership before publishing CHECKING_AVAILABILITY because a
    // synchronous subscriber is allowed to call recheck again.
    this.activeRecheck = owner;
    this.performRecheck(id, previousErrorCode, cancellation)
      .finally(() => {
        if (this.activeRecheck?.id === id) {
          this.activeRecheck = undefined;
        }
      })
      .then(resolveOwner, rejectOwner);
    return ownerPromise;
  }

  async downloadModel(): Promise<void> {
    if (
      this.disposed ||
      this.activeSessionId !== undefined ||
      this.modelPreparationInProgress ||
      this.activeRecheck !== undefined ||
      this.awaitingDownloadedModelReady ||
      this.snapshot.modelState === 'DOWNLOADING'
    ) {
      return;
    }
    this.modelPreparationInProgress = true;
    const locale = this.options.locale ?? 'zh-CN';
    try {
      const capabilities =
        this.snapshot.capabilities ?? (await this.port.getCapabilities(locale));
      const modelState = localModelStateOf(capabilities);
      if (modelState !== 'DOWNLOADABLE') {
        this.publish({
          status: 'ERROR',
          partialText: '',
          usingNetworkFallback: false,
          capabilities,
          modelState,
          stage: 'model-preparation',
          error: errorFor(missingLocalError(modelState), {
            modelState,
            stage: 'model-preparation',
            canUseNetwork: hasSystemAlternative(capabilities),
          }),
        });
        return;
      }

      this.publish({
        status: 'PREPARING_MODEL',
        partialText: '',
        usingNetworkFallback: false,
        capabilities,
        provider: 'android-on-device',
        route: 'on-device',
        modelState,
        stage: 'model-preparation',
      });
      const result = await this.port.downloadModel(
        capabilities.locale || locale,
      );
      const providers = providersOf(capabilities).map(provider =>
        provider.route === 'on-device'
          ? {
              ...provider,
              available: result.modelState === 'READY',
              modelState: result.modelState,
            }
          : provider,
      );
      const updatedCapabilities: SpeechCapabilities = {
        ...capabilities,
        onDeviceAvailable: result.modelState === 'READY',
        modelState: result.modelState,
        providers,
      };
      if (
        result.modelState === 'READY' ||
        result.modelState === 'DOWNLOADING'
      ) {
        this.awaitingDownloadedModelReady = result.modelState === 'DOWNLOADING';
        this.publish({
          status: result.modelState === 'READY' ? 'IDLE' : 'PREPARING_MODEL',
          partialText: '',
          usingNetworkFallback: false,
          capabilities: updatedCapabilities,
          provider: result.provider,
          route: 'on-device',
          modelState: result.modelState,
          stage: 'model-preparation',
          canRecheck: result.modelState === 'DOWNLOADING',
          notice:
            result.modelState === 'READY'
              ? '本地中文语音模型已就绪。'
              : '系统已安排下载本地中文语音模型，完成后可再次尝试。',
        });
        return;
      }
      this.awaitingDownloadedModelReady = false;
      this.publish({
        status: 'ERROR',
        partialText: '',
        usingNetworkFallback: false,
        capabilities: updatedCapabilities,
        provider: result.provider,
        route: 'on-device',
        modelState: result.modelState,
        stage: 'model-preparation',
        error: errorFor('model-download-failed', {
          modelState: result.modelState,
          stage: 'model-preparation',
          canUseNetwork: hasSystemAlternative(updatedCapabilities),
        }),
      });
    } catch {
      this.awaitingDownloadedModelReady = false;
      const modelState = this.snapshot.modelState ?? 'UNKNOWN';
      this.publish({
        status: 'ERROR',
        partialText: '',
        usingNetworkFallback: false,
        capabilities: this.snapshot.capabilities,
        provider: this.snapshot.provider,
        route: this.snapshot.route,
        modelState,
        stage: 'model-preparation',
        error: errorFor('model-download-failed', {
          modelState,
          stage: 'model-preparation',
          canUseNetwork: hasSystemAlternative(this.snapshot.capabilities),
        }),
      });
    } finally {
      this.modelPreparationInProgress = false;
    }
  }

  async stop(): Promise<void> {
    const sessionId = this.activeSessionId;
    const draftGeneration = this.activeDraftGeneration;
    const turnGeneration = this.activeTurnGeneration;
    if (
      sessionId === undefined ||
      draftGeneration === undefined ||
      turnGeneration === undefined ||
      this.pendingStop !== undefined ||
      !['STARTING', 'LISTENING'].includes(this.snapshot.status)
    ) {
      return;
    }
    const pending: PendingStop = {
      sessionId,
      draftGeneration,
      turnGeneration,
      acknowledged: false,
    };
    this.pendingStop = pending;
    try {
      const accepted = await this.port.stop(sessionId);
      if (!this.isActiveTurn(sessionId, draftGeneration, turnGeneration)) {
        return;
      }
      if (!accepted) {
        this.pendingStop = undefined;
        if (pending.bufferedFinal !== undefined) {
          this.finishWithFinal(pending.bufferedFinal, false);
        }
        return;
      }
      pending.acknowledged = true;
      this.publish({
        ...this.snapshot,
        status: 'PROCESSING',
        stage: 'result',
        endReason: 'user-stop',
      });
      if (pending.bufferedFinal !== undefined) {
        this.finishWithFinal(pending.bufferedFinal, true);
      }
    } catch (error) {
      if (this.isActiveTurn(sessionId, draftGeneration, turnGeneration)) {
        this.pendingStop = undefined;
        this.fail(sessionId, errorCodeFrom(error), {
          usingNetworkFallback: this.snapshot.usingNetworkFallback,
          canUseNetwork: hasSystemAlternative(this.snapshot.capabilities),
          provider: this.snapshot.provider,
          route: this.snapshot.route,
          modelState: this.snapshot.modelState,
          stage: 'result',
          capabilities: this.snapshot.capabilities,
        });
      }
    }
  }

  /** Atomically consumes exactly the currently exposed transcript capability. */
  consumeResult(resultToken: string): boolean {
    if (
      resultToken.length === 0 ||
      this.snapshot.resultToken !== resultToken ||
      this.snapshot.hasFreshTurnEvidence !== true
    ) {
      return false;
    }
    const sessionId = this.activeSessionId;
    this.invalidateTurnState();
    this.turnGeneration += 1;
    this.publish({
      status: 'IDLE',
      partialText: '',
      usingNetworkFallback: false,
      capabilities: this.snapshot.capabilities,
    });
    if (sessionId !== undefined) {
      this.port
        .cancel(sessionId)
        .catch(() => undefined)
        .then(() => this.port.destroy(sessionId).catch(() => undefined));
    }
    return true;
  }

  /** Starts a new bookkeeping draft and fences off every callback from the old one. */
  resetForNewDraft(): void {
    const sessionId = this.activeSessionId;
    this.invalidateRecheck();
    this.invalidateTurnState();
    this.draftGeneration += 1;
    this.turnGeneration += 1;
    this.publish({
      status: 'IDLE',
      partialText: '',
      usingNetworkFallback: false,
      capabilities: this.snapshot.capabilities,
    });
    if (sessionId !== undefined) {
      this.port
        .cancel(sessionId)
        .catch(() => undefined)
        .then(() => this.port.destroy(sessionId).catch(() => undefined));
    }
  }

  async cancel(): Promise<void> {
    const sessionId = this.activeSessionId;
    if (sessionId === undefined) {
      if (this.activeRecheck !== undefined) {
        this.invalidateRecheck();
        this.publish({
          status: 'CANCELLED',
          partialText: '',
          usingNetworkFallback: false,
          capabilities: this.snapshot.capabilities,
          stage: 'lifecycle',
        });
      }
      return;
    }
    this.invalidateTurnState();
    this.acceptedTranscript = '';
    this.publish({
      status: 'CANCELLED',
      partialText: '',
      usingNetworkFallback: false,
      capabilities: this.snapshot.capabilities,
      stage: 'lifecycle',
    });
    try {
      await this.port.cancel(sessionId);
    } catch {
      // Cancellation is best-effort; the invalidated session cannot update UI.
    }
    try {
      await this.port.destroy(sessionId);
    } catch {
      // Native ownership was already fenced; destruction is best-effort.
    }
  }

  retry(): Promise<void> {
    return this.startInternal(this.lastAllowNetworkFallback, false);
  }

  useNetworkAndRetry(): Promise<void> {
    return this.startInternal(true, false);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.invalidateRecheck();
    const sessionId = this.activeSessionId;
    this.invalidateTurnState();
    this.acceptedTranscript = '';
    this.unsubscribePort();
    if (sessionId !== undefined) {
      try {
        await this.port.cancel(sessionId);
      } catch {
        // Cleanup continues even when the platform recognizer already ended.
      }
    }
    if (sessionId !== undefined) {
      try {
        await this.port.destroy(sessionId);
      } catch {
        // There is no user-visible recovery action during unmount cleanup.
      }
    }
    this.listeners.clear();
  }

  private async performRecheck(
    id: number,
    previousErrorCode: SpeechErrorCode | undefined,
    cancellation: Promise<never>,
  ): Promise<void> {
    const locale = this.options.locale ?? 'zh-CN';
    const previousCapabilities = this.snapshot.capabilities;
    this.publish({
      status: 'CHECKING_AVAILABILITY',
      partialText: '',
      usingNetworkFallback: false,
      capabilities: previousCapabilities,
      modelState: this.snapshot.modelState,
      stage: 'capability',
      canRecheck: false,
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () =>
          reject(
            Object.assign(new Error('Speech capability recheck timed out.'), {
              code: 'capability-timeout',
            }),
          ),
        this.options.recheckTimeoutMs ?? DEFAULT_RECHECK_TIMEOUT_MS,
      );
    });

    try {
      const capabilities = await Promise.race([
        this.port.getCapabilities(locale),
        cancellation,
        timeout,
      ]);
      if (!this.isRecheckActive(id)) {
        return;
      }
      this.applyRecheckedCapabilities(capabilities, previousErrorCode);
    } catch (error) {
      if (error === RECHECK_CANCELLED || !this.isRecheckActive(id)) {
        return;
      }
      this.publishRecheckError(
        errorCodeFrom(error),
        previousCapabilities,
        true,
      );
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private applyRecheckedCapabilities(
    capabilities: SpeechCapabilities,
    previousErrorCode: SpeechErrorCode | undefined,
  ): void {
    const modelState = localModelStateOf(capabilities);
    const permissionError = this.permissionErrorAfterRecheck(
      capabilities,
      previousErrorCode,
    );
    if (permissionError !== undefined) {
      this.publishRecheckError(
        permissionError,
        capabilities,
        permissionError !== 'microphone-unavailable',
      );
      return;
    }

    if (
      modelState === 'DOWNLOADING' ||
      (this.awaitingDownloadedModelReady && modelState !== 'READY')
    ) {
      if (modelState === 'UNSUPPORTED') {
        this.awaitingDownloadedModelReady = false;
        this.publishRecheckError('language-not-supported', capabilities, false);
        return;
      }
      const preparingProvider = preparingLocalProvider(capabilities);
      this.awaitingDownloadedModelReady = true;
      this.publish({
        status: 'PREPARING_MODEL',
        partialText: '',
        usingNetworkFallback: false,
        capabilities,
        provider: preparingProvider?.provider ?? 'android-on-device',
        route: preparingProvider?.route ?? 'on-device',
        modelState,
        stage: 'model-preparation',
        mayUseNetwork: false,
        captureOwnership: preparingProvider?.captureOwnership,
        endpointOwnership: preparingProvider?.endpointOwnership,
        notice:
          preparingProvider?.route === 'app-owned-offline'
            ? '应用正在准备轻量离线中文语音，完成后请重新检测。'
            : '系统仍在准备本地中文语音模型，完成后请重新检测。',
        canRecheck: true,
      });
      return;
    }

    const localProvider = selectProvider(capabilities, false);
    if (localProvider === undefined) {
      this.publishRecheckError(
        missingLocalError(modelState),
        capabilities,
        true,
      );
      return;
    }

    this.awaitingDownloadedModelReady = false;
    this.publish({
      status: 'IDLE',
      partialText: '',
      usingNetworkFallback: false,
      capabilities,
      provider: localProvider.provider,
      route: localProvider.route,
      modelState: localProvider.modelState,
      stage: 'capability',
      mayUseNetwork: false,
      notice:
        localProvider.modelState === 'READY'
          ? '语音能力已重新检测，可以开始语音记账。'
          : '已重新检测本地语音能力，可以再次尝试。',
      canRecheck: false,
    });
  }

  private permissionErrorAfterRecheck(
    capabilities: SpeechCapabilities,
    previousErrorCode: SpeechErrorCode | undefined,
  ): SpeechErrorCode | undefined {
    switch (capabilities.permissionStatus) {
      case 'granted':
        return undefined;
      case 'denied':
      case 'not-determined':
        return 'permission-denied';
      case 'blocked':
      case 'restricted':
        return previousErrorCode === 'microphone-disabled' ||
          previousErrorCode === 'microphone-unavailable'
          ? previousErrorCode
          : 'permission-blocked';
      default:
        return previousErrorCode === 'permission-denied' ||
          previousErrorCode === 'permission-blocked' ||
          previousErrorCode === 'microphone-disabled' ||
          previousErrorCode === 'microphone-unavailable'
          ? previousErrorCode
          : undefined;
    }
  }

  private publishRecheckError(
    code: SpeechErrorCode,
    capabilities: SpeechCapabilities | undefined,
    canRecheck: boolean,
  ): void {
    const modelState =
      capabilities === undefined
        ? this.snapshot.modelState
        : localModelStateOf(capabilities);
    const error = errorFor(code, {
      usingNetworkFallback: false,
      canUseNetwork: hasSystemAlternative(capabilities),
      modelState,
      stage:
        code === 'permission-denied' ||
        code === 'permission-blocked' ||
        code === 'microphone-disabled' ||
        code === 'microphone-unavailable'
          ? 'permission'
          : 'capability',
      canRecheck,
    });
    this.publish({
      status: 'ERROR',
      partialText: '',
      usingNetworkFallback: false,
      capabilities,
      modelState,
      stage: error.stage,
      error,
      canRecheck: error.canRecheck,
    });
  }

  private invalidateRecheck(): void {
    const active = this.activeRecheck;
    this.activeRecheck = undefined;
    active?.cancel();
  }

  private isRecheckActive(id: number): boolean {
    return !this.disposed && this.activeRecheck?.id === id;
  }

  private isActive(sessionId: string): boolean {
    return !this.disposed && this.activeSessionId === sessionId;
  }

  private isActiveTurn(
    sessionId: string,
    draftGeneration: number,
    turnGeneration: number,
  ): boolean {
    return (
      this.isActive(sessionId) &&
      this.activeDraftGeneration === draftGeneration &&
      this.activeTurnGeneration === turnGeneration &&
      this.draftGeneration === draftGeneration &&
      this.turnGeneration === turnGeneration
    );
  }

  private ensureUniqueSessionId(proposed: string): string {
    let sessionId = proposed;
    if (this.issuedSessionIds.has(sessionId)) {
      sessionId = `${proposed}-d${this.draftGeneration}-t${this.turnGeneration}`;
      let suffix = 1;
      while (this.issuedSessionIds.has(sessionId)) {
        sessionId = `${proposed}-d${this.draftGeneration}-t${this.turnGeneration}-${suffix}`;
        suffix += 1;
      }
    }
    this.issuedSessionIds.add(sessionId);
    return sessionId;
  }

  private acceptEventGeneration(event: SpeechRecognitionEvent): boolean {
    if (event.generation === undefined) {
      return true;
    }
    if (this.activeNativeGeneration === undefined) {
      if (event.generation !== this.activeTurnGeneration) {
        return false;
      }
      this.activeNativeGeneration = this.activeTurnGeneration;
      return true;
    }
    return this.activeNativeGeneration === event.generation;
  }

  private ensureResultToken(): string {
    if (this.activeResultToken === undefined) {
      this.resultSequence += 1;
      this.activeResultToken = `${this.logicalDictationId}:d${this.draftGeneration}:t${this.turnGeneration}:r${this.resultSequence}`;
    }
    return this.activeResultToken;
  }

  private closeActiveTurn(): void {
    this.activeSessionId = undefined;
    this.activeDraftGeneration = undefined;
    this.activeTurnGeneration = undefined;
    this.activeNativeGeneration = undefined;
    this.pendingStop = undefined;
  }

  private invalidateTurnState(): void {
    this.closeActiveTurn();
    this.acceptedTranscript = '';
    this.freshTurnTranscript = '';
    this.activeResultToken = undefined;
  }

  private handleEvent(event: SpeechRecognitionEvent): void {
    if (!this.isActive(event.sessionId) || !this.acceptEventGeneration(event)) {
      return;
    }
    const metadata = {
      provider:
        event.provider !== undefined && event.provider !== 'unknown'
          ? event.provider
          : this.snapshot.provider,
      route:
        event.route !== undefined && event.route !== 'unknown'
          ? event.route
          : this.snapshot.route,
      modelState:
        event.modelState !== undefined &&
        (event.modelState !== 'UNKNOWN' ||
          (event.type === 'error' && event.code === 'model-missing'))
          ? event.modelState
          : this.snapshot.modelState,
      stage:
        event.stage !== undefined && event.stage !== 'unknown'
          ? event.stage
          : this.snapshot.stage,
      mayUseNetwork: event.mayUseNetwork ?? this.snapshot.mayUseNetwork,
      captureOwnership:
        event.captureOwnership ?? this.snapshot.captureOwnership,
      endpointOwnership:
        event.endpointOwnership ?? this.snapshot.endpointOwnership,
      endReason: event.endReason ?? this.snapshot.endReason,
    };
    if (event.type === 'audio-state') {
      if (this.snapshot.status === 'LISTENING') {
        this.publish({
          ...this.snapshot,
          ...metadata,
          volumeLevel: event.volumeLevel,
          speechDetected: event.speechDetected,
          trailingSilenceMs: event.trailingSilenceMs,
          endpointHinted: event.endpointHinted,
        });
      }
      return;
    }
    if (event.type === 'partial') {
      const incoming = event.text.trim();
      if (incoming.length === 0) {
        return;
      }
      this.freshTurnTranscript = incoming;
      const partialText = mergeSpeechTranscripts(
        this.acceptedTranscript,
        incoming,
      );
      if (!isBookkeepingTextWithinLimit(partialText)) {
        this.fail(event.sessionId, 'result-too-long', {
          usingNetworkFallback: this.snapshot.usingNetworkFallback,
          provider: metadata.provider,
          route: metadata.route,
          modelState: metadata.modelState,
          stage: 'result',
          nativeRetryable: true,
          capabilities: this.snapshot.capabilities,
        });
        return;
      }
      if (['STARTING', 'LISTENING'].includes(this.snapshot.status)) {
        this.publish({
          ...this.snapshot,
          ...metadata,
          status: 'LISTENING',
          partialText,
          stage: 'listening',
          resultToken: this.ensureResultToken(),
          hasFreshTurnEvidence: true,
        });
      }
      return;
    }
    if (event.type === 'state') {
      if (event.state === 'listening') {
        if (['STARTING', 'LISTENING'].includes(this.snapshot.status)) {
          this.publish({
            ...this.snapshot,
            ...metadata,
            status: 'LISTENING',
            stage: 'listening',
          });
        }
      } else if (event.state === 'processing') {
        if (
          event.endReason === 'user-stop' &&
          this.pendingStop?.acknowledged !== true
        ) {
          return;
        }
        this.publish({
          ...this.snapshot,
          ...metadata,
          status: 'PROCESSING',
          stage: 'result',
        });
      } else if (event.state === 'cancelled') {
        this.invalidateTurnState();
        this.publish({
          status: 'CANCELLED',
          partialText: '',
          usingNetworkFallback: false,
          capabilities: this.snapshot.capabilities,
          ...metadata,
          stage: 'lifecycle',
          endReason: event.endReason ?? 'cancelled',
          resultToken: undefined,
          hasFreshTurnEvidence: false,
        });
      }
      return;
    }
    if (event.type === 'error') {
      if (event.code === 'cancelled') {
        this.invalidateTurnState();
        this.publish({
          status: 'CANCELLED',
          partialText: '',
          usingNetworkFallback: false,
          capabilities: this.snapshot.capabilities,
          ...metadata,
          stage: 'lifecycle',
          endReason: event.endReason ?? 'cancelled',
          resultToken: undefined,
          hasFreshTurnEvidence: false,
        });
      } else {
        this.fail(event.sessionId, event.code, {
          usingNetworkFallback: this.snapshot.usingNetworkFallback,
          canUseNetwork: hasSystemAlternative(this.snapshot.capabilities),
          provider: metadata.provider,
          route: metadata.route,
          modelState: metadata.modelState,
          stage: metadata.stage ?? 'result',
          nativeRetryable: event.retryable,
          nativeCode: event.nativeCode ?? event.androidErrorCode,
          capabilities: this.snapshot.capabilities,
        });
      }
      return;
    }

    const pendingStop = this.pendingStop;
    if (pendingStop !== undefined && !pendingStop.acknowledged) {
      pendingStop.bufferedFinal = event;
      return;
    }
    this.finishWithFinal(event, pendingStop?.acknowledged === true);
  }

  private finishWithFinal(
    event: Extract<SpeechRecognitionEvent, { type: 'final' }>,
    acknowledgedUserStop: boolean,
  ): void {
    if (!this.isActive(event.sessionId) || !this.acceptEventGeneration(event)) {
      return;
    }
    const metadata = {
      provider:
        event.provider !== undefined && event.provider !== 'unknown'
          ? event.provider
          : this.snapshot.provider,
      route:
        event.route !== undefined && event.route !== 'unknown'
          ? event.route
          : this.snapshot.route,
      modelState:
        event.modelState !== undefined && event.modelState !== 'UNKNOWN'
          ? event.modelState
          : this.snapshot.modelState,
      mayUseNetwork: event.mayUseNetwork ?? this.snapshot.mayUseNetwork,
      captureOwnership:
        event.captureOwnership ?? this.snapshot.captureOwnership,
      endpointOwnership:
        event.endpointOwnership ?? this.snapshot.endpointOwnership,
    };
    const incoming = event.text.trim() || this.freshTurnTranscript.trim();
    const hasFreshTurnEvidence = incoming.length > 0;
    if (hasFreshTurnEvidence) {
      this.freshTurnTranscript = incoming;
    }
    const finalText = hasFreshTurnEvidence
      ? mergeSpeechTranscripts(this.acceptedTranscript, incoming)
      : '';
    if (!isBookkeepingTextWithinLimit(finalText)) {
      this.fail(event.sessionId, 'result-too-long', {
        usingNetworkFallback: this.snapshot.usingNetworkFallback,
        provider: metadata.provider,
        route: metadata.route,
        modelState: metadata.modelState,
        stage: 'result',
        nativeRetryable: true,
        capabilities: this.snapshot.capabilities,
      });
      return;
    }
    const endReason: SpeechEndReason = acknowledgedUserStop
      ? 'user-stop'
      : metadata.route === 'system-activity'
        ? 'external-activity'
        : 'provider-endpoint';
    this.closeActiveTurn();
    if (finalText.length === 0) {
      this.acceptedTranscript = '';
      this.freshTurnTranscript = '';
      this.activeResultToken = undefined;
      this.publish({
        ...this.snapshot,
        ...metadata,
        status: 'ERROR',
        partialText: '',
        error: errorFor('no-speech', {
          usingNetworkFallback: this.snapshot.usingNetworkFallback,
          canUseNetwork: hasSystemAlternative(this.snapshot.capabilities),
          provider: metadata.provider,
          route: metadata.route,
          modelState: metadata.modelState,
          stage: 'result',
        }),
        stage: 'result',
        endReason,
        canContinue: false,
        resultToken: undefined,
        hasFreshTurnEvidence: false,
      });
      return;
    }
    const resultToken = this.ensureResultToken();
    this.publish({
      ...this.snapshot,
      ...metadata,
      status: 'SUCCEEDED',
      partialText: '',
      finalText,
      stage: 'result',
      endReason,
      canContinue: endReason !== 'user-stop',
      resultToken,
      hasFreshTurnEvidence: true,
      endpointHinted: event.endpointHinted ?? this.snapshot.endpointHinted,
      acousticConfidence: event.acousticConfidence,
      audioQuality: event.audioQuality,
    });
    this.acceptedTranscript = finalText;
    if (endReason === 'user-stop') {
      this.options.onFinalResult?.(finalText, resultToken);
    }
  }

  private fail(
    sessionId: string,
    code: SpeechErrorCode,
    context: ErrorContext & { capabilities?: SpeechCapabilities } = {},
  ): void {
    if (!this.isActive(sessionId)) {
      return;
    }
    const hasFreshTurnEvidence = this.freshTurnTranscript.trim().length > 0;
    const partialText = hasFreshTurnEvidence
      ? mergeSpeechTranscripts(
          this.acceptedTranscript,
          this.freshTurnTranscript,
        )
      : '';
    const resultToken =
      hasFreshTurnEvidence &&
      code !== 'result-too-long' &&
      code !== 'recording-too-long'
        ? this.ensureResultToken()
        : undefined;
    this.closeActiveTurn();
    if (resultToken === undefined) {
      this.activeResultToken = undefined;
    }
    const usingNetworkFallback =
      context.usingNetworkFallback ?? this.snapshot.usingNetworkFallback;
    this.publish({
      status: 'ERROR',
      partialText,
      error: errorFor(code, context),
      usingNetworkFallback,
      capabilities: context.capabilities ?? this.snapshot.capabilities,
      provider: context.provider ?? this.snapshot.provider,
      route: context.route ?? this.snapshot.route,
      modelState: context.modelState ?? this.snapshot.modelState,
      stage: context.stage ?? this.snapshot.stage,
      mayUseNetwork: this.snapshot.mayUseNetwork,
      captureOwnership: this.snapshot.captureOwnership,
      endpointOwnership: this.snapshot.endpointOwnership,
      endReason: this.snapshot.endReason,
      canContinue: false,
      resultToken,
      hasFreshTurnEvidence: resultToken !== undefined,
    });
  }

  private publish(snapshot: SpeechSnapshotInput): void {
    if (this.disposed) {
      return;
    }
    const next: SpeechRecognitionSnapshot = {
      ...snapshot,
      draftGeneration: snapshot.draftGeneration ?? this.draftGeneration,
      turnGeneration: snapshot.turnGeneration ?? this.turnGeneration,
    };
    this.snapshot = next;
    this.listeners.forEach(listener => listener(next));
  }
}
