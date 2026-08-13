import type {
  ClassificationFeedback,
  Transaction,
  TransactionType,
  UserRule,
} from '../../domain/entities';
import {
  bookkeepingTextLength,
  MAX_BOOKKEEPING_TEXT_CHARACTERS,
} from '../../domain/policies/bookkeepingInputPolicy';
import type {
  DatabaseConnection,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from '../types';
import { BaseRepository } from './BaseRepository';
import {
  classificationFeedbackDefinition,
  userRuleDefinition,
} from './entityDefinitions';
import {
  optionalString,
  requiredNumber,
  requiredString,
} from './mappingHelpers';
import {
  canonicalUtcTimestamp,
  LedgerValidationError,
  saveValidatedTransactionWithTags,
} from './transactionWriteIntegrity';
import {
  saveRecognizedOperationInTransaction,
  type RecognizedOperationOutcome,
} from './recognizedOperationReceipt';

export const LEARNED_MERCHANT_STREAK_LENGTH = 3;

export interface ClassificationFeedbackListOptions {
  transactionId?: string;
  merchantRawName?: string;
  sourceText?: string;
  limit?: number;
}

export interface CorrectionSummary {
  correctedType?: TransactionType;
  correctedCategoryId?: string;
  correctedSubcategoryId?: string;
  correctedAccountId?: string;
  correctionCount: number;
  lastCorrectedAt: string;
}

export type MerchantRulePromotionStatus =
  | 'LEARNING_PAUSED'
  | 'INELIGIBLE_TRANSACTION'
  | 'NOT_REQUESTED'
  | 'INSUFFICIENT_STREAK'
  | 'SUPPRESSED'
  | 'RULE_EXISTS'
  | 'PROMOTED';

export interface RecordCorrectionOptions {
  /**
   * Supplying a candidate opts into the documented merchant-only promotion.
   * The repository promotes it only after three latest consecutive matching
   * category corrections. It never derives keyword or text-pattern rules.
   */
  learnedMerchantRule?: UserRule;
  processedAt?: string;
}

export interface SaveCorrectedTransactionWithTagsInput {
  transaction: Transaction;
  tagIds: readonly string[];
  feedback: ClassificationFeedback;
  correctionOptions?: RecordCorrectionOptions;
}

export interface RecordCorrectionResult {
  recorded: boolean;
  promotionStatus: MerchantRulePromotionStatus;
  streakCount: number;
  promotedRuleId?: string;
}

export interface SaveRecognizedCorrectionResult {
  operation: RecognizedOperationOutcome;
  learningResult?: RecordCorrectionResult;
}

type RecentMerchantCorrectionRow = SqlRow & {
  id: string;
  transaction_id: string;
  corrected_type: string | null;
  corrected_category_id: string | null;
  corrected_subcategory_id: string | null;
  learning_status: string;
};

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw new Error('Feedback limit must be an integer between 1 and 500.');
  }
}

function assertLearnedMerchantRule(
  feedback: ClassificationFeedback,
  rule: UserRule,
): void {
  if (rule.ruleType !== 'MERCHANT') {
    throw new Error('Automatic learning can only promote MERCHANT rules.');
  }

  if (rule.origin !== 'LEARNED_MERCHANT') {
    throw new Error('Automatic promotion requires a LEARNED_MERCHANT origin.');
  }

  if (rule.pattern.trim().length === 0) {
    throw new Error('Learned merchant rule pattern must not be empty.');
  }

  if (feedback.merchantRawName?.trim().length === 0) {
    throw new Error(
      'Merchant feedback must contain a non-empty merchant name.',
    );
  }

  if (feedback.merchantRawName === undefined) {
    throw new Error('Merchant feedback is required for automatic promotion.');
  }

  if (feedback.correctedCategoryId === undefined) {
    throw new Error('A corrected category is required for merchant learning.');
  }

  if (
    feedback.originalCategoryId === feedback.correctedCategoryId &&
    feedback.originalSubcategoryId === feedback.correctedSubcategoryId
  ) {
    throw new Error(
      'Merchant learning requires an actual category correction.',
    );
  }

  if (
    rule.categoryId !== feedback.correctedCategoryId ||
    rule.subcategoryId !== feedback.correctedSubcategoryId
  ) {
    throw new Error(
      'Learned rule category must match the current correction target.',
    );
  }
}

function isSameCategoryCorrection(
  row: RecentMerchantCorrectionRow,
  feedback: ClassificationFeedback,
): boolean {
  return (
    row.learning_status === 'PENDING' &&
    row.corrected_type === (feedback.correctedType ?? null) &&
    row.corrected_category_id === feedback.correctedCategoryId &&
    row.corrected_subcategory_id === (feedback.correctedSubcategoryId ?? null)
  );
}

export class ClassificationFeedbackRepository extends BaseRepository<ClassificationFeedback> {
  constructor(database: DatabaseConnection) {
    super(database, classificationFeedbackDefinition);
  }

  override async create(feedback: ClassificationFeedback): Promise<void> {
    await this.recordCorrection(feedback);
  }

  async recordCorrection(
    feedback: ClassificationFeedback,
    options: RecordCorrectionOptions = {},
  ): Promise<RecordCorrectionResult> {
    this.assertPromotionCandidate(feedback, options);
    return this.database.transaction(transaction =>
      this.recordCorrectionInTransaction(feedback, options, transaction),
    );
  }

  async saveCorrectedTransactionWithTags(
    input: SaveCorrectedTransactionWithTagsInput,
  ): Promise<RecordCorrectionResult> {
    const { transaction, tagIds, feedback } = input;
    const options = input.correctionOptions ?? {};

    if (transaction.confirmationStatus !== 'CONFIRMED') {
      throw new Error('Corrected transactions must be CONFIRMED.');
    }

    if (transaction.deletedAt !== undefined) {
      throw new Error('A deleted transaction cannot record learning feedback.');
    }

    if (transaction.duplicateStatus === 'MERGED') {
      throw new Error('A MERGED duplicate cannot record learning feedback.');
    }

    if (feedback.transactionId !== transaction.id) {
      throw new Error(
        'Feedback transactionId must match the saved transaction.',
      );
    }

    this.assertPromotionCandidate(feedback, options);

    return this.database.transaction(async executor => {
      await saveValidatedTransactionWithTags(executor, transaction, tagIds);
      return this.recordCorrectionInTransaction(feedback, options, executor);
    });
  }

  async saveRecognizedCorrectedTransactionWithTags(
    input: SaveCorrectedTransactionWithTagsInput,
  ): Promise<SaveRecognizedCorrectionResult> {
    const { transaction, tagIds, feedback } = input;
    const options = input.correctionOptions ?? {};
    if (transaction.source !== 'VOICE') {
      throw new Error('Recognized correction receipts require VOICE source.');
    }
    if (transaction.confirmationStatus !== 'CONFIRMED') {
      throw new Error('Corrected transactions must be CONFIRMED.');
    }
    if (feedback.transactionId !== transaction.id) {
      throw new Error(
        'Feedback transactionId must match the saved transaction.',
      );
    }
    this.assertPromotionCandidate(feedback, options);

    return this.database.transaction(async executor => {
      const operation = await saveRecognizedOperationInTransaction(
        executor,
        transaction,
        tagIds,
      );
      if (operation.status !== 'COMMITTED') {
        return { operation };
      }
      const learningResult = await this.recordCorrectionInTransaction(
        feedback,
        options,
        executor,
      );
      return { operation, learningResult };
    });
  }

  private assertPromotionCandidate(
    feedback: ClassificationFeedback,
    options: RecordCorrectionOptions,
  ): void {
    if (options.learnedMerchantRule !== undefined) {
      assertLearnedMerchantRule(feedback, options.learnedMerchantRule);
    }
  }

  private async recordCorrectionInTransaction(
    feedback: ClassificationFeedback,
    options: RecordCorrectionOptions,
    executor: SqlExecutor,
  ): Promise<RecordCorrectionResult> {
    const candidate = options.learnedMerchantRule;
    const learningEnabled = await this.isLearningEnabled(executor);

    if (!learningEnabled) {
      return {
        recorded: false,
        promotionStatus: 'LEARNING_PAUSED',
        streakCount: 0,
      };
    }

    if (!(await this.isEligibleTransaction(feedback.transactionId, executor))) {
      return {
        recorded: false,
        promotionStatus: 'INELIGIBLE_TRANSACTION',
        streakCount: 0,
      };
    }

    const keepSourceText = await this.shouldRetainOriginalText(executor);
    const retainedSourceText = keepSourceText ? feedback.sourceText : undefined;
    if (
      retainedSourceText !== undefined &&
      bookkeepingTextLength(retainedSourceText) >
        MAX_BOOKKEEPING_TEXT_CHARACTERS
    ) {
      throw new LedgerValidationError(
        `Feedback sourceText must not exceed ${MAX_BOOKKEEPING_TEXT_CHARACTERS} characters.`,
      );
    }
    const sourceText = retainedSourceText?.trim();
    const merchantRawName = feedback.merchantRawName?.trim();
    if (merchantRawName !== undefined && merchantRawName.length > 256) {
      throw new LedgerValidationError(
        'Feedback merchantRawName must not exceed 256 characters.',
      );
    }
    const pendingFeedback: ClassificationFeedback = {
      ...feedback,
      sourceText:
        sourceText === undefined || sourceText.length === 0
          ? undefined
          : sourceText,
      merchantRawName:
        merchantRawName === undefined || merchantRawName.length === 0
          ? undefined
          : merchantRawName,
      learningStatus: 'PENDING',
      promotedRuleId: undefined,
      processedAt: undefined,
      createdAt: canonicalUtcTimestamp(
        feedback.createdAt,
        'feedback.createdAt',
      ),
    };
    await this.insert(pendingFeedback, executor);

    if (candidate === undefined) {
      return {
        recorded: true,
        promotionStatus: 'NOT_REQUESTED',
        streakCount: 0,
      };
    }

    const recent = await executor.execute<RecentMerchantCorrectionRow>(
      `SELECT id, transaction_id, corrected_type, corrected_category_id,
              corrected_subcategory_id, learning_status
       FROM (
         SELECT feedback.id, feedback.transaction_id,
                feedback.corrected_type, feedback.corrected_category_id,
                feedback.corrected_subcategory_id,
                feedback.learning_status, feedback.created_at,
                ROW_NUMBER() OVER (
                  PARTITION BY feedback.transaction_id
                  ORDER BY feedback.created_at DESC, feedback.id DESC
                ) AS transaction_rank
         FROM classification_feedback AS feedback
         INNER JOIN transactions AS ledger_entry
           ON ledger_entry.id = feedback.transaction_id
         WHERE feedback.merchant_raw_name = ? COLLATE NOCASE
           AND ledger_entry.confirmation_status = 'CONFIRMED'
           AND ledger_entry.deleted_at IS NULL
           AND ledger_entry.source IN ('TEXT', 'VOICE')
           AND ledger_entry.duplicate_status != 'MERGED'
       )
       WHERE transaction_rank = 1
       ORDER BY created_at DESC, id DESC
       LIMIT ${LEARNED_MERCHANT_STREAK_LENGTH}`,
      [feedback.merchantRawName!],
    );
    let streakCount = 0;

    for (const row of recent.rows) {
      if (!isSameCategoryCorrection(row, feedback)) {
        break;
      }

      streakCount += 1;
    }

    if (streakCount < LEARNED_MERCHANT_STREAK_LENGTH) {
      return {
        recorded: true,
        promotionStatus: 'INSUFFICIENT_STREAK',
        streakCount,
      };
    }

    const feedbackIds = recent.rows.map(row => row.id);
    const processedAt = canonicalUtcTimestamp(
      options.processedAt ?? feedback.createdAt,
      'feedback.processedAt',
    );

    if (await this.isSuppressed(candidate.pattern, executor)) {
      await this.markProcessed(
        feedbackIds,
        'DISMISSED',
        undefined,
        processedAt,
        executor,
      );
      return {
        recorded: true,
        promotionStatus: 'SUPPRESSED',
        streakCount,
      };
    }

    if (await this.ruleAlreadyExists(candidate, executor)) {
      await this.markProcessed(
        feedbackIds,
        'DISMISSED',
        undefined,
        processedAt,
        executor,
      );
      return {
        recorded: true,
        promotionStatus: 'RULE_EXISTS',
        streakCount,
      };
    }

    const learnedRule: UserRule = {
      ...candidate,
      origin: 'LEARNED_MERCHANT',
    };
    await this.insertLearnedRule(learnedRule, executor);
    await this.markProcessed(
      feedbackIds,
      'PROMOTED',
      learnedRule.id,
      processedAt,
      executor,
    );

    return {
      recorded: true,
      promotionStatus: 'PROMOTED',
      streakCount,
      promotedRuleId: learnedRule.id,
    };
  }

  async list(
    options: ClassificationFeedbackListOptions = {},
  ): Promise<ClassificationFeedback[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];

    if (options.transactionId !== undefined) {
      clauses.push('transaction_id = ?');
      params.push(options.transactionId);
    }

    if (options.merchantRawName !== undefined) {
      clauses.push('merchant_raw_name = ? COLLATE NOCASE');
      params.push(options.merchantRawName);
    }

    if (options.sourceText !== undefined) {
      clauses.push('source_text = ?');
      params.push(options.sourceText);
    }

    if (options.limit !== undefined) {
      assertLimit(options.limit);
    }

    return this.select(
      clauses.length === 0 ? undefined : clauses.join(' AND '),
      params,
      undefined,
      options.limit,
    );
  }

  async listForTransaction(
    transactionId: string,
  ): Promise<ClassificationFeedback[]> {
    return this.list({ transactionId });
  }

  async listForMerchant(
    merchantRawName: string,
    limit?: number,
  ): Promise<ClassificationFeedback[]> {
    return this.list({ merchantRawName, limit });
  }

  async listForSourceText(
    sourceText: string,
    limit?: number,
  ): Promise<ClassificationFeedback[]> {
    return this.list({ sourceText, limit });
  }

  async summarizeForMerchant(
    merchantRawName: string,
    limit = 10,
  ): Promise<CorrectionSummary[]> {
    return this.summarize(
      'feedback.merchant_raw_name = ? COLLATE NOCASE',
      [merchantRawName],
      limit,
    );
  }

  async summarizeForSourceText(
    sourceText: string,
    limit = 10,
  ): Promise<CorrectionSummary[]> {
    return this.summarize('feedback.source_text = ?', [sourceText], limit);
  }

  async remove(id: string): Promise<boolean> {
    return this.database.transaction(transaction =>
      this.deleteById(id, transaction),
    );
  }

  private async isLearningEnabled(executor: SqlExecutor): Promise<boolean> {
    const result = await executor.execute<{ learning_enabled: number }>(
      `SELECT learning_enabled
       FROM personalization_settings
       WHERE id = 1`,
    );
    const value = result.rows[0]?.learning_enabled;

    if (value !== 0 && value !== 1) {
      throw new Error('Personalization settings row is invalid or missing.');
    }

    return value === 1;
  }

  private async shouldRetainOriginalText(
    executor: SqlExecutor,
  ): Promise<boolean> {
    const result = await executor.execute<{ retain_original_text: number }>(
      `SELECT retain_original_text
       FROM personalization_settings
       WHERE id = 1`,
    );
    const value = result.rows[0]?.retain_original_text;

    if (value !== 0 && value !== 1) {
      throw new Error(
        'Personalization privacy settings are invalid or missing.',
      );
    }

    return value === 1;
  }

  private async isEligibleTransaction(
    transactionId: string,
    executor: SqlExecutor,
  ): Promise<boolean> {
    const result = await executor.execute<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM transactions
       WHERE id = ?
         AND confirmation_status = 'CONFIRMED'
         AND deleted_at IS NULL
         AND source IN ('TEXT', 'VOICE')
         AND duplicate_status != 'MERGED'`,
      [transactionId],
    );

    return (result.rows[0]?.count ?? 0) === 1;
  }

  private async isSuppressed(
    pattern: string,
    executor: SqlExecutor,
  ): Promise<boolean> {
    const result = await executor.execute<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM learned_rule_suppressions
       WHERE rule_type = 'MERCHANT' AND pattern = ? COLLATE NOCASE`,
      [pattern],
    );

    return (result.rows[0]?.count ?? 0) > 0;
  }

  private async ruleAlreadyExists(
    candidate: UserRule,
    executor: SqlExecutor,
  ): Promise<boolean> {
    const result = await executor.execute<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM user_rules
       WHERE rule_type = 'MERCHANT' AND pattern = ? COLLATE NOCASE`,
      [candidate.pattern],
    );

    return (result.rows[0]?.count ?? 0) > 0;
  }

  private async insertLearnedRule(
    rule: UserRule,
    executor: SqlExecutor,
  ): Promise<void> {
    const values = userRuleDefinition.toValues(rule);
    const columns = userRuleDefinition.columns;
    const placeholders = columns.map(() => '?').join(', ');

    await executor.execute(
      `INSERT INTO user_rules (${columns.join(', ')})
       VALUES (${placeholders})`,
      columns.map(column => values[column]),
    );
  }

  private async markProcessed(
    feedbackIds: readonly string[],
    status: 'PROMOTED' | 'DISMISSED',
    promotedRuleId: string | undefined,
    processedAt: string,
    executor: SqlExecutor,
  ): Promise<void> {
    const placeholders = feedbackIds.map(() => '?').join(', ');
    await executor.execute(
      `UPDATE classification_feedback
       SET learning_status = ?, promoted_rule_id = ?, processed_at = ?
       WHERE id IN (${placeholders})`,
      [status, promotedRuleId ?? null, processedAt, ...feedbackIds],
    );
  }

  private async summarize(
    where: string,
    params: readonly SqlValue[],
    limit: number,
  ): Promise<CorrectionSummary[]> {
    assertLimit(limit);
    const result = await this.database.execute(
      `SELECT feedback.corrected_type, feedback.corrected_category_id,
              feedback.corrected_subcategory_id,
              feedback.corrected_account_id,
              COUNT(*) AS correction_count,
              MAX(feedback.created_at) AS last_corrected_at
       FROM classification_feedback AS feedback
       INNER JOIN transactions AS ledger_entry
         ON ledger_entry.id = feedback.transaction_id
       WHERE ${where}
         AND ledger_entry.confirmation_status = 'CONFIRMED'
         AND ledger_entry.deleted_at IS NULL
         AND ledger_entry.source IN ('TEXT', 'VOICE')
         AND ledger_entry.duplicate_status != 'MERGED'
         AND (feedback.corrected_type IS NOT NULL
           OR feedback.corrected_category_id IS NOT NULL
           OR feedback.corrected_subcategory_id IS NOT NULL
           OR feedback.corrected_account_id IS NOT NULL)
       GROUP BY feedback.corrected_type, feedback.corrected_category_id,
                feedback.corrected_subcategory_id,
                feedback.corrected_account_id
       ORDER BY correction_count DESC, last_corrected_at DESC
       LIMIT ${limit}`,
      params,
    );

    return result.rows.map(row => ({
      correctedType: optionalString(row, 'corrected_type') as
        TransactionType | undefined,
      correctedCategoryId: optionalString(row, 'corrected_category_id'),
      correctedSubcategoryId: optionalString(row, 'corrected_subcategory_id'),
      correctedAccountId: optionalString(row, 'corrected_account_id'),
      correctionCount: requiredNumber(row, 'correction_count'),
      lastCorrectedAt: requiredString(row, 'last_corrected_at'),
    }));
  }
}
