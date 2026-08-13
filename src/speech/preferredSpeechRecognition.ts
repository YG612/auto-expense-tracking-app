import {
  createNativeEmbeddedSpeechRecognitionPort,
  createNativeSpeechRecognitionPort,
} from './nativeSpeechRecognition';
import type {
  SpeechCapabilities,
  SpeechRecognitionEvent,
  SpeechRecognitionPort,
  SpeechStartOptions,
} from './types';

function hasReadyEmbeddedProvider(capabilities: SpeechCapabilities): boolean {
  return (
    capabilities.providers?.some(
      provider =>
        provider.provider === 'app-owned-offline' &&
        provider.route === 'app-owned-offline' &&
        provider.available &&
        provider.modelState === 'READY' &&
        provider.mayUseNetwork === false &&
        provider.captureOwnership === 'app' &&
        provider.endpointOwnership === 'app',
    ) === true
  );
}

function hasPreparingEmbeddedProvider(
  capabilities: SpeechCapabilities,
): boolean {
  return (
    capabilities.providers?.some(
      provider =>
        provider.provider === 'app-owned-offline' &&
        provider.route === 'app-owned-offline' &&
        !provider.available &&
        provider.modelState === 'DOWNLOADING' &&
        provider.mayUseNetwork === false &&
        provider.captureOwnership === 'app' &&
        provider.endpointOwnership === 'app',
    ) === true
  );
}

function hasPackagedEmbeddedFailure(capabilities: SpeechCapabilities): boolean {
  return (
    capabilities.providers?.some(
      provider =>
        provider.provider === 'app-owned-offline' &&
        provider.route === 'app-owned-offline' &&
        !provider.available &&
        provider.mayUseNetwork === false &&
        typeof provider.diagnosticCode === 'string' &&
        provider.diagnosticCode.length > 0 &&
        provider.diagnosticCode !== 'embedded-engine-not-in-this-build',
    ) === true
  );
}

/**
 * Chooses one complete speech stack before permission/capture begins.
 *
 * A ready app-owned engine is an atomic replacement for the OEM provider: its
 * capabilities and every command stay on the same port. If it is absent from
 * a production/ordinary Internal build, the existing system stack is used.
 */
export class PreferredSpeechRecognitionPort implements SpeechRecognitionPort {
  private selected: SpeechRecognitionPort;
  private readonly ownerBySession = new Map<string, SpeechRecognitionPort>();
  private readonly cleanupOwnerBySession = new Map<
    string,
    SpeechRecognitionPort
  >();
  private readonly retiredSessionIds = new Set<string>();
  private capabilityRequestSequence = 0;

  constructor(
    private readonly embedded: SpeechRecognitionPort,
    private readonly system: SpeechRecognitionPort,
  ) {
    this.selected = system;
  }

  async getCapabilities(
    locale: string,
    sessionId?: string,
  ): Promise<SpeechCapabilities> {
    const requestSequence = ++this.capabilityRequestSequence;
    try {
      const embeddedCapabilities = await this.embedded.getCapabilities(locale);
      if (hasReadyEmbeddedProvider(embeddedCapabilities)) {
        if (requestSequence === this.capabilityRequestSequence) {
          this.selected = this.embedded;
        }
        if (sessionId !== undefined && !this.retiredSessionIds.has(sessionId)) {
          this.ownerBySession.set(sessionId, this.embedded);
        }
        return embeddedCapabilities;
      }
      // A packaged App-owned model may still be loading its native runtime on
      // the decoder worker. Keep this capability bound to the embedded port so
      // the controller can show PREPARING_MODEL and recheck it; silently
      // probing/binding the OEM provider here would reintroduce automatic
      // system endpointing on the very first recording.
      if (hasPreparingEmbeddedProvider(embeddedCapabilities)) {
        if (requestSequence === this.capabilityRequestSequence) {
          this.selected = this.embedded;
        }
        if (sessionId !== undefined && !this.retiredSessionIds.has(sessionId)) {
          this.ownerBySession.set(sessionId, this.embedded);
        }
        return embeddedCapabilities;
      }
      // A streaming flavor that contains the App-owned provider must fail
      // closed if its packaged runtime/assets are broken. Ordinary builds
      // report `embedded-engine-not-in-this-build` and may still use the
      // established system compatibility path; a broken streaming build must
      // never silently reintroduce the OEM endpoint.
      if (hasPackagedEmbeddedFailure(embeddedCapabilities)) {
        if (requestSequence === this.capabilityRequestSequence) {
          this.selected = this.embedded;
        }
        if (sessionId !== undefined && !this.retiredSessionIds.has(sessionId)) {
          this.ownerBySession.set(sessionId, this.embedded);
        }
        return embeddedCapabilities;
      }
    } catch (error) {
      // The native module's explicit absence capability is the only condition
      // that permits the ordinary build to use the system compatibility path.
      // A rejected capability probe is an unknown packaged-engine failure and
      // must not silently restore OEM endpoint ownership.
      throw error;
    }
    const systemCapabilities = await this.system.getCapabilities(locale);
    if (requestSequence === this.capabilityRequestSequence) {
      this.selected = this.system;
    }
    if (sessionId !== undefined && !this.retiredSessionIds.has(sessionId)) {
      this.ownerBySession.set(sessionId, this.system);
    }
    return systemCapabilities;
  }

  downloadModel(locale: string) {
    return this.selected.downloadModel(locale);
  }

  requestPermission(sessionId: string) {
    const owner = this.bindOwner(sessionId);
    return owner.requestPermission(sessionId);
  }

  start(options: SpeechStartOptions) {
    const owner =
      this.ownerBySession.get(options.sessionId) ??
      this.bindOwner(options.sessionId);
    return owner.start(options);
  }

  stop(sessionId: string) {
    const owner = this.ownerBySession.get(sessionId);
    return owner === undefined ? Promise.resolve(false) : owner.stop(sessionId);
  }

  async cancel(sessionId: string): Promise<void> {
    this.retiredSessionIds.add(sessionId);
    const owner = this.ownerBySession.get(sessionId);
    if (owner === undefined) {
      return;
    }
    // Retain the exact owner across an immediate next-session bind and until
    // reset/dispose follows with destroy for this retired session.
    this.cleanupOwnerBySession.set(sessionId, owner);
    await owner.cancel(sessionId);
  }

  async destroy(sessionId: string): Promise<void> {
    this.retiredSessionIds.add(sessionId);
    const owner =
      this.cleanupOwnerBySession.get(sessionId) ??
      this.ownerBySession.get(sessionId);
    this.ownerBySession.delete(sessionId);
    this.cleanupOwnerBySession.delete(sessionId);
    this.retiredSessionIds.delete(sessionId);
    if (owner !== undefined) {
      await owner.destroy(sessionId);
      return;
    }
    // Before permission/start there is no capture owner yet. Teardown both
    // optional implementations so a partially prepared native object cannot leak.
    await Promise.allSettled([
      this.embedded.destroy(sessionId),
      this.system.destroy(sessionId),
    ]);
  }

  subscribe(listener: (event: SpeechRecognitionEvent) => void): () => void {
    const forwardFrom =
      (source: SpeechRecognitionPort) => (event: SpeechRecognitionEvent) => {
        if (this.ownerBySession.get(event.sessionId) === source) {
          listener(event);
          if (
            event.type === 'final' ||
            event.type === 'error' ||
            (event.type === 'state' && event.state === 'cancelled')
          ) {
            this.ownerBySession.delete(event.sessionId);
          }
        }
      };
    const unsubscribeEmbedded = this.embedded.subscribe(
      forwardFrom(this.embedded),
    );
    const unsubscribeSystem = this.system.subscribe(forwardFrom(this.system));
    return () => {
      unsubscribeEmbedded();
      unsubscribeSystem();
    };
  }

  private bindOwner(sessionId: string): SpeechRecognitionPort {
    if (this.retiredSessionIds.has(sessionId)) {
      return this.selected;
    }
    const existing = this.ownerBySession.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const owner = this.selected;
    this.ownerBySession.set(sessionId, owner);
    return owner;
  }
}

export function createPreferredSpeechRecognitionPort(): SpeechRecognitionPort {
  return new PreferredSpeechRecognitionPort(
    createNativeEmbeddedSpeechRecognitionPort(),
    createNativeSpeechRecognitionPort(),
  );
}
