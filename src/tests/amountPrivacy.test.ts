import {
  formatPrivateAmount,
  HIDDEN_AMOUNT_TEXT,
} from '../domain/services/amountPrivacy';

describe('amount privacy presentation', () => {
  it('replaces both positive and negative monetary values with one neutral token', () => {
    expect(formatPrivateAmount(12_345, true)).toBe(HIDDEN_AMOUNT_TEXT);
    expect(formatPrivateAmount(-12_345, true)).toBe(HIDDEN_AMOUNT_TEXT);
  });

  it('uses the canonical minor-unit formatter when values are visible', () => {
    expect(formatPrivateAmount(12_345, false)).toBe('¥123.45');
    expect(formatPrivateAmount(-12_345, false)).toBe('-¥123.45');
  });
});
