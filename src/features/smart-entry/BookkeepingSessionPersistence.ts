import type { ParsedTransactionCandidate } from '../../classification/types';
import {
  RecognizedOperationConsumedError,
  type RecognizedOperationOutcome,
  type RecordCorrectionResult,
  type Repositories,
} from '../../database';
import type { ConfirmationStatus, Transaction } from '../../domain/entities';
import {
  amountTextFromMinor,
  buildManualTransaction,
  type ManualTransactionDraft,
} from '../../domain/services/manualTransaction';
import {
  buildCorrectionLearningPlan,
  type CorrectionLearningPlan,
} from '../../domain/services/personalizationLearning';
import {
  canConfirmWithIntent,
  type RecognizedConfirmationIntent,
  ReviewRequiredError,
  reviewReasonCodes,
} from '../../domain/services/reviewDisposition';
import {
  buildTextTransaction,
  confirmationIssues,
  type TextTransactionReferenceData,
} from '../../domain/services/textTransaction';
import type { SessionCandidate } from './BookkeepingSession';

type PersistableConfirmationStatus = Extract<
  ConfirmationStatus,
  'CONFIRMED' | 'PENDING'
>;

export type RecognizedCandidatePersistenceOptions = {
  updatedAt?: string;
  confirmationIntent?: RecognizedConfirmationIntent;
};

export type PreparedSessionCandidate = {
  draft: ManualTransactionDraft;
  original?: Transaction;
};

export type EditedCandidatePersistenceResult = {
  transaction: Transaction;
  learningPlan?: CorrectionLearningPlan;
  learningResult?: RecordCorrectionResult;
  wasAlreadySaved: boolean;
};

export type RecognizedCandidatePersistenceResult = {
  transaction: Transaction;
  outcome: Extract<
    RecognizedOperationOutcome['status'],
    'COMMITTED' | 'ALREADY_COMMITTED'
  >;
};

function finalClassificationKey(
  transaction: Transaction,
  references: TextTransactionReferenceData,
): string | undefined {
  if (transaction.type === 'INCOME') {
    return 'income';
  }
  return references.categories.find(
    category => category.id === transaction.categoryId,
  )?.systemKey;
}

async function recordShadowObservation(
  sessionCandidate: SessionCandidate,
  transaction: Transaction,
  references: TextTransactionReferenceData,
  repositories: Repositories,
  createdAt: string,
): Promise<void> {
  const model = sessionCandidate.candidate.onDeviceModel;
  if (
    model?.deploymentMode !== 'SHADOW' ||
    transaction.confirmationStatus !== 'CONFIRMED'
  ) {
    return;
  }
  const finalCategoryKey = finalClassificationKey(transaction, references);
  if (finalCategoryKey === undefined) {
    return;
  }
  try {
    await repositories.shadowObservations.record({
      id: `model-shadow-${transaction.id}`,
      transactionId: transaction.id,
      modelId: model.modelId,
      modelVersion: model.modelVersion,
      taxonomyVersion: model.taxonomyVersion,
      predictedCategoryKey: model.predictedCategoryKey,
      finalCategoryKey,
      matched: model.predictedCategoryKey === finalCategoryKey,
      calibratedConfidence: model.calibratedConfidence,
      latencyMs: model.latencyMs,
      createdAt,
    });
  } catch {
    // Observation telemetry is local and best-effort. It must never make a
    // successfully validated ledger write appear to fail.
  }
}

function sourceReferenceIdFor(candidate: SessionCandidate): string {
  if (candidate.inputSource === 'VOICE') {
    const originKey = candidate.originKey?.trim();
    if (originKey === undefined || originKey.length === 0) {
      throw new Error('VOICE candidate is missing its stable origin key.');
    }
    return originKey;
  }
  return candidate.idempotencyKey;
}

function primaryCategoryByKey(
  candidate: ParsedTransactionCandidate,
  references: TextTransactionReferenceData,
) {
  const subcategory = references.categories.find(
    item =>
      item.id === candidate.subcategoryIdHint ||
      item.systemKey === candidate.subcategoryKey,
  );
  const category =
    references.categories.find(
      item =>
        item.id === candidate.categoryIdHint ||
        item.systemKey === candidate.categoryKey,
    ) ??
    (subcategory?.parentId === undefined
      ? undefined
      : references.categories.find(item => item.id === subcategory.parentId));
  return category;
}

function accountIdFor(
  candidate: ParsedTransactionCandidate,
  references: TextTransactionReferenceData,
): string | undefined {
  return (
    references.accounts.find(item => item.id === candidate.accountIdHint)?.id ??
    references.accounts.find(item => item.type === candidate.accountKey)?.id ??
    references.accounts[0]?.id
  );
}

function hasResolvableSourceAccount(
  candidate: ParsedTransactionCandidate,
  references: TextTransactionReferenceData,
): boolean {
  if (candidate.accountIdHint !== undefined) {
    return references.accounts.some(
      account =>
        account.id === candidate.accountIdHint && account.isHidden !== true,
    );
  }
  return (
    candidate.accountKey !== undefined &&
    references.accounts.some(
      account =>
        account.type === candidate.accountKey && account.isHidden !== true,
    )
  );
}

function targetAccountIdFor(
  candidate: ParsedTransactionCandidate,
  references: TextTransactionReferenceData,
): string | undefined {
  return references.accounts.find(
    item => item.type === candidate.targetAccountKey,
  )?.id;
}

function projectIdFor(
  candidate: ParsedTransactionCandidate,
  references: TextTransactionReferenceData,
): string | undefined {
  return references.projects.find(
    item =>
      candidate.projectName !== undefined &&
      item.name.localeCompare(candidate.projectName, 'zh-CN', {
        sensitivity: 'accent',
      }) === 0,
  )?.id;
}

function tagIdsFor(
  candidate: ParsedTransactionCandidate,
  references: TextTransactionReferenceData,
): string[] {
  const names = new Set(candidate.tags.map(name => name.trim()));
  return references.tags.filter(tag => names.has(tag.name)).map(tag => tag.id);
}

function withSessionIdentity(
  transaction: Transaction,
  sessionCandidate: SessionCandidate,
  updatedAt: string,
): Transaction {
  return {
    ...transaction,
    id: sessionCandidate.transactionId,
    source: sessionCandidate.inputSource,
    sourceReferenceId: sourceReferenceIdFor(sessionCandidate),
    originalText: sessionCandidate.candidate.originalText,
    confidence: sessionCandidate.candidate.confidence,
    createdAt: sessionCandidate.createdAt,
    updatedAt,
  };
}

function assertOwnedPersistedTransaction(
  transaction: Transaction,
  candidate: SessionCandidate,
  status: PersistableConfirmationStatus,
): void {
  if (
    transaction.source !== candidate.inputSource ||
    transaction.sourceReferenceId !== sourceReferenceIdFor(candidate) ||
    transaction.confirmationStatus !== status
  ) {
    throw new Error('该候选的幂等标识已被其他账目占用，请重新识别。');
  }
}

export function prepareSessionCandidateForEditing(
  sessionCandidate: SessionCandidate,
  references: TextTransactionReferenceData,
  fallbackDate = new Date(),
): PreparedSessionCandidate {
  const candidate = sessionCandidate.candidate;
  let original: Transaction | undefined;
  let builtTagIds: readonly string[] | undefined;

  try {
    const built = buildTextTransaction(
      candidate,
      references,
      sessionCandidate.transactionId,
      sessionCandidate.createdAt,
      'CONFIRMED',
      sessionCandidate.inputSource,
    );
    original = withSessionIdentity(
      built.transaction,
      sessionCandidate,
      sessionCandidate.createdAt,
    );
    builtTagIds = built.tagIds;
  } catch {
    // An incomplete candidate can still be corrected in the editor. We only
    // create a learning baseline when recognition produced a valid transaction.
  }

  const category = primaryCategoryByKey(candidate, references);
  const occurredAt = new Date(candidate.occurredAt ?? fallbackDate);
  const safeOccurredAt = Number.isNaN(occurredAt.getTime())
    ? fallbackDate
    : occurredAt;

  return {
    original,
    draft: {
      type: candidate.type ?? 'EXPENSE',
      amountText:
        candidate.amountMinor === undefined
          ? ''
          : amountTextFromMinor(candidate.amountMinor),
      occurredAt: safeOccurredAt,
      categoryId: original?.categoryId ?? category?.id,
      // Recognition no longer pre-fills a secondary category. Historical rows
      // still retain theirs, and the manual editor may add one explicitly.
      subcategoryId: original?.subcategoryId,
      accountId: original?.accountId ?? accountIdFor(candidate, references),
      targetAccountId:
        original?.targetAccountId ?? targetAccountIdFor(candidate, references),
      merchantName: candidate.merchantRawName ?? '',
      projectId: original?.projectId ?? projectIdFor(candidate, references),
      tagIds: builtTagIds ?? tagIdsFor(candidate, references),
      note: candidate.note ?? '',
    },
  };
}

export async function persistRecognizedSessionCandidate(
  sessionCandidate: SessionCandidate,
  confirmationStatus: PersistableConfirmationStatus,
  references: TextTransactionReferenceData,
  repositories: Repositories,
  options: string | RecognizedCandidatePersistenceOptions = {},
): Promise<RecognizedCandidatePersistenceResult> {
  const updatedAt =
    typeof options === 'string'
      ? options
      : (options.updatedAt ?? new Date().toISOString());
  const confirmationIntent =
    typeof options === 'string'
      ? 'DIRECT_CONFIRM'
      : (options.confirmationIntent ?? 'DIRECT_CONFIRM');
  if (
    confirmationStatus === 'CONFIRMED' &&
    !canConfirmWithIntent(sessionCandidate.candidate, confirmationIntent)
  ) {
    throw new ReviewRequiredError(
      reviewReasonCodes(sessionCandidate.candidate),
    );
  }
  // Reference data can change between recognition and confirmation. A stale
  // rule/account hint must never fall through to another account of the same
  // type merely because it is still present in the latest reference list.
  if (
    confirmationStatus === 'CONFIRMED' &&
    !hasResolvableSourceAccount(sessionCandidate.candidate, references)
  ) {
    throw new ReviewRequiredError(['MISSING_FIELDS']);
  }

  const alreadySaved =
    sessionCandidate.inputSource === 'TEXT'
      ? await repositories.transactions.findById(
          sessionCandidate.transactionId,
          { includeDeleted: true },
        )
      : undefined;
  if (alreadySaved !== undefined && alreadySaved.deletedAt === undefined) {
    assertOwnedPersistedTransaction(
      alreadySaved,
      sessionCandidate,
      confirmationStatus,
    );
    await recordShadowObservation(
      sessionCandidate,
      alreadySaved,
      references,
      repositories,
      updatedAt,
    );
    return { transaction: alreadySaved, outcome: 'ALREADY_COMMITTED' };
  }
  if (alreadySaved?.deletedAt !== undefined) {
    throw new Error('A deleted text transaction cannot be replayed.');
  }

  const built = buildTextTransaction(
    sessionCandidate.candidate,
    references,
    sessionCandidate.transactionId,
    sessionCandidate.createdAt,
    confirmationStatus,
    sessionCandidate.inputSource,
  );
  const transaction = withSessionIdentity(
    confirmationStatus === 'CONFIRMED'
      ? {
          ...built.transaction,
          requiresReview: false,
          reviewReasonCodes: [],
        }
      : built.transaction,
    sessionCandidate,
    updatedAt,
  );

  if (confirmationStatus === 'CONFIRMED') {
    const issues = confirmationIssues(transaction);
    if (issues.length > 0) {
      throw new Error(`直接确认前请补充：${issues.join('、')}。`);
    }
  }

  if (sessionCandidate.inputSource === 'VOICE') {
    const outcome = await repositories.transactions.saveRecognizedWithTags(
      transaction,
      built.tagIds,
    );
    if (outcome.status === 'CONSUMED_DELETED') {
      throw new RecognizedOperationConsumedError();
    }
    await recordShadowObservation(
      sessionCandidate,
      outcome.transaction,
      references,
      repositories,
      updatedAt,
    );
    return {
      transaction: outcome.transaction,
      outcome: outcome.status,
    };
  }

  const persisted = await repositories.transactions.saveWithTags(
    transaction,
    built.tagIds,
  );
  if (confirmationStatus === 'CONFIRMED') {
    await recordShadowObservation(
      sessionCandidate,
      persisted,
      references,
      repositories,
      updatedAt,
    );
  }
  return { transaction: persisted, outcome: 'COMMITTED' };
}

export async function persistEditedSessionCandidate(
  sessionCandidate: SessionCandidate,
  draft: ManualTransactionDraft,
  amountMinor: number,
  references: TextTransactionReferenceData,
  repositories: Repositories,
  updatedAt = new Date().toISOString(),
): Promise<EditedCandidatePersistenceResult> {
  const alreadySaved =
    sessionCandidate.inputSource === 'TEXT'
      ? await repositories.transactions.findById(
          sessionCandidate.transactionId,
          { includeDeleted: true },
        )
      : undefined;
  if (alreadySaved !== undefined) {
    if (alreadySaved.deletedAt !== undefined) {
      throw new Error('A deleted text transaction cannot be replayed.');
    }
    assertOwnedPersistedTransaction(
      alreadySaved,
      sessionCandidate,
      'CONFIRMED',
    );
    await recordShadowObservation(
      sessionCandidate,
      alreadySaved,
      references,
      repositories,
      updatedAt,
    );
    return { transaction: alreadySaved, wasAlreadySaved: true };
  }

  const prepared = prepareSessionCandidateForEditing(
    sessionCandidate,
    references,
  );
  const transaction = withSessionIdentity(
    buildManualTransaction(
      draft,
      amountMinor,
      sessionCandidate.transactionId,
      updatedAt,
      prepared.original,
    ),
    sessionCandidate,
    updatedAt,
  );
  const learningPlan =
    prepared.original === undefined
      ? undefined
      : buildCorrectionLearningPlan(
          prepared.original,
          transaction,
          updatedAt,
          sessionCandidate.feedbackId,
          sessionCandidate.learnedRuleId,
        );

  if (learningPlan === undefined) {
    if (sessionCandidate.inputSource === 'VOICE') {
      const operation = await repositories.transactions.saveRecognizedWithTags(
        transaction,
        draft.tagIds,
      );
      if (operation.status === 'CONSUMED_DELETED') {
        throw new RecognizedOperationConsumedError();
      }
      await recordShadowObservation(
        sessionCandidate,
        operation.transaction,
        references,
        repositories,
        updatedAt,
      );
      return {
        transaction: operation.transaction,
        wasAlreadySaved: operation.status === 'ALREADY_COMMITTED',
      };
    }
    const persisted = await repositories.transactions.saveWithTags(
      transaction,
      draft.tagIds,
    );
    await recordShadowObservation(
      sessionCandidate,
      persisted,
      references,
      repositories,
      updatedAt,
    );
    return { transaction: persisted, wasAlreadySaved: false };
  }

  if (sessionCandidate.inputSource === 'VOICE') {
    const result =
      await repositories.classificationFeedback.saveRecognizedCorrectedTransactionWithTags(
        {
          transaction,
          tagIds: draft.tagIds,
          feedback: learningPlan.feedback,
          correctionOptions: {
            learnedMerchantRule: learningPlan.learnedMerchantRule,
            processedAt: updatedAt,
          },
        },
      );
    if (result.operation.status === 'CONSUMED_DELETED') {
      throw new RecognizedOperationConsumedError();
    }
    await recordShadowObservation(
      sessionCandidate,
      result.operation.transaction,
      references,
      repositories,
      updatedAt,
    );
    return {
      transaction: result.operation.transaction,
      learningPlan,
      learningResult: result.learningResult,
      wasAlreadySaved: result.operation.status === 'ALREADY_COMMITTED',
    };
  }

  const learningResult =
    await repositories.classificationFeedback.saveCorrectedTransactionWithTags({
      transaction,
      tagIds: draft.tagIds,
      feedback: learningPlan.feedback,
      correctionOptions: {
        learnedMerchantRule: learningPlan.learnedMerchantRule,
        processedAt: updatedAt,
      },
    });
  await recordShadowObservation(
    sessionCandidate,
    transaction,
    references,
    repositories,
    updatedAt,
  );
  return {
    transaction,
    learningPlan,
    learningResult,
    wasAlreadySaved: false,
  };
}
