import type { TransactionType } from '../../domain/entities';

export type SupportedModelTransactionType = Extract<
  TransactionType,
  'EXPENSE' | 'INCOME'
>;

export type OnDeviceCategoryAbstentionReason =
  | 'LOW_CONFIDENCE'
  | 'LOW_MARGIN'
  | 'OOV'
  | 'TYPE_UNSUPPORTED'
  | 'MODEL_UNAVAILABLE'
  | 'INVALID_RESULT'
  | 'TIMEOUT';

export type OnDeviceCategoryPrediction = {
  modelId: string;
  modelVersion: string;
  taxonomyVersion: number;
  parentCategoryKey?: string;
  subcategoryKey?: string;
  top1Probability: number;
  top2Probability: number;
  calibratedConfidence: number;
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
  reason?: string;
};

export type OnDeviceBillClassifierPort = {
  status(): Promise<OnDeviceBillClassifierStatus>;
  classify(
    text: string,
    type: SupportedModelTransactionType,
  ): Promise<OnDeviceCategoryPrediction>;
  close(): Promise<void>;
};
