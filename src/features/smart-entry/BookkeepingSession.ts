import { useSyncExternalStore } from 'react';

import type { ParsedTransactionCandidate } from '../../classification/types';
import type { ConfirmationStatus } from '../../domain/entities';
import { safeErrorMessage } from '../../domain/errors/AppError';
import type { VoiceTranscriptCorrectionEdit } from '../../speech/voiceTranscriptCorrection';
import { createId as createAppId } from '../../utils/createId';

export type SmartEntryInputSource = 'TEXT' | 'VOICE';

export type CandidateReviewState = 'READY' | 'SAVING' | 'EDITING';

export type SessionCandidate = {
  id: string;
  sessionId: string;
  entryGeneration: number;
  originKey?: string;
  transactionId: string;
  feedbackId: string;
  learnedRuleId: string;
  idempotencyKey: string;
  createdAt: string;
  candidate: ParsedTransactionCandidate;
  inputSource: SmartEntryInputSource;
  reviewState: CandidateReviewState;
};

export type SessionCompletion = {
  id: string;
  confirmedCount: number;
  pendingCount: number;
  message: string;
};

export type BookkeepingSessionSourceAudit = {
  rawText: string;
  effectiveText: string;
  corrections: readonly VoiceTranscriptCorrectionEdit[];
  rulesetVersion: number;
};

export type BookkeepingSessionSnapshot = {
  phase: 'IDLE' | 'REVIEWING' | 'COMPLETED';
  entryGeneration: number;
  sessionId?: string;
  originToken?: string;
  sourceText?: string;
  sourceAudit?: BookkeepingSessionSourceAudit;
  candidates: readonly SessionCandidate[];
  confirmedCount: number;
  pendingCount: number;
  error?: string;
  completion?: SessionCompletion;
};

export type PersistenceResult =
  | { status: 'SAVED'; outcome: PersistenceCommitOutcome }
  | { status: 'FAILED'; error: string }
  | { status: 'IGNORED' };

export type PersistenceCommitOutcome = 'COMMITTED' | 'ALREADY_COMMITTED';

type PersistenceAction = {
  id: string;
  candidateId: string;
  sessionId: string;
  restoreState: Extract<CandidateReviewState, 'READY' | 'EDITING'>;
};

type SessionOptions = {
  createId?: (prefix: string) => string;
  now?: () => string;
};

type Listener = () => void;

function createIdleSnapshot(entryGeneration = 0): BookkeepingSessionSnapshot {
  return {
    phase: 'IDLE',
    entryGeneration,
    candidates: [],
    confirmedCount: 0,
    pendingCount: 0,
  };
}

function errorMessage(error: unknown): string {
  return safeErrorMessage(
    error,
    '保存失败，请重试。',
    'SESSION-SAVE-UNEXPECTED',
  );
}

function completionMessage(confirmedCount: number, pendingCount: number) {
  if (confirmedCount > 0 && pendingCount > 0) {
    return `已完成：${confirmedCount} 笔确认入账，${pendingCount} 笔存入待处理。`;
  }
  if (confirmedCount > 0) {
    return `已确认入账 ${confirmedCount} 笔。`;
  }
  return `已将 ${pendingCount} 笔存入待处理。`;
}

/**
 * Owns only the transient review session. Ledger confirmation state lives in
 * persisted Transaction rows and is never mirrored onto a saved card.
 */
export class BookkeepingSessionStore {
  private snapshot: BookkeepingSessionSnapshot = createIdleSnapshot();
  private readonly listeners = new Set<Listener>();
  private readonly inFlight = new Map<string, PersistenceAction>();
  private readonly createId: (prefix: string) => string;
  private readonly now: () => string;

  constructor(options: SessionOptions = {}) {
    this.createId = options.createId ?? createAppId;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  getSnapshot = (): BookkeepingSessionSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  isEntryGenerationCurrent(entryGeneration: number): boolean {
    return this.snapshot.entryGeneration === entryGeneration;
  }

  /**
   * Invalidates every producer that captured the previous entry generation.
   * Existing review candidates deliberately remain available so navigating to
   * the manual editor cannot silently discard them.
   */
  advanceEntryGeneration(): number {
    const entryGeneration = this.snapshot.entryGeneration + 1;
    this.publish({ ...this.snapshot, entryGeneration });
    return entryGeneration;
  }

  start(
    candidates: readonly ParsedTransactionCandidate[],
    inputSource: SmartEntryInputSource,
    sourceText: string,
    expectedGeneration = this.snapshot.entryGeneration,
    originToken?: string,
    sourceAudit?: BookkeepingSessionSourceAudit,
  ): string {
    if (!this.isEntryGenerationCurrent(expectedGeneration)) {
      throw new Error('The entry result is stale and can no longer be used.');
    }
    const normalizedOriginToken = originToken?.trim();
    if (inputSource === 'VOICE' && !normalizedOriginToken) {
      throw new Error('A voice result token is required to start a session.');
    }
    if (inputSource === 'TEXT' && normalizedOriginToken !== undefined) {
      throw new Error('Text entries cannot carry a voice result token.');
    }
    if (inputSource === 'TEXT' && sourceAudit !== undefined) {
      throw new Error('Text entries cannot carry a voice source audit.');
    }
    if (
      sourceAudit !== undefined &&
      (sourceAudit.rawText.trim().length === 0 ||
        sourceAudit.effectiveText.trim().length === 0 ||
        sourceAudit.effectiveText.trim() !== sourceText.trim())
    ) {
      throw new Error('Voice source audit does not match the parsed text.');
    }
    if (this.inFlight.size > 0) {
      throw new Error('上一笔候选仍在保存，请等待完成后再重新解析。');
    }
    if (this.snapshot.phase === 'REVIEWING') {
      throw new Error(
        '当前仍有未处理的候选，请先完成处理或明确放弃后再重新解析。',
      );
    }
    const sessionId = this.createId('bookkeeping-session');
    const createdAt = this.now();
    const sessionCandidates = candidates.map((candidate, candidateIndex) => {
      const candidateId = this.createId('candidate');
      return {
        id: candidateId,
        sessionId,
        entryGeneration: expectedGeneration,
        originKey:
          inputSource === 'VOICE'
            ? `speech:${normalizedOriginToken}:${candidateIndex}`
            : undefined,
        transactionId: this.createId('transaction'),
        feedbackId: this.createId('feedback'),
        learnedRuleId: this.createId('rule'),
        idempotencyKey: `${sessionId}:${candidateId}`,
        createdAt,
        candidate:
          sourceAudit === undefined
            ? candidate
            : { ...candidate, originalText: sourceAudit.rawText },
        inputSource,
        reviewState: 'READY' as const,
      };
    });

    this.inFlight.clear();
    this.publish({
      phase: sessionCandidates.length === 0 ? 'IDLE' : 'REVIEWING',
      entryGeneration: expectedGeneration,
      sessionId: sessionCandidates.length === 0 ? undefined : sessionId,
      originToken:
        sessionCandidates.length === 0 ? undefined : normalizedOriginToken,
      sourceText: sessionCandidates.length === 0 ? undefined : sourceText,
      sourceAudit: sessionCandidates.length === 0 ? undefined : sourceAudit,
      candidates: sessionCandidates,
      confirmedCount: 0,
      pendingCount: 0,
    });
    return sessionId;
  }

  restoreRawVoiceTranscript(
    candidates: readonly ParsedTransactionCandidate[],
    expectedSessionId: string,
    expectedGeneration: number,
  ): boolean {
    const current = this.snapshot;
    const audit = current.sourceAudit;
    if (
      current.phase !== 'REVIEWING' ||
      current.sessionId !== expectedSessionId ||
      current.entryGeneration !== expectedGeneration ||
      current.confirmedCount !== 0 ||
      current.pendingCount !== 0 ||
      this.inFlight.size > 0 ||
      current.originToken === undefined ||
      audit === undefined ||
      audit.corrections.length === 0 ||
      candidates.length === 0 ||
      current.candidates.some(candidate => candidate.inputSource !== 'VOICE')
    ) {
      return false;
    }

    const createdAt = this.now();
    const restoredCandidates = candidates.map((candidate, candidateIndex) => {
      const candidateId = this.createId('candidate');
      return {
        id: candidateId,
        sessionId: expectedSessionId,
        entryGeneration: expectedGeneration,
        originKey: `speech:${current.originToken}:${candidateIndex}`,
        transactionId: this.createId('transaction'),
        feedbackId: this.createId('feedback'),
        learnedRuleId: this.createId('rule'),
        idempotencyKey: `${expectedSessionId}:${candidateId}`,
        createdAt,
        candidate: { ...candidate, originalText: audit.rawText },
        inputSource: 'VOICE' as const,
        reviewState: 'READY' as const,
      };
    });
    this.publish({
      ...current,
      sourceText: audit.rawText,
      sourceAudit: {
        ...audit,
        effectiveText: audit.rawText,
        corrections: [],
      },
      candidates: restoredCandidates,
      error: undefined,
    });
    return true;
  }

  clearReview(): void {
    if (this.inFlight.size > 0) {
      throw new Error('候选仍在保存，暂时不能清空本次识别。');
    }
    if (this.snapshot.phase === 'REVIEWING') {
      throw new Error('当前仍有未处理的候选，请使用明确放弃操作清空本次识别。');
    }
    this.inFlight.clear();
    this.publish(createIdleSnapshot(this.snapshot.entryGeneration));
  }

  /**
   * Explicitly abandons a review session. A database write cannot be safely
   * cancelled, so SAVING remains protected even from an explicit discard.
   */
  discardReview(): void {
    if (this.inFlight.size > 0) {
      throw new Error('候选仍在保存，暂时不能放弃本次识别。');
    }
    this.inFlight.clear();
    this.publish(createIdleSnapshot(this.snapshot.entryGeneration));
  }

  /** Rolls back only the exact session installed by a producer that lost CAS. */
  discardReviewIfOwned(sessionId: string, entryGeneration: number): boolean {
    if (
      this.inFlight.size > 0 ||
      this.snapshot.phase !== 'REVIEWING' ||
      this.snapshot.sessionId !== sessionId ||
      this.snapshot.entryGeneration !== entryGeneration
    ) {
      return false;
    }
    this.publish(createIdleSnapshot(this.snapshot.entryGeneration));
    return true;
  }

  dismissCompletion(completionId: string): void {
    if (this.snapshot.completion?.id !== completionId) {
      return;
    }
    this.publish(createIdleSnapshot(this.snapshot.entryGeneration));
  }

  getCandidate(
    sessionId: string,
    candidateId: string,
  ): SessionCandidate | undefined {
    if (this.snapshot.sessionId !== sessionId) {
      return undefined;
    }
    return this.snapshot.candidates.find(item => item.id === candidateId);
  }

  beginEdit(sessionId: string, candidateId: string): boolean {
    const candidate = this.getCandidate(sessionId, candidateId);
    if (candidate === undefined || candidate.reviewState !== 'READY') {
      return false;
    }
    this.updateCandidate(sessionId, candidateId, {
      reviewState: 'EDITING',
    });
    return true;
  }

  cancelEdit(sessionId: string, candidateId: string): void {
    const candidate = this.getCandidate(sessionId, candidateId);
    if (candidate === undefined) {
      return;
    }
    if (candidate.reviewState === 'EDITING') {
      this.updateCandidate(sessionId, candidateId, { reviewState: 'READY' });
      return;
    }
    if (candidate.reviewState === 'SAVING') {
      const action = this.inFlight.get(candidate.idempotencyKey);
      if (action?.restoreState === 'EDITING') {
        // The database operation cannot be interrupted safely. If it fails
        // after the editor has already closed, restore an actionable card
        // instead of leaving the candidate permanently stuck in EDITING.
        action.restoreState = 'READY';
      }
    }
  }

  persistCandidate(
    sessionId: string,
    candidateId: string,
    confirmationStatus: Extract<ConfirmationStatus, 'CONFIRMED' | 'PENDING'>,
    persist: (
      candidate: SessionCandidate,
    ) => Promise<PersistenceCommitOutcome | void>,
  ): Promise<PersistenceResult> {
    return this.persist(
      sessionId,
      candidateId,
      'READY',
      confirmationStatus,
      persist,
    );
  }

  persistEditedCandidate(
    sessionId: string,
    candidateId: string,
    persist: (
      candidate: SessionCandidate,
    ) => Promise<PersistenceCommitOutcome | void>,
  ): Promise<PersistenceResult> {
    return this.persist(
      sessionId,
      candidateId,
      'EDITING',
      'CONFIRMED',
      persist,
    );
  }

  private async persist(
    sessionId: string,
    candidateId: string,
    expectedState: Extract<CandidateReviewState, 'READY' | 'EDITING'>,
    confirmationStatus: Extract<ConfirmationStatus, 'CONFIRMED' | 'PENDING'>,
    persist: (
      candidate: SessionCandidate,
    ) => Promise<PersistenceCommitOutcome | void>,
  ): Promise<PersistenceResult> {
    const candidate = this.getCandidate(sessionId, candidateId);
    if (
      candidate === undefined ||
      candidate.reviewState !== expectedState ||
      this.inFlight.has(candidate.idempotencyKey)
    ) {
      return { status: 'IGNORED' };
    }

    const action: PersistenceAction = {
      id: this.createId('candidate-action'),
      candidateId,
      sessionId,
      restoreState: expectedState,
    };
    this.inFlight.set(candidate.idempotencyKey, action);
    this.updateCandidate(sessionId, candidateId, { reviewState: 'SAVING' });

    let persistenceOutcome: PersistenceCommitOutcome | void;
    try {
      persistenceOutcome = await persist(candidate);
    } catch (error) {
      if (this.isCurrentAction(candidate.idempotencyKey, action)) {
        this.inFlight.delete(candidate.idempotencyKey);
        this.updateCandidate(
          sessionId,
          candidateId,
          { reviewState: action.restoreState },
          errorMessage(error),
        );
      }
      return { status: 'FAILED', error: errorMessage(error) };
    }

    if (!this.isCurrentAction(candidate.idempotencyKey, action)) {
      return { status: 'IGNORED' };
    }

    this.inFlight.delete(candidate.idempotencyKey);
    this.removePersistedCandidate(sessionId, candidateId, confirmationStatus);
    return {
      status: 'SAVED',
      outcome: persistenceOutcome ?? 'COMMITTED',
    };
  }

  private isCurrentAction(
    idempotencyKey: string,
    action: PersistenceAction,
  ): boolean {
    return this.inFlight.get(idempotencyKey)?.id === action.id;
  }

  private updateCandidate(
    sessionId: string,
    candidateId: string,
    update: Pick<SessionCandidate, 'reviewState'>,
    error?: string,
  ): void {
    if (this.snapshot.sessionId !== sessionId) {
      return;
    }
    this.publish({
      ...this.snapshot,
      candidates: this.snapshot.candidates.map(candidate =>
        candidate.id === candidateId ? { ...candidate, ...update } : candidate,
      ),
      error,
    });
  }

  private removePersistedCandidate(
    sessionId: string,
    candidateId: string,
    confirmationStatus: Extract<ConfirmationStatus, 'CONFIRMED' | 'PENDING'>,
  ): void {
    if (this.snapshot.sessionId !== sessionId) {
      return;
    }
    const candidates = this.snapshot.candidates.filter(
      candidate => candidate.id !== candidateId,
    );
    const confirmedCount =
      this.snapshot.confirmedCount +
      (confirmationStatus === 'CONFIRMED' ? 1 : 0);
    const pendingCount =
      this.snapshot.pendingCount + (confirmationStatus === 'PENDING' ? 1 : 0);

    if (candidates.length > 0) {
      this.publish({
        ...this.snapshot,
        phase: 'REVIEWING',
        candidates,
        confirmedCount,
        pendingCount,
        error: undefined,
      });
      return;
    }

    const completion: SessionCompletion = {
      id: this.createId('session-completion'),
      confirmedCount,
      pendingCount,
      message: completionMessage(confirmedCount, pendingCount),
    };
    this.publish({
      phase: 'COMPLETED',
      entryGeneration: this.snapshot.entryGeneration,
      candidates: [],
      confirmedCount,
      pendingCount,
      error: undefined,
      completion,
    });
  }

  private publish(snapshot: BookkeepingSessionSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach(listener => listener());
  }
}

export const bookkeepingSession = new BookkeepingSessionStore();

export function useBookkeepingSession(
  store: BookkeepingSessionStore = bookkeepingSession,
): BookkeepingSessionSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
