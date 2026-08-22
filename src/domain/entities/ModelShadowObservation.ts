export interface ModelShadowObservation {
  id: string;
  transactionId: string;
  modelId: string;
  modelVersion: string;
  taxonomyVersion: number;
  predictedCategoryKey: string;
  finalCategoryKey: string;
  matched: boolean;
  calibratedConfidence: number;
  latencyMs: number;
  createdAt: string;
}
