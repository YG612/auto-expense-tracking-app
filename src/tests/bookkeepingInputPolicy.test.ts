import {
  BookkeepingInputError,
  MAX_BOOKKEEPING_TEXT_CHARACTERS,
  assertBookkeepingTextWithinLimit,
  bookkeepingTextLength,
  isBookkeepingTextWithinLimit,
} from '../domain/policies/bookkeepingInputPolicy';

describe('bookkeeping input policy', () => {
  it('uses one Unicode-aware limit for every bookkeeping entry route', () => {
    const atLimit = '账'.repeat(MAX_BOOKKEEPING_TEXT_CHARACTERS);
    expect(isBookkeepingTextWithinLimit(atLimit)).toBe(true);
    expect(() => assertBookkeepingTextWithinLimit(atLimit)).not.toThrow();

    const overLimit = `${atLimit}账`;
    expect(isBookkeepingTextWithinLimit(overLimit)).toBe(false);
    expect(() => assertBookkeepingTextWithinLimit(overLimit)).toThrow(
      BookkeepingInputError,
    );
  });

  it('counts code points after NFKC normalization', () => {
    expect(bookkeepingTextLength('午饭🍜')).toBe(3);
    expect(bookkeepingTextLength('㍍')).toBe(4);
  });
});
