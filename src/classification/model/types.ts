import type { TransactionType } from '../../domain/entities';

export type SupportedModelTransactionType = Extract<
  TransactionType,
  'EXPENSE' | 'INCOME'
>;

export type OnDeviceModelDeploymentMode =
  'LEGACY' | 'BENCHMARK_ONLY' | 'SHADOW';

export type OnDeviceCategoryAbstentionReason =
  | 'LOW_CONFIDENCE'
  | 'LOW_MARGIN'
  | 'OOV'
  | 'TYPE_UNSUPPORTED'
  | 'TYPE_MISMATCH'
  | 'CATEGORY_DISABLED'
  | 'CATEGORY_THRESHOLD'
  | 'MODEL_UNAVAILABLE'
  | 'INVALID_RESULT'
  | 'TIMEOUT';

export type OnDeviceCategoryPrediction = {
  modelId: string;
  modelVersion: string;
  taxonomyVersion: number;
  deploymentMode?: OnDeviceModelDeploymentMode;
  parentCategoryKey?: string;
  subcategoryKey?: string;
  top1Probability: number;
  top2Probability: number;
  calibratedConfidence: number;
  calibratedTop2Probability?: number;
  abstained: boolean;
  reason?: OnDeviceCategoryAbstentionReason;
  latencyMs: number;
};

export type OnDeviceBillClassifierStatus = {
  available: boolean;
  loaded: boolean;
  modelId?: string;
  modelVersion?: string;
  taxonomyVersion?: number;
  deploymentMode?: OnDeviceModelDeploymentMode;
  reason?: string;
};

export type OnDeviceCounterpartyCandidateScore = {
  primaryProbability: number;
  notCounterpartyProbability: number;
  threshold: number;
  modelVersion: string;
  latencyMs: number;
};

export type OnDeviceBillClassifierPort = {
  status(): Promise<OnDeviceBillClassifierStatus>;
  classify(
    text: string,
    type: SupportedModelTransactionType,
  ): Promise<OnDeviceCategoryPrediction>;
  scoreCounterpartyCandidates?(
    modelTexts: readonly string[],
  ): Promise<readonly OnDeviceCounterpartyCandidateScore[]>;
  close(): Promise<void>;
};
