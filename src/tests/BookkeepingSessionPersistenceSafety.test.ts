import type { ParsedTransactionCandidate } from '../classification/types';
import type { Repositories } from '../database';
import { ReviewRequiredError } from '../domain/services/reviewDisposition';
import type { TextTransactionReferenceData } from '../domain/services/textTransaction';
import type { SessionCandidate } from '../features/smart-entry/BookkeepingSession';
import { persistRecognizedSessionCandidate } from '../features/smart-entry/BookkeepingSessionPersistence';

const uncertainCandidate: ParsedTransactionCandidate = {
  type: 'EXPENSE',
  amountMinor: 2500,
  currency: 'CNY',
  occurredAt: '2026-08-08T04:00:00.000Z',
  categoryKey: 'expense.shopping',
  accountKey: 'WECHAT',
  tags: [],
  confidence: 0.82,
  missingFields: [],
  ambiguityReasons: ['分类存在多个可能'],
  originalText: '买东西25元',
  sourceText: '买东西25元',
  categoryAlternatives: [{ label: '餐饮' }, { label: '购物' }],
  confidenceLevel: 'MEDIUM',
  suggestionSource: 'DEFAULT',
};

const sessionCandidate: SessionCandidate = {
  id: 'candidate-1',
  sessionId: 'session-1',
  entryGeneration: 0,
  transactionId: 'transaction-1',
  feedbackId: 'feedback-1',
  learnedRuleId: 'rule-1',
  idempotencyKey: 'session-1:candidate-1',
  createdAt: '2026-08-08T04:01:00.000Z',
  candidate: uncertainCandidate,
  inputSource: 'TEXT',
  reviewState: 'READY',
};

const references: TextTransactionReferenceData = {
  categories: [
    {
      id: 'category-expense-shopping',
      type: 'EXPENSE',
      systemKey: 'expense.shopping',
      name: '购物',
      sortOrder: 1,
      isSystem: true,
      isHidden: false,
      createdAt: '2026-08-08T04:00:00.000Z',
      updatedAt: '2026-08-08T04:00:00.000Z',
    },
  ],
  accounts: [
    {
      id: 'account-wechat',
      name: '微信',
      type: 'WECHAT',
      currency: 'CNY',
      includeInNetWorth: true,
      sortOrder: 1,
      isHidden: false,
      createdAt: '2026-08-08T04:00:00.000Z',
      updatedAt: '2026-08-08T04:00:00.000Z',
    },
  ],
  projects: [],
  tags: [],
};

describe('recognized candidate persistence safety', () => {
  it('rejects uncertain direct confirmation before touching the repository', async () => {
    const findById = jest.fn();
    const repositories = {
      transactions: { findById, saveWithTags: jest.fn() },
    } as unknown as Repositories;

    await expect(
      persistRecognizedSessionCandidate(
        sessionCandidate,
        'CONFIRMED',
        references,
        repositories,
      ),
    ).rejects.toBeInstanceOf(ReviewRequiredError);
    expect(findById).not.toHaveBeenCalled();
  });

  it('also rejects a forged reviewed-confirm intent when critical ambiguity remains', async () => {
    const findById = jest.fn();
    const repositories = {
      transactions: { findById, saveWithTags: jest.fn() },
    } as unknown as Repositories;

    await expect(
      persistRecognizedSessionCandidate(
        sessionCandidate,
        'CONFIRMED',
        references,
        repositories,
        { confirmationIntent: 'USER_REVIEWED_CONFIRM' },
      ),
    ).rejects.toBeInstanceOf(ReviewRequiredError);
    expect(findById).not.toHaveBeenCalled();
  });

  it('accepts only an explicit reviewed-confirm intent for a complete non-critical medium suggestion', async () => {
    const reviewedCandidate: SessionCandidate = {
      ...sessionCandidate,
      candidate: {
        ...uncertainCandidate,
        ambiguityReasons: [],
        categoryAlternatives: [{ label: '日用购物' }],
      },
    };
    const saveWithTags = jest.fn(async transaction => transaction);
    const repositories = {
      transactions: {
        findById: jest.fn(async () => undefined),
        saveWithTags,
      },
    } as unknown as Repositories;

    await expect(
      persistRecognizedSessionCandidate(
        reviewedCandidate,
        'CONFIRMED',
        references,
        repositories,
      ),
    ).rejects.toBeInstanceOf(ReviewRequiredError);
    expect(saveWithTags).not.toHaveBeenCalled();

    await persistRecognizedSessionCandidate(
      reviewedCandidate,
      'CONFIRMED',
      references,
      repositories,
      {
        confirmationIntent: 'USER_REVIEWED_CONFIRM',
        updatedAt: '2026-08-08T04:02:00.000Z',
      },
    );

    expect(saveWithTags).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationStatus: 'CONFIRMED',
        requiresReview: false,
        reviewReasonCodes: [],
      }),
      [],
    );
  });

  it('requires an explicit reviewed intent for a complete recent-account advisory', async () => {
    const advisoryCandidate: SessionCandidate = {
      ...sessionCandidate,
      candidate: {
        ...uncertainCandidate,
        confidence: 0.95,
        confidenceLevel: 'HIGH',
        ambiguityReasons: [],
        advisoryReasons: ['账户按最近使用填为微信'],
        categoryAlternatives: [],
      },
    };
    const saveWithTags = jest.fn(async transaction => transaction);
    const findById = jest.fn(async () => undefined);
    const repositories = {
      transactions: { findById, saveWithTags },
    } as unknown as Repositories;

    await expect(
      persistRecognizedSessionCandidate(
        advisoryCandidate,
        'CONFIRMED',
        references,
        repositories,
        { confirmationIntent: 'DIRECT_CONFIRM' },
      ),
    ).rejects.toBeInstanceOf(ReviewRequiredError);
    expect(findById).not.toHaveBeenCalled();
    expect(saveWithTags).not.toHaveBeenCalled();

    await persistRecognizedSessionCandidate(
      advisoryCandidate,
      'CONFIRMED',
      references,
      repositories,
      {
        confirmationIntent: 'USER_REVIEWED_CONFIRM',
        updatedAt: '2026-08-08T04:02:00.000Z',
      },
    );

    expect(saveWithTags).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationStatus: 'CONFIRMED',
        requiresReview: false,
        reviewReasonCodes: [],
      }),
      [],
    );
  });

  it.each([
    ['missing', []],
    [
      'hidden',
      references.accounts.map(account => ({ ...account, isHidden: true })),
    ],
  ])(
    'fails closed before repository access when the hinted account is %s',
    async (_state, accounts) => {
      const staleAccountCandidate: SessionCandidate = {
        ...sessionCandidate,
        candidate: {
          ...uncertainCandidate,
          accountIdHint: 'account-wechat',
          confidence: 0.95,
          confidenceLevel: 'HIGH',
          ambiguityReasons: [],
          advisoryReasons: ['账户按最近使用填为微信'],
          categoryAlternatives: [],
        },
      };
      const findById = jest.fn();
      const repositories = {
        transactions: { findById, saveWithTags: jest.fn() },
      } as unknown as Repositories;

      await expect(
        persistRecognizedSessionCandidate(
          staleAccountCandidate,
          'CONFIRMED',
          { ...references, accounts },
          repositories,
          { confirmationIntent: 'USER_REVIEWED_CONFIRM' },
        ),
      ).rejects.toBeInstanceOf(ReviewRequiredError);
      expect(findById).not.toHaveBeenCalled();
    },
  );

  it('persists uncertainty metadata when explicitly deferred to pending', async () => {
    const saveWithTags = jest.fn(async transaction => transaction);
    const repositories = {
      transactions: {
        findById: jest.fn(async () => undefined),
        saveWithTags,
      },
    } as unknown as Repositories;

    await persistRecognizedSessionCandidate(
      sessionCandidate,
      'PENDING',
      references,
      repositories,
      '2026-08-08T04:02:00.000Z',
    );

    expect(saveWithTags).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationStatus: 'PENDING',
        requiresReview: true,
        reviewReasonCodes: [
          'CONFIDENCE_NOT_HIGH',
          'AMBIGUOUS',
          'CATEGORY_ALTERNATIVES',
        ],
      }),
      [],
    );
  });
});
