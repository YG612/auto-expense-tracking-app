import {
  canConfirmWithIntent,
  confirmationIntentFor,
  reviewDisposition,
  reviewReasonCodes,
} from '../domain/services/reviewDisposition';

const safeCandidate = {
  type: 'EXPENSE' as const,
  amountMinor: 2500,
  currency: 'CNY',
  occurredAt: '2026-08-09T04:00:00.000Z',
  categoryKey: 'expense.food',
  accountKey: 'WECHAT',
  confidenceLevel: 'HIGH' as const,
  missingFields: [],
  ambiguityReasons: [],
  categoryAlternatives: [],
};

describe('smart-entry review disposition', () => {
  it('allows direct confirmation only for complete, unambiguous HIGH candidates', () => {
    expect(reviewDisposition(safeCandidate)).toBe('DIRECT_CONFIRM');
    expect(confirmationIntentFor(safeCandidate)).toBe('DIRECT_CONFIRM');
    expect(canConfirmWithIntent(safeCandidate, 'DIRECT_CONFIRM')).toBe(true);
  });

  it('allows one explicit reviewed confirmation for non-critical medium suggestions', () => {
    const mediumCandidate = {
      ...safeCandidate,
      confidenceLevel: 'MEDIUM' as const,
      categoryAlternatives: [{ label: '快餐' }],
    };

    expect(reviewDisposition(mediumCandidate)).toBe('REVIEW_CONFIRM');
    expect(confirmationIntentFor(mediumCandidate)).toBe(
      'USER_REVIEWED_CONFIRM',
    );
    expect(canConfirmWithIntent(mediumCandidate, 'DIRECT_CONFIRM')).toBe(false);
    expect(canConfirmWithIntent(mediumCandidate, 'USER_REVIEWED_CONFIRM')).toBe(
      true,
    );
    expect(reviewReasonCodes(mediumCandidate)).toEqual([
      'CONFIDENCE_NOT_HIGH',
      'CATEGORY_ALTERNATIVES',
    ]);
  });

  it('allows one explicit reviewed confirmation for complete account advisories', () => {
    const advisoryCandidate = {
      ...safeCandidate,
      advisoryReasons: ['账户按最近使用填为微信'],
    };

    expect(reviewDisposition(advisoryCandidate)).toBe('REVIEW_CONFIRM');
    expect(confirmationIntentFor(advisoryCandidate)).toBe(
      'USER_REVIEWED_CONFIRM',
    );
    expect(canConfirmWithIntent(advisoryCandidate, 'DIRECT_CONFIRM')).toBe(
      false,
    );
    expect(
      canConfirmWithIntent(advisoryCandidate, 'USER_REVIEWED_CONFIRM'),
    ).toBe(true);
    expect(reviewReasonCodes(advisoryCandidate)).toEqual(['AMBIGUOUS']);
  });

  it('does not trust a recent-account source when its display advisory is absent', () => {
    const recentFallbackCandidate = {
      ...safeCandidate,
      accountResolutionSource: 'RECENT_FALLBACK' as const,
    };

    expect(reviewDisposition(recentFallbackCandidate)).toBe('REVIEW_CONFIRM');
    expect(confirmationIntentFor(recentFallbackCandidate)).toBe(
      'USER_REVIEWED_CONFIRM',
    );
    expect(
      canConfirmWithIntent(recentFallbackCandidate, 'DIRECT_CONFIRM'),
    ).toBe(false);
  });

  it('keeps critical ambiguity and protected transaction semantics behind editing', () => {
    expect(
      reviewDisposition({
        ...safeCandidate,
        confidenceLevel: 'MEDIUM',
        ambiguityReasons: ['检测到多个金额，请确认'],
      }),
    ).toBe('EDIT_OR_PENDING');
    expect(
      reviewDisposition({ ...safeCandidate, ambiguityReasons: ['金额歧义'] }),
    ).toBe('EDIT_OR_PENDING');
    expect(
      reviewDisposition({
        ...safeCandidate,
        type: 'TRANSFER',
        categoryKey: undefined,
        targetAccountKey: 'ALIPAY',
      }),
    ).toBe('EDIT_OR_PENDING');
    expect(
      canConfirmWithIntent(
        { ...safeCandidate, ambiguityReasons: ['金额歧义'] },
        'USER_REVIEWED_CONFIRM',
      ),
    ).toBe(false);
  });

  it('requires editing when fields are missing and emits stable reason codes', () => {
    const candidate = {
      ...safeCandidate,
      confidenceLevel: 'LOW' as const,
      missingFields: ['账户'],
      ambiguityReasons: ['分类不确定'],
      categoryAlternatives: [{ label: '购物' }],
    };

    expect(reviewDisposition(candidate)).toBe('EDIT_ONLY');
    expect(reviewReasonCodes(candidate)).toEqual([
      'MISSING_FIELDS',
      'CONFIDENCE_NOT_HIGH',
      'AMBIGUOUS',
      'CATEGORY_ALTERNATIVES',
    ]);
  });

  it('does not trust incomplete structure even when parser metadata claims HIGH', () => {
    const missingAccount = { ...safeCandidate, accountKey: undefined };
    expect(reviewDisposition(missingAccount)).toBe('EDIT_ONLY');
    expect(reviewReasonCodes(missingAccount)).toContain('MISSING_FIELDS');
    expect(confirmationIntentFor(missingAccount)).toBeUndefined();

    const unsupportedCurrency = { ...safeCandidate, currency: 'USD' };
    expect(reviewDisposition(unsupportedCurrency)).toBe('EDIT_OR_PENDING');
    expect(reviewReasonCodes(unsupportedCurrency)).toContain('AMBIGUOUS');
  });
});
