import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';

import { SpeechRecognitionController } from './SpeechRecognitionController';
import { createNativeSpeechRecognitionPort } from './nativeSpeechRecognition';
import {
  INITIAL_SPEECH_SNAPSHOT,
  type SpeechRecognitionSnapshot,
} from './types';

export type SpeechRecognitionActions = {
  start: () => void;
  stop: () => void;
  cancel: () => void;
  retry: () => void;
  useNetworkAndRetry: () => void;
  openSettings: () => void;
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

  useEffect(() => {
    const controller = new SpeechRecognitionController(
      createNativeSpeechRecognitionPort(),
      { onFinalResult: text => onFinalResultRef.current(text) },
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
  }, []);

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
  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => undefined);
  }, []);

  return [
    snapshot,
    { start, stop, cancel, retry, useNetworkAndRetry, openSettings },
  ];
}
