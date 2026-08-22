import { transactionActionTokenSource } from './transactionActionLexicon';

const RELATIONAL_MARKER_PATTERN = /(?:给|向|替|帮|我|个人收款码|个人码)/u;
const MONEY_PATTERN =
  /(?:\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万亿]+)(?:元|块钱?|圆)/u;
const PERSONAL_MONEY_ACTION_PATTERN = new RegExp(
  transactionActionTokenSource([
    'PAY',
    'SEND_MONEY',
    'LEND',
    'BORROW',
    'REPAY',
  ]),
  'u',
);

/**
 * Conservative learning-safety signal, not a transaction parser. False
 * positives only suppress automatic merchant-rule learning; they never alter
 * a parsed transaction. Event parsing remains the responsibility of the fact
 * resolver.
 */
export function containsPersonalMoneyLanguage(
  value: string | undefined,
): boolean {
  if (value === undefined) return false;
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (/个人收款码|个人码/u.test(normalized)) return true;
  return (
    RELATIONAL_MARKER_PATTERN.test(normalized) &&
    MONEY_PATTERN.test(normalized) &&
    PERSONAL_MONEY_ACTION_PATTERN.test(normalized)
  );
}
