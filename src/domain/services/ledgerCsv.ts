import type { TransactionExportRow } from '../../database';

const UTF8_BOM = '\uFEFF';
const FORMULA_PREFIX = /^\s*[=+\-@]/u;

export const LEDGER_CSV_HEADERS = [
  'transaction_id',
  'occurred_at',
  'type',
  'amount_minor',
  'amount',
  'currency',
  'category',
  'subcategory',
  'account',
  'target_account',
  'merchant',
  'project',
  'tags',
  'note',
  'source',
  'source_reference_id',
  'original_text',
  'confidence',
  'confirmation_status',
  'duplicate_status',
  'deleted_at',
  'created_at',
  'updated_at',
] as const;

export type LedgerCsvOptions = {
  includeBom?: boolean;
};

export function formatMinorUnits(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error('CSV amount must be a non-negative safe integer.');
  }

  const whole = Math.floor(amountMinor / 100);
  const minor = String(amountMinor % 100).padStart(2, '0');
  return `${whole}.${minor}`;
}

function protectSpreadsheetCell(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function encodeCsvCell(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  const protectedText = protectSpreadsheetCell(text);
  return `"${protectedText.replaceAll('"', '""')}"`;
}

function rowValues(
  row: TransactionExportRow,
): Array<string | number | undefined> {
  return [
    row.id,
    row.occurredAt,
    row.type,
    row.amountMinor,
    formatMinorUnits(row.amountMinor),
    row.currency,
    row.category,
    row.subcategory,
    row.account,
    row.targetAccount,
    row.merchant,
    row.project,
    row.tags,
    row.note,
    row.source,
    row.sourceReferenceId,
    row.originalText,
    row.confidence,
    row.confirmationStatus,
    row.duplicateStatus,
    row.deletedAt,
    row.createdAt,
    row.updatedAt,
  ];
}

export function createLedgerCsv(
  rows: readonly TransactionExportRow[],
  options: LedgerCsvOptions = {},
): string {
  const lines = [
    LEDGER_CSV_HEADERS.map(encodeCsvCell).join(','),
    ...rows.map(row => rowValues(row).map(encodeCsvCell).join(',')),
  ];
  const content = `${lines.join('\r\n')}\r\n`;
  return options.includeBom === false ? content : `${UTF8_BOM}${content}`;
}
