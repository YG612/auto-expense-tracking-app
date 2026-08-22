import type { Transaction } from '../domain/entities';
import {
  buildReviewedTransaction,
  pendingDraftFromTransaction,
} from '../features/pending/pendingTransactionEditing';

const existing: Transaction = {
  id: 'pending-edit-1',
  revision: 3,
  type: 'EXPENSE',
  amountMinor: 1800,
  currency: 'CNY',
  occurredAt: '2026-08-19T08:00:00.000Z',
  categoryId: 'category-food',
  accountId: 'account-wechat',
  merchantRawName: '原商户',
  source: 'ANDROID_NOTIFICATION',
  confidence: 0.72,
  requiresReview: true,
  reviewReasonCodes: ['CONFIDENCE_NOT_HIGH'],
  confirmationStatus: 'PENDING',
  duplicateStatus: 'NONE',
  createdAt: '2026-08-19T08:00:00.000Z',
  updatedAt: '2026-08-19T08:00:00.000Z',
  syncStatus: 'LOCAL_ONLY',
};

describe('pending transaction inline editing', () => {
  it('keeps a reviewed draft pending when the user chooses only save', () => {
    const draft = {
      ...pendingDraftFromTransaction(existing, ['tag-dining']),
      amountText: '20.50',
      merchantName: '修改后商户',
    };
    const reviewed = buildReviewedTransaction(
      existing,
      draft,
      2050,
      '2026-08-19T08:05:00.000Z',
      false,
    );

    expect(reviewed).toMatchObject({
      id: existing.id,
      revision: existing.revision,
      amountMinor: 2050,
      merchantRawName: '修改后商户',
      confirmationStatus: 'PENDING',
      requiresReview: false,
      reviewReasonCodes: [],
      source: 'ANDROID_NOTIFICATION',
    });
  });

  it('builds a confirmed transaction from the same inline draft', () => {
    const draft = pendingDraftFromTransaction(existing, []);
    const reviewed = buildReviewedTransaction(
      existing,
      draft,
      existing.amountMinor,
      '2026-08-19T08:05:00.000Z',
      true,
    );

    expect(reviewed.confirmationStatus).toBe('CONFIRMED');
    expect(reviewed.requiresReview).toBe(false);
    expect(reviewed.reviewReasonCodes).toEqual([]);
  });
});
