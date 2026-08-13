import { AppError } from '../errors/AppError';

export const MAX_BOOKKEEPING_TEXT_CHARACTERS = 500;

export class BookkeepingInputError extends AppError {
  constructor(readonly actualCharacters: number) {
    super('INPUT-TEXT-TOO-LONG', `记账文本不能超过 500 个字符。`, {
      category: 'VALIDATION',
      retryable: true,
    });
    this.name = 'BookkeepingInputError';
  }
}

/**
 * Counts Unicode code points after compatibility normalization. This keeps a
 * full-width or compatibility form from bypassing the same limit while not
 * splitting surrogate pairs such as emoji.
 */
export function bookkeepingTextLength(value: string): number {
  return Array.from(value.normalize('NFKC')).length;
}

export function isBookkeepingTextWithinLimit(value: string): boolean {
  return bookkeepingTextLength(value) <= MAX_BOOKKEEPING_TEXT_CHARACTERS;
}

export function assertBookkeepingTextWithinLimit(value: string): void {
  const length = bookkeepingTextLength(value);
  if (length > MAX_BOOKKEEPING_TEXT_CHARACTERS) {
    throw new BookkeepingInputError(length);
  }
}
