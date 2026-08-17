import { confidenceLevelFor } from '../types';
import type { ParsedTransactionCandidate } from '../types';
import { simplifyBookkeepingClassification } from '../../domain/policies/simplifiedBookkeepingPolicy';
import type {
  OnDeviceBillClassifierPort,
  OnDeviceCategoryPrediction,
  SupportedModelTransactionType,
} from './types';

const MODEL_TIMEOUT_MS = 500;
const MODEL_ELIGIBLE_SOURCES = new Set(['COMMON_KEYWORD', 'DEFAULT']);

export function isEligibleForOnDeviceModel(
  candidate: ParsedTransactionCandidate,
): candidate is ParsedTransactionCandidate & {
  type: SupportedModelTransactionType;
} {
  return (
    (candidate.type === 'EXPENSE' || candidate.type === 'INCOME') &&
    MODEL_ELIGIBLE_SOURCES.has(candidate.suggestionSource) &&
    candidate.ambiguityReasons.length === 0 &&
    candidate.categoryAlternatives.length === 0 &&
    candidate.sourceText.trim().length > 0
  );
}

function predictionMatchesType(
  prediction: OnDeviceCategoryPrediction,
  type: SupportedModelTransactionType,
): boolean {
  const directionMatches =
    type === 'EXPENSE'
      ? prediction.parentCategoryKey?.startsWith('expense.') === true
      : prediction.parentCategoryKey === 'income' ||
        prediction.parentCategoryKey?.startsWith('income.') === true;
  return (
    directionMatches &&
    (prediction.subcategoryKey === undefined ||
      prediction.subcategoryKey.startsWith(`${prediction.parentCategoryKey}.`))
  );
}

function applyPrediction(
  candidate: ParsedTransactionCandidate & {
    type: SupportedModelTransactionType;
  },
  prediction: OnDeviceCategoryPrediction,
): ParsedTransactionCandidate {
  if (
    prediction.abstained ||
    !predictionMatchesType(prediction, candidate.type)
  ) {
    return candidate;
  }
  const gains =
    (candidate.categoryKey === undefined ? 0.15 : 0) +
    (candidate.subcategoryKey === undefined &&
    prediction.subcategoryKey !== undefined
      ? 0.12
      : 0);
  // This only restores completeness evidence. Model probability remains
  // separate and the advisory cap prevents DIRECT_CONFIRM.
  const confidence = Math.min(
    0.89,
    Number((candidate.confidence + gains).toFixed(2)),
  );
  const predictedCategory = prediction.parentCategoryKey?.startsWith('expense.')
    ? prediction.parentCategoryKey
    : undefined;
  const predictedCategoryKey = prediction.parentCategoryKey ?? 'income';
  return {
    ...candidate,
    ...simplifyBookkeepingClassification({
      type: candidate.type,
      categoryKey: predictedCategory,
    }),
    categoryKey: predictedCategory,
    subcategoryKey:
      predictedCategory === undefined ? undefined : prediction.subcategoryKey,
    suggestionSource: 'ON_DEVICE_MODEL',
    confidence,
    confidenceLevel: confidenceLevelFor(confidence),
    missingFields: candidate.missingFields.filter(field => field !== '分类'),
    advisoryReasons: [
      ...(candidate.advisoryReasons ?? []),
      '分类由端侧 AI 建议，请确认',
    ],
    onDeviceModel: {
      modelId: prediction.modelId,
      modelVersion: prediction.modelVersion,
      taxonomyVersion: prediction.taxonomyVersion,
      deploymentMode: prediction.deploymentMode ?? 'LEGACY',
      predictedCategoryKey,
      calibratedConfidence: prediction.calibratedConfidence,
      top1Probability: prediction.top1Probability,
      top2Probability: prediction.top2Probability,
      latencyMs: prediction.latencyMs,
    },
  };
}

async function withTimeout<T>(promise: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), MODEL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function enrichCandidatesWithOnDeviceModel(
  candidates: readonly ParsedTransactionCandidate[],
  classifier: OnDeviceBillClassifierPort,
): Promise<ParsedTransactionCandidate[]> {
  return Promise.all(
    candidates.map(async candidate => {
      if (!isEligibleForOnDeviceModel(candidate)) return candidate;
      try {
        const prediction = await withTimeout(
          classifier.classify(candidate.sourceText, candidate.type),
        );
        return prediction === undefined
          ? candidate
          : applyPrediction(candidate, prediction);
      } catch {
        // Model availability must never make bookkeeping unavailable.
        return candidate;
      }
    }),
  );
}
