import type {
  ImportSource,
  TransactionSource,
  TransactionType,
} from '../domain/entities';

export const IMPORTER_SCHEMA_VERSION = 1 as const;

export type StatementImportSource = Extract<
  ImportSource,
  'WECHAT' | 'ALIPAY' | 'CSV'
>;

export type StatementTransactionSource = Extract<
  TransactionSource,
  'WECHAT_IMPORT' | 'ALIPAY_IMPORT' | 'CSV_IMPORT'
>;

export type StatementField =
  | 'occurredAt'
  | 'type'
  | 'amount'
  | 'merchant'
  | 'account'
  | 'sourceReferenceId'
  | 'note';

export type StatementColumnMapping = Partial<Record<StatementField, string>>;

export type NormalizedImportCandidateV1 = {
  schemaVersion: typeof IMPORTER_SCHEMA_VERSION;
  source: StatementImportSource;
  transactionSource: StatementTransactionSource;
  sourceRow: number;
  sourceReferenceId?: string;
  occurredAt: string;
  type: TransactionType;
  amountMinor: number;
  currency: 'CNY';
  merchantRawName?: string;
  merchantIdHint?: string;
  accountHint?: string;
  accountIdHint?: string;
  categoryIdHint?: string;
  subcategoryIdHint?: string;
  classificationSource?:
    'USER_RULE' | 'LEARNED_MERCHANT' | 'MERCHANT_DICTIONARY' | 'MERCHANT_NAME';
  note?: string;
  fingerprint: string;
};

export type StatementImportFailure = {
  sourceRow: number;
  message: string;
};

export type StatementImportPreview = {
  schemaVersion: typeof IMPORTER_SCHEMA_VERSION;
  source: StatementImportSource;
  fileName: string;
  rawContentHash: string;
  headers: readonly string[];
  mapping: StatementColumnMapping;
  candidates: readonly NormalizedImportCandidateV1[];
  failures: readonly StatementImportFailure[];
};
