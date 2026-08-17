import {
  createRepositories,
  LedgerValidationError,
  LedgerWriteConflictError,
  MAX_TRANSACTION_SEARCH_LENGTH,
  type DatabaseConnection,
} from '../../database';
import type {
  ClassificationFeedback,
  Transaction,
} from '../../domain/entities';
import { openMigratedTestDatabase } from './testDatabase';

const createdAt = '2026-08-08T08:00:00.000Z';

function validTransaction(
  id: string,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    revision: 1,
    type: 'EXPENSE',
    amountMinor: 1_200,
    currency: 'CNY',
    occurredAt: createdAt,
    categoryId: 'category-expense-food',
    subcategoryId: 'category-expense-food-lunch',
    accountId: 'account-wechat',
    source: 'MANUAL',
    confirmationStatus: 'CONFIRMED',
    duplicateStatus: 'NONE',
    createdAt,
    updatedAt: createdAt,
    syncStatus: 'LOCAL_ONLY',
    ...overrides,
  };
}

function correctionFeedback(
  id: string,
  transactionId: string,
  sourceText: string,
): ClassificationFeedback {
  return {
    id,
    transactionId,
    originalType: 'EXPENSE',
    correctedType: 'EXPENSE',
    originalCategoryId: 'category-expense-food',
    correctedCategoryId: 'category-expense-food',
    originalSubcategoryId: 'category-expense-food-lunch',
    correctedSubcategoryId: 'category-expense-food-breakfast',
    sourceText,
    merchantRawName: '测试商户',
    createdAt: '2026-08-08T08:01:00.000Z',
  };
}

describe('ledger write integrity boundary', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('uses revision CAS and never revives a deleted row from a stale screen', async () => {
    const repositories = createRepositories(database);
    const original = validTransaction('cas-transaction');
    await repositories.transactions.create(original);
    await expect(
      repositories.transactions.create({
        ...original,
        note: 'create must never overwrite',
      }),
    ).rejects.toBeInstanceOf(LedgerWriteConflictError);
    const firstSnapshot = await repositories.transactions.findById(original.id);
    const staleSnapshot = await repositories.transactions.findById(original.id);
    if (firstSnapshot === undefined || staleSnapshot === undefined) {
      throw new Error('Expected transaction snapshots.');
    }

    const saved = await repositories.transactions.saveWithTags(
      {
        ...firstSnapshot,
        note: 'first writer',
        updatedAt: '2026-08-08T08:02:00.000Z',
      },
      [],
    );
    expect(saved.revision).toBe(2);
    await expect(
      repositories.transactions.saveWithTags(
        {
          ...staleSnapshot,
          note: 'stale writer',
          updatedAt: '2026-08-08T08:03:00.000Z',
        },
        [],
      ),
    ).rejects.toBeInstanceOf(LedgerWriteConflictError);

    const deleted = await repositories.transactions.softDelete(
      { id: saved.id, revision: saved.revision },
      '2026-08-08T08:04:00.000Z',
    );
    expect(deleted.status).toBe('APPLIED');
    await expect(
      repositories.transactions.saveWithTags(
        {
          ...saved,
          note: 'attempted resurrection',
          updatedAt: '2026-08-08T08:05:00.000Z',
        },
        [],
      ),
    ).rejects.toBeInstanceOf(LedgerWriteConflictError);

    await expect(
      repositories.transactions.restore(
        { id: saved.id, revision: saved.revision },
        '2026-08-08T08:06:00.000Z',
      ),
    ).resolves.toEqual({ status: 'CONFLICT' });
    if (deleted.status !== 'APPLIED') {
      throw new Error('Expected delete to succeed.');
    }
    await expect(
      repositories.transactions.restore(
        { id: saved.id, revision: deleted.transaction.revision },
        '2026-08-08T08:06:00.000Z',
      ),
    ).resolves.toMatchObject({
      status: 'APPLIED',
      transaction: { revision: 4, note: 'first writer' },
    });
  });

  it('enforces money, category, account, transfer, tag, text, and time invariants', async () => {
    const repositories = createRepositories(database);

    await expect(
      repositories.transactions.create(
        validTransaction('zero-amount', { amountMinor: 0 }),
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      repositories.transactions.create(
        validTransaction('unsafe-amount', {
          amountMinor: Number.MAX_SAFE_INTEGER + 1,
        }),
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      repositories.transactions.create(
        validTransaction('wrong-direction', { type: 'INCOME' }),
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      repositories.transactions.create(
        validTransaction('same-transfer-account', {
          type: 'TRANSFER',
          categoryId: undefined,
          subcategoryId: undefined,
          targetAccountId: 'account-wechat',
        }),
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      repositories.transactions.create(
        validTransaction('missing-account', { accountId: undefined }),
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      repositories.transactions.saveWithTags(validTransaction('missing-tag'), [
        'tag-does-not-exist',
      ]),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      repositories.transactions.create(
        validTransaction('long-note', { note: 'x'.repeat(2_001) }),
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      repositories.transactions.create(
        validTransaction('long-original-text', {
          source: 'TEXT',
          originalText: '文'.repeat(501),
        }),
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      repositories.transactions.create(
        validTransaction('invalid-calendar-day', {
          occurredAt: '2026-02-31T08:00:00.000Z',
        }),
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      repositories.transactions.create(
        validTransaction('invalid-clock-hour', {
          occurredAt: '2026-08-08T25:00:00.000+08:00',
        }),
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);

    await repositories.transactions.create(
      validTransaction('canonical-time', {
        occurredAt: '2026-08-08T16:00:00.000+08:00',
      }),
    );
    await expect(
      repositories.transactions.findById('canonical-time'),
    ).resolves.toMatchObject({ occurredAt: '2026-08-08T08:00:00.000Z' });
  });

  it('refuses to confirm an incomplete pending transaction at the database boundary', async () => {
    const repositories = createRepositories(database);
    await repositories.transactions.create(
      validTransaction('incomplete-pending', {
        accountId: undefined,
        categoryId: undefined,
        subcategoryId: undefined,
        confirmationStatus: 'PENDING',
      }),
    );

    await expect(
      repositories.transactions.confirmPending(
        { id: 'incomplete-pending', revision: 1 },
        '2026-08-08T08:02:00.000Z',
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      repositories.transactions.findById('incomplete-pending'),
    ).resolves.toMatchObject({ confirmationStatus: 'PENDING', revision: 1 });
  });

  it('allows simplified confirmed income without a secondary category', async () => {
    const repositories = createRepositories(database);
    await expect(
      repositories.transactions.create(
        validTransaction('simplified-income', {
          type: 'INCOME',
          categoryId: undefined,
          subcategoryId: undefined,
        }),
      ),
    ).resolves.toBeUndefined();
    const stored =
      await repositories.transactions.findById('simplified-income');
    expect(stored).toMatchObject({
      id: 'simplified-income',
      type: 'INCOME',
    });
    expect(stored?.categoryId).toBeUndefined();
    expect(stored?.subcategoryId).toBeUndefined();
  });

  it('round-trips review metadata and excludes review-required rows from single and batch confirmation', async () => {
    const repositories = createRepositories(database);
    await repositories.transactions.create(
      validTransaction('review-required-pending', {
        confirmationStatus: 'PENDING',
        confidence: 0.82,
        requiresReview: true,
        reviewReasonCodes: ['CONFIDENCE_NOT_HIGH', 'AMBIGUOUS'],
      }),
    );

    await expect(
      repositories.transactions.findById('review-required-pending'),
    ).resolves.toMatchObject({
      requiresReview: true,
      reviewReasonCodes: ['CONFIDENCE_NOT_HIGH', 'AMBIGUOUS'],
    });
    await expect(
      repositories.transactions.listSummaries({
        confirmationStatus: 'PENDING',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'review-required-pending',
        requiresReview: true,
        reviewReasonCodes: ['CONFIDENCE_NOT_HIGH', 'AMBIGUOUS'],
      }),
    ]);

    await expect(
      repositories.transactions.confirmPending(
        { id: 'review-required-pending', revision: 1 },
        '2026-08-08T08:02:00.000Z',
      ),
    ).resolves.toEqual({ status: 'INVALID_STATE' });
    await expect(
      repositories.transactions.confirmPendingBatch(
        [{ id: 'review-required-pending', revision: 1 }],
        '2026-08-08T08:02:00.000Z',
      ),
    ).resolves.toEqual({
      confirmedIds: [],
      conflictedIds: [],
      invalidStateIds: ['review-required-pending'],
      missingIds: [],
    });
    await expect(
      repositories.transactions.findById('review-required-pending'),
    ).resolves.toMatchObject({
      revision: 1,
      confirmationStatus: 'PENDING',
      requiresReview: true,
    });
  });

  it('rejects inconsistent or invalid review metadata at the ledger boundary', async () => {
    const repositories = createRepositories(database);

    await expect(
      repositories.transactions.create(
        validTransaction('confirmed-review-required', {
          requiresReview: true,
          reviewReasonCodes: ['AMBIGUOUS'],
        }),
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      repositories.transactions.create(
        validTransaction('review-flag-without-reason', {
          confirmationStatus: 'PENDING',
          requiresReview: true,
          reviewReasonCodes: [],
        }),
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      repositories.transactions.create(
        validTransaction('duplicate-review-reason', {
          confirmationStatus: 'PENDING',
          requiresReview: true,
          reviewReasonCodes: ['AMBIGUOUS', 'AMBIGUOUS'],
        }),
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      repositories.transactions.create(
        validTransaction('unknown-review-reason', {
          confirmationStatus: 'PENDING',
          requiresReview: true,
          reviewReasonCodes: ['UNKNOWN'] as unknown as NonNullable<
            Transaction['reviewReasonCodes']
          >,
        }),
      ),
    ).rejects.toBeInstanceOf(LedgerValidationError);
  });

  it('enforces original-text retention on existing and future writes', async () => {
    const repositories = createRepositories(database);
    const first = validTransaction('private-text-1', {
      source: 'TEXT',
      originalText: '午饭 12 元',
    });
    await repositories.transactions.create(first);
    await repositories.classificationFeedback.recordCorrection(
      correctionFeedback('feedback-private-1', first.id, '午饭 12 元'),
    );

    await repositories.personalizationSettings.setRetainOriginalText(
      false,
      '2026-08-08T08:03:00.000Z',
    );
    await expect(
      repositories.personalizationSettings.get(),
    ).resolves.toMatchObject({
      retainOriginalText: false,
    });
    const scrubbedTransaction = await repositories.transactions.findById(
      first.id,
    );
    expect(scrubbedTransaction).toMatchObject({ revision: 2 });
    expect(scrubbedTransaction).not.toHaveProperty('originalText');
    await expect(
      repositories.classificationFeedback.findById('feedback-private-1'),
    ).resolves.toMatchObject({ sourceText: undefined });

    const second = validTransaction('private-text-2', {
      source: 'TEXT',
      originalText: '晚饭 20 元',
      createdAt: '2026-08-08T08:04:00.000Z',
      occurredAt: '2026-08-08T08:04:00.000Z',
      updatedAt: '2026-08-08T08:04:00.000Z',
    });
    await repositories.transactions.create(second);
    await repositories.classificationFeedback.recordCorrection(
      correctionFeedback('feedback-private-2', second.id, '晚饭 20 元'),
    );
    const privacyPreservingTransaction =
      await repositories.transactions.findById(second.id);
    expect(privacyPreservingTransaction).not.toHaveProperty('originalText');
    await expect(
      repositories.classificationFeedback.findById('feedback-private-2'),
    ).resolves.toMatchObject({ sourceText: undefined });
  });

  it('rejects oversized repository search input', async () => {
    const repositories = createRepositories(database);
    await expect(
      repositories.transactions.listSummaries({
        query: '搜'.repeat(MAX_TRANSACTION_SEARCH_LENGTH + 1),
      }),
    ).rejects.toBeInstanceOf(LedgerValidationError);
  });
});
