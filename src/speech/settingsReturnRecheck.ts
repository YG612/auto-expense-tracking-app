export type SpeechAppState = 'active' | 'background' | 'inactive' | string;

export type SpeechSettingsReturnCoordinator = {
  markOpeningSettings: () => void;
  markOpenFailed: () => void;
  handleAppState: (state: SpeechAppState) => void;
  dispose: () => void;
};

/**
 * Settings return is deliberately modelled separately from speech sessions.
 * It waits for a real inactive/background transition before accepting active,
 * then invokes one passive recheck. No microphone or network action lives here.
 */
export function createSpeechSettingsReturnCoordinator(
  onReturn: () => void,
): SpeechSettingsReturnCoordinator {
  let pending = false;
  let leftApp = false;
  let disposed = false;

  const reset = () => {
    pending = false;
    leftApp = false;
  };

  return {
    markOpeningSettings() {
      if (disposed) {
        return;
      }
      pending = true;
      leftApp = false;
    },
    markOpenFailed() {
      reset();
    },
    handleAppState(state) {
      if (disposed || !pending) {
        return;
      }
      if (state === 'inactive' || state === 'background') {
        leftApp = true;
        return;
      }
      if (state !== 'active') {
        return;
      }
      if (!leftApp) {
        return;
      }
      reset();
      onReturn();
    },
    dispose() {
      disposed = true;
      reset();
    },
  };
}
