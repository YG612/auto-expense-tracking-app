import type { ParsedTransactionCandidate } from '../classification/types';
import { BookkeepingSessionStore } from '../features/smart-entry/BookkeepingSession';

const candidate: ParsedTransactionCandidate = {
  type: 'EXPENSE',
  amountMinor: 2500,
  currency: 'CNY',
  occurredAt: '2026-08-08T04:00:00.000Z',
  categoryKey: 'expense.food',
  subcategoryKey: 'expense.food.lunch',
  accountKey: 'WECHAT',
  tags: [],
  confidence: 0.96,
  missingFields: [],
  ambiguityReasons: [],
  originalText: '午饭25元，微信付的。',
  sourceText: '午饭25元，微信付的',
  categoryAlternatives: [],
  confidenceLevel: 'HIGH',
  suggestionSource: 'COMMON_KEYWORD',
};

function createStore(): BookkeepingSessionStore {
  let sequence = 0;
  return new BookkeepingSessionStore({
    createId: prefix => `${prefix}-${++sequence}`,
    now: () => '2026-08-08T04:01:00.000Z',
  });
}

describe('bookkeeping session replacement safety', () => {
  it('rejects a stale producer and gives voice candidates stable origins', () => {
    const store = createStore();
    const staleGeneration = store.getSnapshot().entryGeneration;
    store.advanceEntryGeneration();

    expect(() =>
      store.start(
        [candidate],
        'VOICE',
        candidate.originalText,
        staleGeneration,
        'result-old',
      ),
    ).toThrow('stale');

    const currentGeneration = store.getSnapshot().entryGeneration;
    store.start(
      [candidate, candidate],
      'VOICE',
      candidate.originalText,
      currentGeneration,
      'result-current',
    );
    expect(store.getSnapshot().candidates).toMatchObject([
      {
        entryGeneration: currentGeneration,
        originKey: 'speech:result-current:0',
      },
      {
        entryGeneration: currentGeneration,
        originKey: 'speech:result-current:1',
      },
    ]);
  });

  it('advances the producer barrier without discarding a review', () => {
    const store = createStore();
    const sessionId = store.start([candidate], 'TEXT', candidate.originalText);
    const candidateId = store.getSnapshot().candidates[0]?.id;
    if (candidateId === undefined) {
      throw new Error('Expected a session candidate.');
    }
    expect(store.beginEdit(sessionId, candidateId)).toBe(true);

    const nextGeneration = store.advanceEntryGeneration();

    expect(store.getSnapshot()).toMatchObject({
      phase: 'REVIEWING',
      sessionId,
      entryGeneration: nextGeneration,
    });
    expect(store.getSnapshot().candidates).toHaveLength(1);
    expect(store.getCandidate(sessionId, candidateId)?.reviewState).toBe(
      'EDITING',
    );
  });

  it('propagates an already-committed outcome without treating it as new', async () => {
    const store = createStore();
    const sessionId = store.start([candidate], 'TEXT', candidate.originalText);
    const item = store.getSnapshot().candidates[0];
    if (item === undefined) {
      throw new Error('Expected a session candidate.');
    }

    await expect(
      store.persistCandidate(sessionId, item.id, 'CONFIRMED', async () =>
        Promise.resolve('ALREADY_COMMITTED'),
      ),
    ).resolves.toEqual({
      status: 'SAVED',
      outcome: 'ALREADY_COMMITTED',
    });
  });

  it('requires explicit discard for reviewing and editing sessions', () => {
    const store = createStore();
    const sessionId = store.start([candidate], 'TEXT', candidate.originalText);
    const item = store.getSnapshot().candidates[0];
    if (item === undefined) {
      throw new Error('Expected a session candidate.');
    }

    expect(() => store.start([candidate], 'TEXT', 'replacement')).toThrow(
      '当前仍有未处理的候选',
    );
    expect(() => store.clearReview()).toThrow('明确放弃');
    expect(store.beginEdit(sessionId, item.id)).toBe(true);
    expect(() => store.start([candidate], 'TEXT', 'replacement')).toThrow(
      '当前仍有未处理的候选',
    );

    store.discardReview();
    expect(store.getSnapshot()).toMatchObject({
      phase: 'IDLE',
      candidates: [],
    });
  });

  it('never discards a saving candidate and removes it only after success', async () => {
    const store = createStore();
    const sessionId = store.start([candidate], 'TEXT', candidate.originalText);
    const item = store.getSnapshot().candidates[0];
    if (item === undefined) {
      throw new Error('Expected a session candidate.');
    }
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });

    const saving = store.persistCandidate(
      sessionId,
      item.id,
      'CONFIRMED',
      async () => gate,
    );
    expect(store.getSnapshot().candidates[0]?.reviewState).toBe('SAVING');
    expect(() => store.discardReview()).toThrow('候选仍在保存');
    expect(store.getSnapshot().candidates).toHaveLength(1);

    release?.();
    await expect(saving).resolves.toEqual({
      status: 'SAVED',
      outcome: 'COMMITTED',
    });
    expect(store.getSnapshot()).toMatchObject({
      phase: 'COMPLETED',
      candidates: [],
      confirmedCount: 1,
    });
    expect(store.getSnapshot().sessionId).toBeUndefined();
    expect(store.getSnapshot().sourceText).toBeUndefined();
  });
});
