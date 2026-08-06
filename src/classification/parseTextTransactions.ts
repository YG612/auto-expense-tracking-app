import type { AccountType, TransactionType } from '../domain/entities';
import {
  calculateConfidence,
  type ConfidenceEvidence,
} from './confidence/calculateConfidence';
import { normalizeChineseTransactionText } from './normalizers/normalizeText';
import { parseAmount } from './parsers/amountParser';
import { parseDateTime } from './parsers/dateTimeParser';
import { splitTransactionSegments } from './parsers/splitTransactions';
import {
  applyExistingUserRules,
  applyMerchantDictionary,
  hasExplicitTransactionCue,
  inferProjectAndTags,
  recognizeAccounts,
  recognizeCategory,
  recognizeMerchant,
  recognizeTransactionType,
} from './rules/localRules';
import {
  confidenceLevelFor,
  type ParsedTransactionCandidate,
  type TextParsingContext,
  type TextParsingResult,
} from './types';

function requiresCategory(type: TransactionType | undefined): boolean {
  return (
    type === 'EXPENSE' ||
    type === 'INCOME' ||
    type === 'REFUND' ||
    type === 'REIMBURSEMENT'
  );
}

function missingFieldsFor(candidate: {
  type?: TransactionType;
  amountMinor?: number;
  occurredAt?: string;
  categoryKey?: string;
  categoryIdHint?: string;
  accountKey?: AccountType;
  accountIdHint?: string;
  targetAccountKey?: AccountType;
}): string[] {
  const missing: string[] = [];
  if (candidate.amountMinor === undefined) {
    missing.push('金额');
  }
  if (candidate.type === undefined) {
    missing.push('交易类型');
  }
  if (candidate.occurredAt === undefined) {
    missing.push('日期时间');
  }
  if (
    requiresCategory(candidate.type) &&
    candidate.categoryKey === undefined &&
    candidate.categoryIdHint === undefined
  ) {
    missing.push('分类');
  }
  if (
    candidate.accountKey === undefined &&
    candidate.accountIdHint === undefined
  ) {
    missing.push('账户');
  }
  if (
    candidate.type === 'TRANSFER' &&
    candidate.targetAccountKey === undefined
  ) {
    missing.push('转入账户');
  }
  return missing;
}

function addUnique(target: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function riskForAmbiguities(
  ambiguityReasons: readonly string[],
): ConfidenceEvidence['risks'] {
  const risks: ConfidenceEvidence['risks'][number][] = [];
  if (ambiguityReasons.some(reason => reason.includes('多个金额'))) {
    risks.push('MULTIPLE_AMOUNTS');
  }
  if (ambiguityReasons.some(reason => reason.includes('口语金额'))) {
    risks.push('COLLOQUIAL_AMOUNT');
  }
  return risks;
}

export function parseTextTransactions(
  value: string,
  context: TextParsingContext,
): TextParsingResult {
  if (Number.isNaN(context.referenceDate.getTime())) {
    throw new Error('referenceDate 必须是有效日期。');
  }

  // 1. 标准化
  const normalizedText = normalizeChineseTransactionText(value);
  // 2. 多笔拆分
  const segments = splitTransactionSegments(normalizedText);
  const timezoneOffsetMinutes =
    context.timezoneOffsetMinutes ?? -context.referenceDate.getTimezoneOffset();
  const sharedDate = parseDateTime(
    normalizedText,
    context.referenceDate,
    timezoneOffsetMinutes,
  );
  const sharedAccounts = recognizeAccounts(
    normalizedText,
    context.accounts ?? [],
  );

  const candidates = segments.map(segment => {
    // 3. 金额
    const amount = parseAmount(segment);
    // 4. 日期/时间；未在分句中说明时共享整句日期
    const segmentDate = parseDateTime(
      segment,
      context.referenceDate,
      timezoneOffsetMinutes,
    );
    const dateTime = segmentDate.explicitDateOrTime ? segmentDate : sharedDate;
    // 5. 账户；账户修饰分句可以作为整句共享上下文
    const segmentAccounts = recognizeAccounts(segment, context.accounts ?? []);
    const explicitAccounts = segmentAccounts.explicit
      ? segmentAccounts
      : sharedAccounts.explicit
        ? sharedAccounts
        : undefined;
    // 6. 交易类型
    const typeRecognition = recognizeTransactionType(segment);
    // 7. 商户
    const merchantRecognition = recognizeMerchant(segment);
    // 8. 先解析本地商户身份；这里仅解析名称，不应用默认分类。
    // 这样用户规则既能匹配原始商户名，也能匹配词典中的规范名和别名。
    const merchantDictionary = applyMerchantDictionary(
      segment,
      context.merchants,
      context.categories,
    );
    // 9. 只读取已有用户规则，学习和持久化由确认流程负责。
    const userRule = applyExistingUserRules(
      segment,
      merchantDictionary.merchantRawName ?? merchantRecognition.merchantRawName,
      context.userRules,
      context.categories,
      context.accounts,
    );
    const type =
      typeRecognition.explicit || userRule.type === undefined
        ? typeRecognition.type
        : userRule.type;
    // 10/11. 一级与二级分类；用户本次明确表达优先于历史规则
    const keywordCategory = recognizeCategory(segment, type);
    const useKeywordCategory = keywordCategory.explicit;
    const categoryKey = useKeywordCategory
      ? keywordCategory.categoryKey
      : (userRule.categoryKey ??
        merchantDictionary.categoryKey ??
        keywordCategory.categoryKey);
    const subcategoryKey = useKeywordCategory
      ? keywordCategory.subcategoryKey
      : (userRule.subcategoryKey ??
        merchantDictionary.subcategoryKey ??
        keywordCategory.subcategoryKey);
    const categoryIdHint = useKeywordCategory
      ? undefined
      : (userRule.categoryIdHint ?? merchantDictionary.categoryIdHint);
    const subcategoryIdHint = useKeywordCategory
      ? undefined
      : (userRule.subcategoryIdHint ?? merchantDictionary.subcategoryIdHint);
    const userRuleCategoryUsed =
      !useKeywordCategory &&
      (userRule.categoryKey !== undefined ||
        userRule.subcategoryKey !== undefined ||
        userRule.categoryIdHint !== undefined ||
        userRule.subcategoryIdHint !== undefined);
    const userRuleTypeUsed =
      !typeRecognition.explicit && userRule.type !== undefined;

    let accountKey = explicitAccounts?.accountKey;
    let accountIdHint = explicitAccounts?.accountIdHint;
    let accountEvidence: ConfidenceEvidence['accountEvidence'] =
      explicitAccounts?.accountKey === undefined ? 'MISSING' : 'EXPLICIT';
    if (accountKey === undefined && userRule.accountKey !== undefined) {
      accountKey = userRule.accountKey;
      accountIdHint = userRule.accountIdHint;
      accountEvidence = 'INFERRED';
    }
    const userRuleAccountUsed =
      explicitAccounts?.accountKey === undefined &&
      userRule.accountKey !== undefined &&
      accountIdHint === userRule.accountIdHint;
    if (accountKey === undefined && context.recentAccountKey !== undefined) {
      accountKey = context.recentAccountKey;
      accountIdHint = context.accounts?.find(
        account => account.type === context.recentAccountKey,
      )?.id;
      accountEvidence = 'INFERRED';
    }

    if (
      type === 'TRANSFER' &&
      accountKey === undefined &&
      explicitAccounts?.targetAccountKey !== undefined &&
      context.recentAccountKey !== undefined
    ) {
      accountKey = context.recentAccountKey;
      accountIdHint = context.accounts?.find(
        account => account.type === context.recentAccountKey,
      )?.id;
      accountEvidence = 'INFERRED';
    }

    // 12. 项目与标签仅作为候选建议，不自动创建项目或标签
    const projectAndTags = inferProjectAndTags(segment);
    const ambiguityReasons: string[] = [];
    addUnique(ambiguityReasons, amount.ambiguityReasons);
    addUnique(ambiguityReasons, keywordCategory.ambiguityReasons);
    if (merchantRecognition.personalRecipient) {
      ambiguityReasons.push('个人收款或付款对象无法可靠推断消费分类');
    }
    if (merchantRecognition.broadMerchant) {
      ambiguityReasons.push('综合商户可能对应多种商品分类');
    }
    if (accountEvidence === 'INFERRED') {
      ambiguityReasons.push('未明确支付账户，暂用最近账户');
    }
    if (
      typeRecognition.risk === 'SPECIAL' &&
      !ambiguityReasons.some(reason => /退款|报销|还款|关联/u.test(reason))
    ) {
      ambiguityReasons.push('特殊交易类型需要人工确认');
    }

    const preliminary = {
      type,
      amountMinor: amount.amountMinor,
      occurredAt: dateTime.occurredAt,
      categoryKey,
      categoryIdHint,
      accountKey,
      accountIdHint,
      targetAccountKey: explicitAccounts?.targetAccountKey,
    };
    const missingFields = missingFieldsFor(preliminary);
    const risks = [...riskForAmbiguities(ambiguityReasons)];
    if (merchantRecognition.personalRecipient) {
      risks.push('PERSONAL_RECIPIENT');
    }
    if (merchantRecognition.broadMerchant) {
      risks.push('BROAD_MERCHANT');
    }
    if (typeRecognition.risk === 'RECHARGE') {
      risks.push('RECHARGE');
    }
    if (typeRecognition.risk === 'SPECIAL') {
      risks.push('SPECIAL_TYPE');
    }
    if (
      requiresCategory(type) &&
      categoryKey === undefined &&
      categoryIdHint === undefined
    ) {
      risks.push('MISSING_CATEGORY');
    }

    // 13. 置信度
    const confidence = calculateConfidence({
      hasAmount: amount.amountMinor !== undefined,
      hasType: type !== undefined,
      hasCategory: categoryKey !== undefined || categoryIdHint !== undefined,
      hasSubcategory:
        subcategoryKey !== undefined || subcategoryIdHint !== undefined,
      accountEvidence,
      hasTargetAccount: explicitAccounts?.targetAccountKey !== undefined,
      explicitDateOrTime: dateTime.explicitDateOrTime,
      hasMerchant:
        merchantRecognition.merchantRawName !== undefined ||
        merchantDictionary.merchantRawName !== undefined,
      hasProjectOrTags:
        projectAndTags.projectName !== undefined ||
        projectAndTags.tags.length > 0,
      explicitTransactionCue: hasExplicitTransactionCue(segment),
      type,
      risks,
    });

    const userRuleContributed =
      userRule.matched &&
      (userRuleTypeUsed || userRuleCategoryUsed || userRuleAccountUsed);
    const suggestionSource = useKeywordCategory
      ? 'EXPLICIT_TEXT'
      : userRuleContributed
        ? userRule.learnedFromCorrections === true &&
          userRule.ruleType === 'MERCHANT'
          ? 'LEARNED_MERCHANT'
          : 'USER_RULE'
        : merchantDictionary.matched
          ? 'MERCHANT_DICTIONARY'
          : keywordCategory.categoryKey !== undefined
            ? 'COMMON_KEYWORD'
            : 'DEFAULT';

    const candidate: ParsedTransactionCandidate = {
      type,
      amountMinor: amount.amountMinor,
      currency: 'CNY',
      occurredAt: dateTime.occurredAt,
      categoryKey,
      subcategoryKey,
      accountKey,
      targetAccountKey: explicitAccounts?.targetAccountKey,
      merchantRawName:
        merchantRecognition.merchantRawName ??
        merchantDictionary.merchantRawName,
      projectName: projectAndTags.projectName,
      tags: projectAndTags.tags,
      confidence,
      missingFields,
      ambiguityReasons,
      originalText: value.trim(),
      sourceText: segment,
      categoryAlternatives: keywordCategory.alternatives,
      confidenceLevel: confidenceLevelFor(confidence),
      suggestionSource,
      categoryIdHint,
      subcategoryIdHint,
      accountIdHint,
      merchantIdHint: merchantDictionary.merchantIdHint,
      matchedRuleId: userRuleContributed ? userRule.ruleId : undefined,
      matchedRuleType: userRuleContributed ? userRule.ruleType : undefined,
      matchedRulePattern: userRuleContributed
        ? userRule.rulePattern
        : undefined,
      matchedRulePriority: userRuleContributed
        ? userRule.rulePriority
        : undefined,
    };
    return candidate;
  });

  // 14 is deliberately handled by the confirmation/pending UI. Parsing never
  // writes to storage or silently confirms a transaction.
  return { originalText: value, normalizedText, candidates };
}

export type {
  ParsedTransactionCandidate,
  TextParsingContext,
  TextParsingResult,
} from './types';
export { confidenceLevelFor } from './types';
export { parseAmount } from './parsers/amountParser';
export { parseDateTime } from './parsers/dateTimeParser';
export { normalizeChineseTransactionText } from './normalizers/normalizeText';
