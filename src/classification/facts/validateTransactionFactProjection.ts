import type { AccountType, TransactionType } from '../../domain/entities';
import type { TransactionEventFacts } from '../parsers/transactionEventFacts';
import type {
  TransactionFactConflict,
  TransactionFactResolution,
  TransactionFactSpan,
} from './types';

export type TransactionFactProjection = Readonly<{
  type?: TransactionType;
  merchantRawName?: string;
  merchantResolutionSource?: string;
  accountKey?: AccountType;
  targetAccountKey?: AccountType;
  eventFacts: TransactionEventFacts;
}>;

function spansOverlap(
  left: TransactionFactSpan,
  right: TransactionFactSpan,
): boolean {
  return left.start < right.end && right.start < left.end;
}

function normalizedEntity(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').trim();
}

function uniqueConflicts(
  conflicts: readonly TransactionFactConflict[],
): TransactionFactConflict[] {
  return conflicts.filter(
    (conflict, index, all) =>
      all.findIndex(
        item =>
          item.code === conflict.code && item.message === conflict.message,
      ) === index,
  );
}

/**
 * Validates that compatibility fields still represent the same event as the
 * shared facts. Conflicts downgrade the resolution to ABSTAINED; callers must
 * surface the reason and must not silently raise confidence with other fields.
 */
export function validateTransactionFactProjection(
  resolution: TransactionFactResolution,
  projection: TransactionFactProjection,
): TransactionFactResolution {
  if (resolution.status !== 'RESOLVED') return resolution;

  const conflicts: TransactionFactConflict[] = [...resolution.conflicts];
  const criticalSpans = [
    resolution.counterparty?.span,
    resolution.sourceAccount?.span,
    resolution.targetAccount?.span,
    resolution.action?.span,
    ...resolution.moneyRanges,
  ].filter((value): value is TransactionFactSpan => value !== undefined);
  for (let leftIndex = 0; leftIndex < criticalSpans.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < criticalSpans.length;
      rightIndex += 1
    ) {
      const left = criticalSpans[leftIndex];
      const right = criticalSpans[rightIndex];
      if (spansOverlap(left, right)) {
        conflicts.push({
          code: 'OVERLAPPING_CRITICAL_FACTS',
          message: '动作、对象和金额的文本范围发生重叠，无法安全生成交易。',
          ruleIds: [
            resolution.action?.ruleId,
            resolution.counterparty?.ruleId,
          ].filter((value): value is string => value !== undefined),
        });
      }
    }
  }

  if (
    resolution.transactionType !== undefined &&
    projection.type !== resolution.transactionType.value
  ) {
    conflicts.push({
      code: 'TRANSACTION_TYPE_CONFLICT',
      message: '交易类型与已解析的资金动作不一致，需要人工确认。',
      ruleIds: [resolution.transactionType.ruleId],
    });
  }

  if (
    resolution.sourceAccount !== undefined &&
    projection.accountKey !== resolution.sourceAccount.accountType
  ) {
    conflicts.push({
      code: 'ACCOUNT_PROJECTION_CONFLICT',
      message: '转出账户与交易事实不一致，需要人工确认。',
      ruleIds: [resolution.sourceAccount.ruleId],
    });
  }
  if (
    resolution.targetAccount !== undefined &&
    projection.targetAccountKey !== resolution.targetAccount.accountType
  ) {
    conflicts.push({
      code: 'ACCOUNT_PROJECTION_CONFLICT',
      message: '转入账户与交易事实不一致，需要人工确认。',
      ruleIds: [resolution.targetAccount.ruleId],
    });
  }
  if (
    resolution.direction !== undefined &&
    projection.eventFacts.direction !== resolution.direction.value
  ) {
    conflicts.push({
      code: 'PARTICIPANT_DIRECTION_CONFLICT',
      message: '付款人与收款人关系和资金方向不一致，需要人工确认。',
      ruleIds: [resolution.direction.ruleId],
    });
  }
  if (
    resolution.fundSemantics !== undefined &&
    projection.eventFacts.fundSemantics !== resolution.fundSemantics.value
  ) {
    conflicts.push({
      code: 'FUND_SEMANTICS_CONFLICT',
      message: '资金性质与已解析的交易动作不一致，需要人工确认。',
      ruleIds: [resolution.fundSemantics.ruleId],
    });
  }

  const projectedMerchant = projection.merchantRawName;
  const hasExplicitMerchant =
    projection.merchantResolutionSource === 'EXPLICIT_FIELD';
  if (
    resolution.merchantProjection === 'COUNTERPARTY' &&
    !hasExplicitMerchant &&
    (resolution.counterparty === undefined ||
      projectedMerchant === undefined ||
      normalizedEntity(projectedMerchant) !==
        normalizedEntity(resolution.counterparty.text))
  ) {
    conflicts.push({
      code: 'MERCHANT_PROJECTION_CONFLICT',
      message: '兼容商户字段与已解析的交易对象不一致，已阻止直接确认。',
      ruleIds:
        resolution.counterparty === undefined
          ? []
          : [resolution.counterparty.ruleId],
    });
  }
  if (
    resolution.merchantProjection === 'SUPPRESS_LEGACY' &&
    !hasExplicitMerchant &&
    projectedMerchant !== undefined
  ) {
    conflicts.push({
      code: 'MERCHANT_PROJECTION_CONFLICT',
      message: '受益人或动作短语不能作为商户，已阻止直接确认。',
      ruleIds:
        resolution.counterparty === undefined
          ? []
          : [resolution.counterparty.ruleId],
    });
  }

  const unique = uniqueConflicts(conflicts);
  return unique.length === 0
    ? resolution
    : {
        ...resolution,
        status: 'ABSTAINED',
        conflicts: unique,
      };
}
