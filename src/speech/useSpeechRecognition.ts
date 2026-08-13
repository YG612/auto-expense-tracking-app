import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { SpeechRecognitionController } from './SpeechRecognitionController';
import { createPreferredSpeechRecognitionPort } from './preferredSpeechRecognition';
import {
  createSpeechSettingsReturnCoordinator,
  type SpeechSettingsReturnCoordinator,
} from './settingsReturnRecheck';
import {
  INITIAL_SPEECH_SNAPSHOT,
  type SpeechRecognitionSnapshot,
} from './types';

export type SpeechRecognitionActions = {
  start: () => void;
  continueDictation: () => void;
  stop: () => void;
  cancel: () => void;
  retry: () => void;
  downloadModel: () => void;
  useNetworkAndRetry: () => void;
  openSettings: () => void;
  consumeResult: (resultToken: string) => boolean;
  resetForNewDraft: () => void;
  /** Passive permission/capability refresh; never starts recording or networking. */
  recheck?: () => void;
};

export function useSpeechRecognition(
  onFinalResult: (text: string, resultToken: string) => void,
): [SpeechRecognitionSnapshot, SpeechRecognitionActions] {
  const onFinalResultRef = useRef(onFinalResult);
  const controllerRef = useRef<SpeechRecognitionController | undefined>(
    undefined,
  );
  const settingsCoordinatorRef = useRef<
    SpeechSettingsReturnCoordinator | undefined
  >(undefined);
  const [snapshot, setSnapshot] = useState<SpeechRecognitionSnapshot>(
    INITIAL_SPEECH_SNAPSHOT,
  );
  onFinalResultRef.current = onFinalResult;

  useEffect(() => {
    const controller = new SpeechRecognitionController(
      createPreferredSpeechRecognitionPort(),
      {
        onFinalResult: (text, resultToken) =>
          onFinalResultRef.current(text, resultToken),
      },
    );
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setSnapshot);
    const coordinator = createSpeechSettingsReturnCoordinator(() => {
      controller.recheck().catch(() => undefined);
    });
    settingsCoordinatorRef.current = coordinator;
    const appStateSubscription = AppState.addEventListener('change', state => {
      coordinator.handleAppState(state);
    });
    return () => {
      controllerRef.current = undefined;
      settingsCoordinatorRef.current = undefined;
      coordinator.dispose();
      appStateSubscription.remove();
      unsubscribe();
      // Android and iOS native modules own lifecycle cancellation because only
      // they can distinguish a real background transition from an OEM speech UI.
      controller.dispose().catch(() => undefined);
    };
  }, []);

  const start = useCallback(() => {
    controllerRef.current?.start(false).catch(() => undefined);
  }, []);
  const stop = useCallback(() => {
    controllerRef.current?.stop().catch(() => undefined);
  }, []);
  const continueDictation = useCallback(() => {
    controllerRef.current?.continueDictation().catch(() => undefined);
  }, []);
  const cancel = useCallback(() => {
    controllerRef.current?.cancel().catch(() => undefined);
  }, []);
  const retry = useCallback(() => {
    controllerRef.current?.retry().catch(() => undefined);
  }, []);
  const downloadModel = useCallback(() => {
    controllerRef.current?.downloadModel().catch(() => undefined);
  }, []);
  const useNetworkAndRetry = useCallback(() => {
    controllerRef.current?.useNetworkAndRetry().catch(() => undefined);
  }, []);
  const openSettings = useCallback(() => {
    const coordinator = settingsCoordinatorRef.current;
    coordinator?.markOpeningSettings();
    Linking.openSettings().catch(() => coordinator?.markOpenFailed());
  }, []);
  const recheck = useCallback(() => {
    controllerRef.current?.recheck().catch(() => undefined);
  }, []);
  const consumeResult = useCallback((resultToken: string) => {
    return controllerRef.current?.consumeResult(resultToken) ?? false;
  }, []);
  const resetForNewDraft = useCallback(() => {
    controllerRef.current?.resetForNewDraft();
  }, []);

  return [
    snapshot,
    {
      start,
      continueDictation,
      stop,
      cancel,
      retry,
      downloadModel,
      useNetworkAndRetry,
      openSettings,
      recheck,
      consumeResult,
      resetForNewDraft,
    },
  ];
}
