import { parseTextTransactions } from '../classification/parseTextTransactions';
import type { Repositories } from '../database';
import type { Transaction } from '../domain/entities';
import { buildTextTransaction } from '../domain/services/textTransaction';
import type { ParsedPaymentNotification } from './paymentNotification';

export type AnalyzedPaymentNotification = {
  notificationKey: string;
  transaction: Transaction;
  tagIds: readonly string[];
};

export async function analyzePaymentNotifications(
  repositories: Repositories,
  candidates: readonly ParsedPaymentNotification[],
  analyzedAt: string,
): Promise<AnalyzedPaymentNotification[]> {
  const [
    categories,
    accounts,
    projects,
    tags,
    userRules,
    merchants,
    personalization,
  ] = await Promise.all([
    repositories.categories.listAll(),
    repositories.accounts.listAll(),
    repositories.projects.listAll(),
    repositories.tags.listAll(),
    repositories.userRules.listEnabled(),
    repositories.merchants.listAll(),
    repositories.personalizationSettings.get(),
  ]);

  return candidates.map(candidate => {
    const parsed = parseTextTransactions(
      `${candidate.originalText}\n${candidate.transactionSource === 'WECHAT_IMPORT' ? '微信支付' : '支付宝'}`,
      {
        referenceDate: new Date(candidate.occurredAt),
        categories,
        accounts,
        userRules,
        merchants,
      },
    ).candidates[0];
    if (parsed === undefined) throw new Error('支付通知无法生成记账候选。');
    const built = buildTextTransaction(
      {
        ...parsed,
        amountMinor: candidate.amountMinor,
        occurredAt: candidate.occurredAt,
        type: candidate.type,
        merchantRawName: candidate.merchantRawName ?? parsed.merchantRawName,
      },
      { categories, accounts, projects, tags },
      `notification-${candidate.sourceReferenceId.slice('notification:'.length)}`,
      analyzedAt,
      'PENDING',
    );
    return {
      notificationKey: candidate.notificationKey,
      tagIds: built.tagIds,
      transaction: {
        ...built.transaction,
        source: candidate.transactionSource,
        sourceReferenceId: candidate.sourceReferenceId,
        originalText: personalization.retainOriginalText
          ? candidate.originalText
          : undefined,
        note:
          built.transaction.note ??
          '来自 Android 支付通知，请核对商户、金额、账户和分类',
        confirmationStatus: 'PENDING',
      },
    };
  });
}
