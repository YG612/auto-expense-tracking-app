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
  type SpeechModelOption,
  type SpeechRecognitionSnapshot,
} from './types';
import {
  getEmbeddedSpeechModels,
  selectEmbeddedSpeechModel,
} from './nativeSpeechRecognition';

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
  /** Internal model-lab controls; absent/empty in ordinary builds. */
  models?: SpeechModelOption[];
  selectedModelId?: string;
  modelSwitching?: boolean;
  modelSwitchError?: string;
  selectModel?: (modelId: string) => void;
};

function modelSwitchFailureMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : '';
  if (code === 'busy') {
    return '当前录音或解码尚未结束，请稍后再点一次。';
  }
  if (code === 'model-missing') {
    return '该模型文件不完整，无法切换。';
  }
  return '模型切换失败，请稍后重试。';
}

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
  const [models, setModels] = useState<SpeechModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [modelSwitching, setModelSwitching] = useState(false);
  const [modelSwitchError, setModelSwitchError] = useState<string>();
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
    let mounted = true;
    getEmbeddedSpeechModels()
      .then(catalog => {
        if (!mounted) return;
        setModels(catalog.models);
        setSelectedModelId(catalog.selectedModelId);
      })
      .catch(() => undefined);
    const unsubscribe = controller.subscribe(setSnapshot);
    const coordinator = createSpeechSettingsReturnCoordinator(() => {
      controller.recheck().catch(() => undefined);
    });
    settingsCoordinatorRef.current = coordinator;
    const appStateSubscription = AppState.addEventListener('change', state => {
      coordinator.handleAppState(state);
    });
    return () => {
      mounted = false;
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
  const selectModel = useCallback(
    (modelId: string) => {
      if (modelSwitching) return;
      setModelSwitchError(undefined);
      setModelSwitching(true);
      selectEmbeddedSpeechModel(modelId)
        .then(selected => {
          setSelectedModelId(selected);
          // Selection is complete once native code has persisted the requested
          // model. Capability warm-up continues in the background and must not
          // lock the picker for its full duration.
          setModelSwitching(false);
          controllerRef.current?.recheck().catch(() => undefined);
        })
        .catch(error => setModelSwitchError(modelSwitchFailureMessage(error)))
        .finally(() => setModelSwitching(false));
    },
    [modelSwitching],
  );

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
      models,
      selectedModelId,
      modelSwitching,
      modelSwitchError,
      selectModel,
    },
  ];
}
