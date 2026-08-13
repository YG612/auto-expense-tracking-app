export type SemanticConceptKind = 'VENUE' | 'ITEM' | 'SERVICE' | 'ACTIVITY';

export type SemanticEntityRole =
  | 'CONSUMPTION_VENUE'
  | 'PURCHASED_ITEM'
  | 'PAID_SERVICE'
  | 'CONSUMPTION_ACTIVITY';

export type SemanticProposalKind =
  'EXPLICIT_SERVICE' | 'EXPLICIT_ITEM' | 'EXPLICIT_ACTIVITY' | 'VENUE_DEFAULT';

export type SemanticRiskKind =
  | 'NON_EXPENSE_TRANSACTION'
  | 'REFUND_OR_REVERSAL'
  | 'DEPOSIT_OR_GUARANTEE'
  | 'STORED_VALUE_OR_TOP_UP'
  | 'TRANSFER_OR_ACCOUNT_MOVEMENT'
  | 'POSSIBLE_INCOME';

export type SemanticResolutionStatus =
  'RESOLVED' | 'AMBIGUOUS' | 'ABSTAINED' | 'NO_MATCH';

export type SemanticTransactionType =
  'EXPENSE' | 'INCOME' | 'TRANSFER' | 'REFUND' | 'REIMBURSEMENT' | 'LOAN';

export type SemanticConceptDefinition = Readonly<{
  id: string;
  label: string;
  kind: SemanticConceptKind;
  role: SemanticEntityRole;
  aliases: readonly RegExp[];
  requiredContextAny?: readonly RegExp[];
  excludedContextAny?: readonly RegExp[];
  categoryKey: string;
  subcategoryKey?: string;
  proposalKind: SemanticProposalKind;
  baseScore: number;
}>;

export type SemanticRiskDefinition = Readonly<{
  id: string;
  kind: Exclude<SemanticRiskKind, 'NON_EXPENSE_TRANSACTION'>;
  pattern: RegExp;
  reason: string;
}>;

export type SemanticEvidence = Readonly<{
  conceptId: string;
  conceptLabel: string;
  conceptKind: SemanticConceptKind;
  role: SemanticEntityRole;
  matchedText: string;
  start: number;
  end: number;
  categoryKey: string;
  subcategoryKey?: string;
  proposalKind: SemanticProposalKind;
  source: 'SEMANTIC_ONTOLOGY';
}>;

export type SuppressedSemanticEvidence = SemanticEvidence &
  Readonly<{
    suppressedBy: 'NEGATION';
  }>;

export type SemanticRiskSignal = Readonly<{
  ruleId: string;
  kind: SemanticRiskKind;
  matchedText?: string;
  reason: string;
}>;

export type SemanticCategoryProposal = Readonly<{
  categoryKey: string;
  subcategoryKey?: string;
  proposalKind: SemanticProposalKind;
  score: number;
  confidence: number;
  explicit: boolean;
  source: 'SEMANTIC_ONTOLOGY';
  evidence: readonly SemanticEvidence[];
}>;

export type SemanticCategoryProposalCollection = Readonly<{
  normalizedText: string;
  proposals: readonly SemanticCategoryProposal[];
  suppressedEvidence: readonly SuppressedSemanticEvidence[];
  riskSignals: readonly SemanticRiskSignal[];
}>;

export type SemanticCategoryAlternative = Readonly<{
  categoryKey: string;
  subcategoryKey?: string;
  score: number;
  confidence: number;
  evidence: readonly SemanticEvidence[];
}>;

export type SemanticCategoryResolution = Readonly<{
  status: SemanticResolutionStatus;
  categoryKey?: string;
  subcategoryKey?: string;
  explicit: boolean;
  confidence: number;
  source?: 'SEMANTIC_ONTOLOGY';
  proposal?: SemanticCategoryProposal;
  alternatives: readonly SemanticCategoryAlternative[];
  evidence: readonly SemanticEvidence[];
  suppressedEvidence: readonly SuppressedSemanticEvidence[];
  riskSignals: readonly SemanticRiskSignal[];
  ambiguityReasons: readonly string[];
}>;

export type SemanticCategoryResolveOptions = Readonly<{
  transactionType?: SemanticTransactionType;
  ontology?: readonly SemanticConceptDefinition[];
  riskDefinitions?: readonly SemanticRiskDefinition[];
}>;
