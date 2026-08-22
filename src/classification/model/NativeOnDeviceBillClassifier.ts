import { NativeModules } from 'react-native';

import { preprocessBillClassifierText } from './preprocessBillClassifierText';
import type {
  OnDeviceBillClassifierPort,
  OnDeviceBillClassifierStatus,
  OnDeviceCategoryPrediction,
  OnDeviceCounterpartyCandidateScore,
  SupportedModelTransactionType,
} from './types';

type NativeClassifier = {
  getStatus(): Promise<unknown>;
  classify(text: string, type: SupportedModelTransactionType): Promise<unknown>;
  scoreCounterpartyCandidates(modelTexts: readonly string[]): Promise<unknown>;
  close(): Promise<void>;
};

function validateCounterpartyScores(
  value: unknown,
  expectedLength: number,
): readonly OnDeviceCounterpartyCandidateScore[] {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error(
      'On-device counterparty classifier returned an invalid result.',
    );
  }
  return value.map(item => {
    if (item === null || typeof item !== 'object') {
      throw new Error(
        'On-device counterparty classifier returned an invalid result.',
      );
    }
    const score = item as Partial<OnDeviceCounterpartyCandidateScore>;
    if (
      !finiteProbability(score.primaryProbability) ||
      !finiteProbability(score.notCounterpartyProbability) ||
      !finiteProbability(score.threshold) ||
      typeof score.modelVersion !== 'string' ||
      score.modelVersion.length === 0 ||
      score.modelVersion.length > MODEL_VERSION_LIMIT ||
      typeof score.latencyMs !== 'number' ||
      !Number.isFinite(score.latencyMs) ||
      score.latencyMs < 0 ||
      score.latencyMs > 60_000
    ) {
      throw new Error(
        'On-device counterparty classifier returned an invalid result.',
      );
    }
    return score as OnDeviceCounterpartyCandidateScore;
  });
}

const MODEL_ID_LIMIT = 100;
const MODEL_VERSION_LIMIT = 50;

function nativeModule(): NativeClassifier | undefined {
  return NativeModules.OnDeviceBillClassifier as NativeClassifier | undefined;
}

function finiteProbability(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function optionalKey(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 150 &&
      /^(?:income|(?:expense|income)\.[a-z0-9_.]+)$/u.test(value))
  );
}

function optionalDeploymentMode(value: unknown): boolean {
  return (
    value === undefined ||
    value === 'LEGACY' ||
    value === 'BENCHMARK_ONLY' ||
    value === 'SHADOW'
  );
}

function validatePrediction(value: unknown): OnDeviceCategoryPrediction {
  if (value === null || typeof value !== 'object') {
    throw new Error('On-device classifier returned an invalid result.');
  }
  const result = value as Partial<OnDeviceCategoryPrediction>;
  if (
    typeof result.modelId !== 'string' ||
    result.modelId.length === 0 ||
    result.modelId.length > MODEL_ID_LIMIT ||
    typeof result.modelVersion !== 'string' ||
    result.modelVersion.length === 0 ||
    result.modelVersion.length > MODEL_VERSION_LIMIT ||
    !Number.isSafeInteger(result.taxonomyVersion) ||
    (result.taxonomyVersion ?? 0) <= 0 ||
    !optionalDeploymentMode(result.deploymentMode) ||
    !optionalKey(result.parentCategoryKey) ||
    !optionalKey(result.subcategoryKey) ||
    !finiteProbability(result.top1Probability) ||
    !finiteProbability(result.top2Probability) ||
    !finiteProbability(result.calibratedConfidence) ||
    (result.calibratedTop2Probability !== undefined &&
      !finiteProbability(result.calibratedTop2Probability)) ||
    typeof result.abstained !== 'boolean' ||
    typeof result.latencyMs !== 'number' ||
    !Number.isFinite(result.latencyMs) ||
    result.latencyMs < 0 ||
    result.latencyMs > 60_000
  ) {
    throw new Error('On-device classifier returned an invalid result.');
  }
  return result as OnDeviceCategoryPrediction;
}

function validateStatus(value: unknown): OnDeviceBillClassifierStatus {
  if (value === null || typeof value !== 'object') {
    return { available: false, loaded: false, reason: 'INVALID_STATUS' };
  }
  const status = value as Partial<OnDeviceBillClassifierStatus>;
  if (
    typeof status.available !== 'boolean' ||
    typeof status.loaded !== 'boolean'
  ) {
    return { available: false, loaded: false, reason: 'INVALID_STATUS' };
  }
  return status as OnDeviceBillClassifierStatus;
}

export class NativeOnDeviceBillClassifier implements OnDeviceBillClassifierPort {
  async status(): Promise<OnDeviceBillClassifierStatus> {
    const native = nativeModule();
    return native === undefined
      ? { available: false, loaded: false, reason: 'NATIVE_MODULE_MISSING' }
      : validateStatus(await native.getStatus());
  }

  async classify(
    text: string,
    type: SupportedModelTransactionType,
  ): Promise<OnDeviceCategoryPrediction> {
    const native = nativeModule();
    if (native === undefined) {
      throw new Error('On-device bill classification is unavailable.');
    }
    const normalized = preprocessBillClassifierText(text);
    if (normalized.length === 0) {
      throw new Error('On-device bill classification requires non-empty text.');
    }
    return validatePrediction(await native.classify(normalized, type));
  }

  async scoreCounterpartyCandidates(
    modelTexts: readonly string[],
  ): Promise<readonly OnDeviceCounterpartyCandidateScore[]> {
    const native = nativeModule();
    if (native === undefined) {
      throw new Error('On-device counterparty classification is unavailable.');
    }
    if (
      modelTexts.length === 0 ||
      modelTexts.length > 64 ||
      modelTexts.some(text => text.trim().length === 0 || text.length > 2000)
    ) {
      throw new Error('On-device counterparty candidates are invalid.');
    }
    return validateCounterpartyScores(
      await native.scoreCounterpartyCandidates(modelTexts),
      modelTexts.length,
    );
  }

  async close(): Promise<void> {
    await nativeModule()?.close();
  }
}

export const onDeviceBillClassifier = new NativeOnDeviceBillClassifier();
