import { confidenceLevelFor } from '../types';
import type { ParsedTransactionCandidate } from '../types';
import { simplifyBookkeepingClassification } from '../../domain/policies/simplifiedBookkeepingPolicy';
import type {
  OnDeviceBillClassifierPort,
  OnDeviceCategoryPrediction,
  SupportedModelTransactionType,
} from './types';
import {
  markedCounterpartyCandidateText,
  modelEligibleCounterpartyCandidates,
} from '../counterparty/counterpartyExtractor';

const MODEL_TIMEOUT_MS = 500;
const MODEL_ELIGIBLE_SOURCES = new Set(['COMMON_KEYWORD', 'DEFAULT']);

const CATEGORY_INDEPENDENT_AMOUNT_AMBIGUITIES: readonly RegExp[] = [
  /^检测到非人民币币种/u,
  /^金额数字格式无效/u,
  /^“块”既可能表示数量也可能表示金额/u,
  /^检测到尚未建模的优惠/u,
  /^同一条描述中存在多个单价/u,
  /^检测到单价但/u,
  /^购买数量/u,
  /^同一计价单位/u,
  /^数量与单价/u,
  /^明确总价与数量乘单价/u,
  /^同一条描述中存在多个(?:不同)?金额/u,
  /^检测到多个价格/u,
  /^检测到价格或优惠金额/u,
  /^“两百三”一类口语金额/u,
];

function hasOnlyCategoryIndependentAmbiguities(
  reasons: readonly string[],
): boolean {
  return reasons.every(reason =>
    CATEGORY_INDEPENDENT_AMOUNT_AMBIGUITIES.some(pattern =>
      pattern.test(reason),
    ),
  );
}

export function isEligibleForOnDeviceModel(
  candidate: ParsedTransactionCandidate,
): candidate is ParsedTransactionCandidate & {
  type: SupportedModelTransactionType;
} {
  return (
    (candidate.type === 'EXPENSE' || candidate.type === 'INCOME') &&
    MODEL_ELIGIBLE_SOURCES.has(candidate.suggestionSource) &&
    hasOnlyCategoryIndependentAmbiguities(candidate.ambiguityReasons) &&
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

async function enrichCounterparty(
  candidate: ParsedTransactionCandidate,
  classifier: OnDeviceBillClassifierPort,
): Promise<ParsedTransactionCandidate> {
  if (
    candidate.merchantRawName !== undefined ||
    classifier.scoreCounterpartyCandidates === undefined
  ) {
    return candidate;
  }
  const counterparties = modelEligibleCounterpartyCandidates(
    candidate.sourceText,
  ).slice(0, 64);
  if (counterparties.length === 0) return candidate;
  try {
    const scores = await withTimeout(
      classifier.scoreCounterpartyCandidates(
        counterparties.map(counterparty =>
          markedCounterpartyCandidateText(candidate.sourceText, counterparty),
        ),
      ),
    );
    if (scores === undefined || scores.length !== counterparties.length) {
      return candidate;
    }
    const bestIndex = scores.reduce(
      (best, score, index) =>
        score.primaryProbability > scores[best].primaryProbability
          ? index
          : best,
      0,
    );
    const score = scores[bestIndex];
    if (score.primaryProbability < score.threshold) return candidate;
    return {
      ...candidate,
      merchantRawName: counterparties[bestIndex].text,
      advisoryReasons: [
        ...(candidate.advisoryReasons ?? []),
        '商户 / 对象由端侧 AI 建议，请确认',
      ],
    };
  } catch {
    return candidate;
  }
}

export async function enrichCandidatesWithOnDeviceModel(
  candidates: readonly ParsedTransactionCandidate[],
  classifier: OnDeviceBillClassifierPort,
): Promise<ParsedTransactionCandidate[]> {
  return Promise.all(
    candidates.map(async candidate => {
      let enriched: ParsedTransactionCandidate = candidate;
      if (isEligibleForOnDeviceModel(candidate)) {
        try {
          const prediction = await withTimeout(
            classifier.classify(candidate.sourceText, candidate.type),
          );
          if (prediction !== undefined) {
            enriched = applyPrediction(candidate, prediction);
          }
        } catch {
          // Model availability must never make bookkeeping unavailable.
        }
      }
      return enrichCounterparty(enriched, classifier);
    }),
  );
}
