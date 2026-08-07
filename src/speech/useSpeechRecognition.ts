import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking } from 'react-native';

import { useRepositories } from '../app/DatabaseProvider';
import { SpeechRecognitionController } from './SpeechRecognitionController';
import { createNativeSpeechRecognitionPort } from './nativeSpeechRecognition';
import {
  INITIAL_SPEECH_SNAPSHOT,
  type SpeechEnginePreferenceStore,
  type SpeechRecognitionSnapshot,
} from './types';

export type SpeechRecognitionActions = {
  start: () => void;
  stop: () => void;
  cancel: () => void;
  retry: () => void;
  useNetworkAndRetry: () => void;
  selectEngine: (engineId: string) => void;
  openSettings: () => void;
  openVoiceInputSettings: () => void;
};

export function useSpeechRecognition(
  onFinalResult: (text: string) => void,
): [SpeechRecognitionSnapshot, SpeechRecognitionActions] {
  const onFinalResultRef = useRef(onFinalResult);
  const controllerRef = useRef<SpeechRecognitionController | undefined>(
    undefined,
  );
  const [snapshot, setSnapshot] = useState<SpeechRecognitionSnapshot>(
    INITIAL_SPEECH_SNAPSHOT,
  );
  onFinalResultRef.current = onFinalResult;

  const repositories = useRepositories();
  const preferenceStore = useMemo<SpeechEnginePreferenceStore>(
    () => ({
      loadPreferredEngineId: () =>
        repositories.personalizationSettings
          .getPreferredSpeechEngineId()
          .catch(() => undefined),
      savePreferredEngineId: engineId =>
        repositories.personalizationSettings.setPreferredSpeechEngineId(
          engineId,
        ),
    }),
    [repositories],
  );

  useEffect(() => {
    const controller = new SpeechRecognitionController(
      createNativeSpeechRecognitionPort(),
      {
        onFinalResult: text => onFinalResultRef.current(text),
        preferenceStore,
      },
    );
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setSnapshot);
    return () => {
      controllerRef.current = undefined;
      unsubscribe();
      // Android and iOS native modules own lifecycle cancellation because only
      // they can distinguish a real background transition from an OEM speech UI.
      controller.dispose().catch(() => undefined);
    };
  }, [preferenceStore]);

  const start = useCallback(() => {
    controllerRef.current?.start(false).catch(() => undefined);
  }, []);
  const stop = useCallback(() => {
    controllerRef.current?.stop().catch(() => undefined);
  }, []);
  const cancel = useCallback(() => {
    controllerRef.current?.cancel().catch(() => undefined);
  }, []);
  const retry = useCallback(() => {
    controllerRef.current?.retry().catch(() => undefined);
  }, []);
  const useNetworkAndRetry = useCallback(() => {
    controllerRef.current?.useNetworkAndRetry().catch(() => undefined);
  }, []);
  const selectEngine = useCallback((engineId: string) => {
    controllerRef.current?.selectEngine(engineId).catch(() => undefined);
  }, []);
  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => undefined);
  }, []);
  const openVoiceInputSettings = useCallback(() => {
    controllerRef.current?.openVoiceInputSettings().catch(() => undefined);
  }, []);

  return [
    snapshot,
    {
      start,
      stop,
      cancel,
      retry,
      useNetworkAndRetry,
      selectEngine,
      openSettings,
      openVoiceInputSettings,
    },
  ];
}
