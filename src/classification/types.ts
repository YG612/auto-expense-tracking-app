import type {
  Account,
  AccountType,
  Category,
  Merchant,
  TransactionType,
  UserRule,
} from '../domain/entities';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type ClassificationSuggestionSource =
  | 'EXPLICIT_TEXT'
  | 'USER_RULE'
  | 'LEARNED_MERCHANT'
  | 'MERCHANT_DICTIONARY'
  | 'COMMON_KEYWORD'
  | 'DEFAULT';

export type CandidateAlternative = {
  label: string;
  type?: TransactionType;
  categoryKey?: string;
  subcategoryKey?: string;
};

export interface ParsedTransactionCandidate {
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

  /** The exact user input is kept for local persistence after confirmation. */
  originalText: string;
  /** The normalized clause represented by this candidate. */
  sourceText: string;
  categoryAlternatives: CandidateAlternative[];
  confidenceLevel: ConfidenceLevel;

  /** Explains why the suggested type/category/account was selected. */
  suggestionSource: ClassificationSuggestionSource;
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
