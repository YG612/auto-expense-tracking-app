import type { AccountType, TransactionType } from '../../domain/entities';
import type { CanonicalTransactionAction } from '../../language/transactionActionLexicon';
import type {
  FundSemantics,
  TransactionEventDirection,
} from '../parsers/transactionEventFacts';

export type TransactionFactStatus =
  'RESOLVED' | 'AMBIGUOUS' | 'ABSTAINED' | 'NO_MATCH';

export type { CanonicalTransactionAction } from '../../language/transactionActionLexicon';

export type TransactionFactSpan = Readonly<{
  start: number;
  end: number;
  text: string;
}>;

export type TransactionFactCertainty = 'EXPLICIT' | 'CONTEXTUAL';

export type TransactionFactEvidence<T> = Readonly<{
  value: T;
  span: TransactionFactSpan;
  ruleId: string;
  certainty: TransactionFactCertainty;
}>;

export type TransactionCounterpartyRole = 'PAYER' | 'PAYEE' | 'BENEFICIARY';

export type TransactionCounterpartyKind =
  'EXTERNAL_PARTY' | 'MERCHANT' | 'INSTITUTION' | 'PLATFORM';

export type TransactionCounterpartyFact = Readonly<{
  text: string;
  span: TransactionFactSpan;
  role: TransactionCounterpartyRole;
  kind: TransactionCounterpartyKind;
  ruleId: string;
  certainty: TransactionFactCertainty;
}>;

export type TransactionPurpose = 'RED_PACKET' | 'TUITION_FEE';

export type TransactionAccountRole = 'SOURCE' | 'TARGET';

export type TransactionAccountFact = Readonly<{
  accountType: AccountType;
  span: TransactionFactSpan;
  role: TransactionAccountRole;
  ruleId: string;
  certainty: TransactionFactCertainty;
}>;

export const TRANSACTION_FACT_CONFLICT_CODES = [
  'MULTIPLE_EVENT_FRAMES',
  'OVERLAPPING_CRITICAL_FACTS',
  'INVALID_COUNTERPARTY',
  'MERCHANT_PROJECTION_CONFLICT',
  'PARTICIPANT_DIRECTION_CONFLICT',
  'FUND_SEMANTICS_CONFLICT',
  'TRANSACTION_TYPE_CONFLICT',
  'ACCOUNT_PROJECTION_CONFLICT',
] as const;

export type TransactionFactConflictCode =
  (typeof TRANSACTION_FACT_CONFLICT_CODES)[number];

export type TransactionFactConflict = Readonly<{
  code: TransactionFactConflictCode;
  message: string;
  ruleIds: readonly string[];
}>;

export type MerchantCompatibilityProjection =
  'COUNTERPARTY' | 'SUPPRESS_LEGACY' | 'NONE';

/**
 * Auditable, event-local facts shared by amount, type, participant and
 * counterparty resolution. This structure is intentionally independent of
 * persistence so it can evolve without a database migration.
 */
export type TransactionFactResolution = Readonly<{
  rulesetVersion: string;
  status: TransactionFactStatus;
  action?: TransactionFactEvidence<CanonicalTransactionAction>;
  direction?: TransactionFactEvidence<
    Exclude<TransactionEventDirection, 'UNKNOWN'>
  >;
  fundSemantics?: TransactionFactEvidence<FundSemantics>;
  transactionType?: TransactionFactEvidence<TransactionType>;
  counterparty?: TransactionCounterpartyFact;
  purpose?: TransactionFactEvidence<TransactionPurpose>;
  sourceAccount?: TransactionAccountFact;
  targetAccount?: TransactionAccountFact;
  moneyRanges: readonly TransactionFactSpan[];
  evidence: readonly TransactionFactEvidence<unknown>[];
  conflicts: readonly TransactionFactConflict[];
  merchantProjection: MerchantCompatibilityProjection;
}>;
