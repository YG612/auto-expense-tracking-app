import type {
  Account,
  AccountType,
  Category,
  Merchant,
  TransactionType,
  UserRule,
} from '../domain/entities';
import type {
  CashFlowDirection,
  SimplifiedClassificationLabel,
  SimplifiedSemanticFlags,
} from '../domain/policies/simplifiedBookkeepingPolicy';
import type {
  TransactionEventBlockingReason,
  TransactionEventFacts,
} from './parsers/transactionEventFacts';
import type { TransactionFactResolution } from './facts';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type AccountResolutionSource =
  'EXPLICIT_TEXT' | 'USER_RULE' | 'RECENT_FALLBACK' | 'MISSING';

export type ClassificationSuggestionSource =
  | 'EXPLICIT_TEXT'
  | 'USER_RULE'
  | 'LEARNED_MERCHANT'
  | 'MERCHANT_DICTIONARY'
  | 'SEMANTIC_ONTOLOGY'
  | 'ON_DEVICE_MODEL'
  | 'COMMON_KEYWORD'
  | 'DEFAULT';

export type OnDeviceModelMetadata = {
  modelId: string;
  modelVersion: string;
  taxonomyVersion: number;
  deploymentMode: 'LEGACY' | 'BENCHMARK_ONLY' | 'SHADOW';
  predictedCategoryKey: string;
  calibratedConfidence: number;
  top1Probability: number;
  top2Probability: number;
  latencyMs: number;
};

export type CandidateAlternative = {
  label: string;
  type?: TransactionType;
  categoryKey?: string;
  subcategoryKey?: string;
};

export interface ParsedTransactionCandidate {
  /** Structured facts evaluated before amount/category/model inference. */
  eventFacts?: TransactionEventFacts;
  /** V2 span/evidence audit; absent when the shared fact layer has no match. */
  factResolution?: TransactionFactResolution;
  /** User-facing cash-flow direction. Legacy `type` remains internal. */
  direction?: CashFlowDirection;
  /** Nine-label contract: `income` or one of eight expense groups. */
  classificationLabel?: SimplifiedClassificationLabel;
  /** Internal safety/statistics signals; these are not user-facing types. */
  semanticFlags?: SimplifiedSemanticFlags;
  type?: TransactionType;
  amountMinor?: number;
  currency: string;
  occurredAt?: string;
  categoryKey?: string;
  subcategoryKey?: string;
  accountKey?: AccountType;
  targetAccountKey?: AccountType;
  merchantRawName?: string;
  projectName?: string;
  tags: string[];
  note?: string;
  confidence: number;
  missingFields: string[];
  ambiguityReasons: string[];
  /** Non-blocking suggestions that the user can accept with one confirmation. */
  advisoryReasons?: string[];
  /** How the source account was selected. Always emitted by the local parser. */
  accountResolutionSource?: AccountResolutionSource;

  /** The exact user input is kept for local persistence after confirmation. */
  originalText: string;
  /** The normalized clause represented by this candidate. */
  sourceText: string;
  categoryAlternatives: CandidateAlternative[];
  confidenceLevel: ConfidenceLevel;

  /** Explains why the suggested type/category/account was selected. */
  suggestionSource: ClassificationSuggestionSource;
  /** Audit metadata only; the model never controls persistence by itself. */
  onDeviceModel?: OnDeviceModelMetadata;
  /** Present only when an enabled user rule materially affected the result. */
  matchedRuleId?: string;
  matchedRuleType?: UserRule['ruleType'];
  matchedRulePattern?: string;
  matchedRulePriority?: number;

  /** Optional database hints supplied by existing local rules/dictionaries. */
  categoryIdHint?: string;
  subcategoryIdHint?: string;
  accountIdHint?: string;
  merchantIdHint?: string;
}

export type TextParsingContext = {
  referenceDate: Date;
  /** Minutes east of UTC. Defaults to the device's current time zone. */
  timezoneOffsetMinutes?: number;
  recentAccountKey?: AccountType;
  categories?: readonly Category[];
  accounts?: readonly Account[];
  userRules?: readonly UserRule[];
  merchants?: readonly Merchant[];
};

export type TextParsingResult = {
  originalText: string;
  normalizedText: string;
  candidates: ParsedTransactionCandidate[];
  /** Explains source clauses rejected by the transaction-event safety gate. */
  blockedEvents: TransactionEventBlockingReason[];
};

export function confidenceLevelFor(score: number): ConfidenceLevel {
  if (score >= 0.9) {
    return 'HIGH';
  }
  if (score >= 0.65) {
    return 'MEDIUM';
  }
  return 'LOW';
}
