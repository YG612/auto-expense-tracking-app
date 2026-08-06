import { parseAmount } from './amountParser';

/**
 * Splits only when at least two clauses independently contain an amount.
 * Account/date-only fragments therefore stay shared context instead of
 * becoming bogus zero-amount transactions.
 */
export function splitTransactionSegments(normalizedText: string): string[] {
  const withoutThousandsSeparators = normalizedText.replace(
    /(?<=\d),(?=\d{3}(?:\D|$))/gu,
    '',
  );
  const chunks = withoutThousandsSeparators
    .replace(/(?:然后|接着|随后|后来)/gu, ',')
    .split(',')
    .map(value => value.trim().replace(/^[.]+|[.]+$/gu, ''))
    .filter(value => value.length > 0);

  if (chunks.length <= 1) {
    return chunks.length === 0 ? [] : chunks;
  }

  const amountChunks = chunks.filter(
    chunk => parseAmount(chunk).amountMinor !== undefined,
  );
  if (amountChunks.length < 2) {
    return [chunks.join(',')];
  }

  return amountChunks;
}
