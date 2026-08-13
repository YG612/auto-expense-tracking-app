import type { ParsedTransactionCandidate } from '../classification/types';
import {
  createRepositories,
  type DatabaseConnection,
  type Repositories,
} from '../database';
import type { TextTransactionReferenceData } from '../domain/services/textTransaction';
import {
  BookkeepingSessionStore,
  type SessionCandidate,
} from '../features/smart-entry/BookkeepingSession';
import {
  persistEditedSessionCandidate,
  persistRecognizedSessionCandidate,
  prepareSessionCandidateForEditing,
} from '../features/smart-entry/BookkeepingSessionPersistence';
import { openMigratedTestDatabase } from './database/testDatabase';

const candidate: ParsedTransactionCandidate = {
  type: 'EXPENSE',
  amountMinor: 2500,
  currency: 'CNY',
  occurredAt: '2026-08-08T04:00:00.000Z',
  categoryKey: 'expense.food',
  subcategoryKey: 'expense.food.lunch',
  accountKey: 'WECHAT',
  merchantRawName: '一鸣',
  tags: [],
  confidence: 0.96,
  missingFields: [],
  ambiguityReasons: [],
  originalText: '一鸣午饭花了25元，微信付的。',
  sourceText: '一鸣午饭花了25元，微信付的',
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

function currentCandidate(store: BookkeepingSessionStore): SessionCandidate {
  const value = store.getSnapshot().candidates[0];
  if (value === undefined) {
    throw new Error('Expected a session candidate.');
  }
  return value;
}

describe('bookkeeping review session lifecycle', () => {
  let database: DatabaseConnection;
  let repositories: Repositories;
  let references: TextTransactionReferenceData;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
    repositories = createRepositories(database);
    const [categories, accounts, projects, tags] = await Promise.all([
      repositories.categories.listVisible(),
      repositories.accounts.listVisible(),
      repositories.projects.listActive(),
      repositories.tags.listAll(),
    ]);
    references = { categories, accounts, projects, tags };
  });

  afterEach(() => database.close());

  it('direct confirmation persists CONFIRMED and removes the card', async () => {
    const store = createStore();
    const sessionId = store.start([candidate], 'TEXT', candidate.originalText);
    const item = currentCandidate(store);

    await expect(
      store.persistCandidate(sessionId, item.id, 'CONFIRMED', value =>
        persistRecognizedSessionCandidate(
          value,
          'CONFIRMED',
          references,
          repositories,
        ).then(() => undefined),
      ),
    ).resolves.toEqual({ status: 'SAVED', outcome: 'COMMITTED' });

    expect(store.getSnapshot()).toMatchObject({
      phase: 'COMPLETED',
      candidates: [],
      confirmedCount: 1,
      pendingCount: 0,
    });
    await expect(
      repositories.transactions.findById(item.transactionId),
    ).resolves.toMatchObject({
      confirmationStatus: 'CONFIRMED',
      sourceReferenceId: item.idempotencyKey,
    });
  });

  it('editing writes nothing until save, then atomically confirms and learns the diff', async () => {
    const store = createStore();
    const sessionId = store.start([candidate], 'TEXT', candidate.originalText);
    const item = currentCandidate(store);
    expect(store.beginEdit(sessionId, item.id)).toBe(true);
    await expect(repositories.transactions.countPending()).resolves.toBe(0);
    await expect(repositories.transactions.listAll()).resolves.toEqual([]);

    const prepared = prepareSessionCandidateForEditing(item, references);
    const result = await store.persistEditedCandidate(
      sessionId,
      item.id,
      value =>
        persistEditedSessionCandidate(
          value,
          {
            ...prepared.draft,
            subcategoryId: 'category-expense-food-dinner',
          },
          2500,
          references,
          repositories,
          '2026-08-08T04:02:00.000Z',
        ).then(() => undefined),
    );

    expect(result).toEqual({ status: 'SAVED', outcome: 'COMMITTED' });
    expect(store.getSnapshot().candidates).toEqual([]);
    await expect(repositories.transactions.countPending()).resolves.toBe(0);
    await expect(
      repositories.transactions.findById(item.transactionId),
    ).resolves.toMatchObject({
      confirmationStatus: 'CONFIRMED',
      subcategoryId: 'category-expense-food-dinner',
    });
    await expect(
      repositories.classificationFeedback.listForTransaction(
        item.transactionId,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: item.feedbackId,
        originalSubcategoryId: 'category-expense-food-lunch',
        correctedSubcategoryId: 'category-expense-food-dinner',
      }),
    ]);
  });

  it('cancelling editing restores the candidate without creating a ledger row', async () => {
    const store = createStore();
    const sessionId = store.start([candidate], 'TEXT', candidate.originalText);
    const item = currentCandidate(store);

    expect(store.beginEdit(sessionId, item.id)).toBe(true);
    store.cancelEdit(sessionId, item.id);

    expect(currentCandidate(store).reviewState).toBe('READY');
    await expect(repositories.transactions.listAll()).resolves.toEqual([]);
  });

  it('only explicit pending action persists PENDING and removes the card', async () => {
    const store = createStore();
    const sessionId = store.start(
      [candidate],
      'VOICE',
      candidate.originalText,
      store.getSnapshot().entryGeneration,
      'speech-result-pending',
    );
    const item = currentCandidate(store);

    await store.persistCandidate(sessionId, item.id, 'PENDING', value =>
      persistRecognizedSessionCandidate(
        value,
        'PENDING',
        references,
        repositories,
      ).then(() => undefined),
    );

    expect(store.getSnapshot()).toMatchObject({
      phase: 'COMPLETED',
      candidates: [],
      confirmedCount: 0,
      pendingCount: 1,
    });
    await expect(repositories.transactions.countPending()).resolves.toBe(1);
    await expect(
      repositories.transactions.findById(item.transactionId),
    ).resolves.toMatchObject({
      requiresReview: false,
      reviewReasonCodes: [],
    });
  });

  it('rejects direct confirmation for an uncertain candidate even when UI checks are bypassed', async () => {
    const uncertainCandidate: ParsedTransactionCandidate = {
      ...candidate,
      confidence: 0.82,
      confidenceLevel: 'MEDIUM',
      ambiguityReasons: ['分类存在多个可能'],
      categoryAlternatives: [{ label: '购物' }],
    };
    const store = createStore();
    const sessionId = store.start(
      [uncertainCandidate],
      'TEXT',
      uncertainCandidate.originalText,
    );
    const item = currentCandidate(store);

    await expect(
      store.persistCandidate(sessionId, item.id, 'CONFIRMED', value =>
        persistRecognizedSessionCandidate(
          value,
          'CONFIRMED',
          references,
          repositories,
        ).then(() => undefined),
      ),
    ).resolves.toEqual({
      status: 'FAILED',
      error:
        '识别结果存在不确定项，请检查并编辑后再确认。（错误码：SMART-ENTRY-REVIEW-REQUIRED）',
    });
    expect(currentCandidate(store).reviewState).toBe('READY');
    await expect(repositories.transactions.listAll()).resolves.toEqual([]);
  });

  it('persists uncertainty in pending and clears it only after explicit edited confirmation', async () => {
    const uncertainCandidate: ParsedTransactionCandidate = {
      ...candidate,
      confidence: 0.82,
      confidenceLevel: 'MEDIUM',
      ambiguityReasons: ['分类存在多个可能'],
      categoryAlternatives: [{ label: '购物' }],
    };
    const pendingStore = createStore();
    const pendingSessionId = pendingStore.start(
      [uncertainCandidate],
      'TEXT',
      uncertainCandidate.originalText,
    );
    const pendingItem = currentCandidate(pendingStore);
    await pendingStore.persistCandidate(
      pendingSessionId,
      pendingItem.id,
      'PENDING',
      value =>
        persistRecognizedSessionCandidate(
          value,
          'PENDING',
          references,
          repositories,
        ).then(() => undefined),
    );
    await expect(
      repositories.transactions.findById(pendingItem.transactionId),
    ).resolves.toMatchObject({
      confirmationStatus: 'PENDING',
      requiresReview: true,
      reviewReasonCodes: [
        'CONFIDENCE_NOT_HIGH',
        'AMBIGUOUS',
        'CATEGORY_ALTERNATIVES',
      ],
    });

    let editedSequence = 0;
    const editedStore = new BookkeepingSessionStore({
      createId: prefix => `edited-${prefix}-${++editedSequence}`,
      now: () => '2026-08-08T04:01:00.000Z',
    });
    const editedSessionId = editedStore.start(
      [uncertainCandidate],
      'TEXT',
      uncertainCandidate.originalText,
    );
    const editedItem = currentCandidate(editedStore);
    expect(editedStore.beginEdit(editedSessionId, editedItem.id)).toBe(true);
    const prepared = prepareSessionCandidateForEditing(editedItem, references);
    await editedStore.persistEditedCandidate(
      editedSessionId,
      editedItem.id,
      value =>
        persistEditedSessionCandidate(
          value,
          prepared.draft,
          2500,
          references,
          repositories,
          '2026-08-08T04:03:00.000Z',
        ).then(() => undefined),
    );
    await expect(
      repositories.transactions.findById(editedItem.transactionId),
    ).resolves.toMatchObject({
      confirmationStatus: 'CONFIRMED',
      requiresReview: false,
      reviewReasonCodes: [],
    });
  });

  it('keeps the candidate when persistence fails', async () => {
    const store = createStore();
    const sessionId = store.start([candidate], 'TEXT', candidate.originalText);
    const item = currentCandidate(store);

    await expect(
      store.persistCandidate(sessionId, item.id, 'CONFIRMED', async () => {
        throw new Error('disk full');
      }),
    ).resolves.toEqual({
      status: 'FAILED',
      error: '保存失败，请重试。（错误码：SESSION-SAVE-UNEXPECTED）',
    });

    expect(currentCandidate(store)).toMatchObject({
      id: item.id,
      reviewState: 'READY',
    });
    expect(store.getSnapshot().error).toBe(
      '保存失败，请重试。（错误码：SESSION-SAVE-UNEXPECTED）',
    );
    await expect(repositories.transactions.listAll()).resolves.toEqual([]);
  });

  it('uses the candidate idempotency key to reject a double save', async () => {
    const store = createStore();
    const sessionId = store.start([candidate], 'TEXT', candidate.originalText);
    const item = currentCandidate(store);
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const writer = jest.fn(async (value: SessionCandidate) => {
      await gate;
      await persistRecognizedSessionCandidate(
        value,
        'CONFIRMED',
        references,
        repositories,
      );
    });

    const first = store.persistCandidate(
      sessionId,
      item.id,
      'CONFIRMED',
      writer,
    );
    await expect(
      store.persistCandidate(sessionId, item.id, 'CONFIRMED', writer),
    ).resolves.toEqual({ status: 'IGNORED' });
    expect(writer).toHaveBeenCalledTimes(1);
    release?.();
    await expect(first).resolves.toEqual({
      status: 'SAVED',
      outcome: 'COMMITTED',
    });
    await expect(repositories.transactions.listAll()).resolves.toHaveLength(1);
  });

  it('does not replace the visible session while a ledger write is in flight', async () => {
    const store = createStore();
    const sessionId = store.start([candidate], 'TEXT', candidate.originalText);
    const item = currentCandidate(store);
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

    expect(() => store.start([candidate], 'TEXT', 'replacement')).toThrow(
      '上一笔候选仍在保存',
    );
    expect(() => store.clearReview()).toThrow('候选仍在保存');
    expect(() => store.discardReview()).toThrow('候选仍在保存');
    expect(store.getSnapshot().sessionId).toBe(sessionId);

    release?.();
    await expect(saving).resolves.toEqual({
      status: 'SAVED',
      outcome: 'COMMITTED',
    });
  });

  it('protects visible review and editing state from implicit replacement', () => {
    const store = createStore();
    const sessionId = store.start([candidate], 'TEXT', candidate.originalText);
    const item = currentCandidate(store);

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
    expect(() => store.start([candidate], 'TEXT', 'replacement')).not.toThrow();
  });

  it('restores an actionable card when the editor closes during a failed save', async () => {
    const store = createStore();
    const sessionId = store.start([candidate], 'TEXT', candidate.originalText);
    const item = currentCandidate(store);
    let reject: ((error: Error) => void) | undefined;
    const failedWrite = new Promise<void>((_, rejectPromise) => {
      reject = rejectPromise;
    });

    expect(store.beginEdit(sessionId, item.id)).toBe(true);
    const saving = store.persistEditedCandidate(
      sessionId,
      item.id,
      async () => failedWrite,
    );
    store.cancelEdit(sessionId, item.id);
    reject?.(new Error('write failed'));

    await expect(saving).resolves.toEqual({
      status: 'FAILED',
      error: '保存失败，请重试。（错误码：SESSION-SAVE-UNEXPECTED）',
    });
    expect(currentCandidate(store).reviewState).toBe('READY');
  });

  it('removes only the persisted item from a multi-candidate session', async () => {
    const store = createStore();
    const second = {
      ...candidate,
      amountMinor: 1800,
      originalText: '一鸣午饭25元，打车18元',
      sourceText: '打车18元',
      merchantRawName: undefined,
      categoryKey: 'expense.transport',
      subcategoryKey: 'expense.transport.taxi',
    };
    const sessionId = store.start(
      [candidate, second],
      'TEXT',
      second.originalText,
    );
    const [firstItem, secondItem] = store.getSnapshot().candidates;
    if (firstItem === undefined || secondItem === undefined) {
      throw new Error('Expected two session candidates.');
    }

    await store.persistCandidate(sessionId, firstItem.id, 'CONFIRMED', value =>
      persistRecognizedSessionCandidate(
        value,
        'CONFIRMED',
        references,
        repositories,
      ).then(() => undefined),
    );
    expect(store.getSnapshot().candidates.map(item => item.id)).toEqual([
      secondItem.id,
    ]);
    expect(store.getSnapshot().phase).toBe('REVIEWING');

    await store.persistCandidate(sessionId, secondItem.id, 'PENDING', value =>
      persistRecognizedSessionCandidate(
        value,
        'PENDING',
        references,
        repositories,
      ).then(() => undefined),
    );
    expect(store.getSnapshot()).toMatchObject({
      phase: 'COMPLETED',
      candidates: [],
      confirmedCount: 1,
      pendingCount: 1,
    });
  });
});
