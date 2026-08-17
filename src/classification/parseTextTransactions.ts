import type { AccountType, TransactionType } from '../domain/entities';
import { simplifyBookkeepingClassification } from '../domain/policies/simplifiedBookkeepingPolicy';
import { assertBookkeepingTextWithinLimit } from '../domain/policies/bookkeepingInputPolicy';
import {
  calculateConfidence,
  type ConfidenceEvidence,
} from './confidence/calculateConfidence';
import { normalizeChineseTransactionText } from './normalizers/normalizeText';
import { parseAmount } from './parsers/amountParser';
import { parseDateTime } from './parsers/dateTimeParser';
import { analyzeTransactionEvents } from './parsers/splitTransactions';
import { resolveSemanticCategory } from './semantic';
import {
  applyExistingUserRules,
  applyMerchantDictionary,
  hasCategorySuggestion,
  hasExplicitTransactionCue,
  inferTransactionTypeFromCategorySuggestion,
  inferProjectAndTags,
  isCategorySuggestionCompatible,
  recognizeAccounts,
  recognizeCategory,
  recognizeMerchant,
  recognizeTransactionType,
} from './rules/localRules';
import {
  type CandidateAlternative,
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
  if (
    ambiguityReasons.some(reason =>
      /单价|实付金额|价格或优惠金额/u.test(reason),
    )
  ) {
    risks.push('AMBIGUOUS_AMOUNT');
  }
  if (
    ambiguityReasons.some(reason =>
      /总价与逐笔金额不一致|千分位或交易分隔符/u.test(reason),
    )
  ) {
    risks.push('EVENT_AMBIGUITY');
  }
  return risks;
}

export function parseTextTransactions(
  value: string,
  context: TextParsingContext,
): TextParsingResult {
  assertBookkeepingTextWithinLimit(value);

  if (Number.isNaN(context.referenceDate.getTime())) {
    throw new Error('referenceDate 必须是有效日期。');
  }

  // 1. 标准化
  const normalizedText = normalizeChineseTransactionText(value);
  // 2. 先解析事件边界，再对每个已结算事件单独分类。旧事件、失败事件
  // 和总价只提供上下文，不能污染下一笔交易的类型或重复生成候选。
  const transactionEvents = analyzeTransactionEvents(normalizedText);
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

  const candidates = transactionEvents.segments.map(transactionEvent => {
    const segment = transactionEvent.text;
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
    const type = typeRecognition.explicit
      ? typeRecognition.type
      : (userRule.type ??
        inferTransactionTypeFromCategorySuggestion(
          userRule,
          context.categories,
        ) ??
        inferTransactionTypeFromCategorySuggestion(
          merchantDictionary,
          context.categories,
        ) ??
        typeRecognition.type);
    // 10/11. 一级与二级分类；用户本次明确表达优先于历史规则
    const keywordCategory = recognizeCategory(segment, type);
    const semanticCategory =
      type === 'EXPENSE'
        ? resolveSemanticCategory(segment, { transactionType: 'EXPENSE' })
        : undefined;
    const semanticCategoryResolved = semanticCategory?.status === 'RESOLVED';
    const semanticCategoryBlocksFallback =
      semanticCategory?.status === 'AMBIGUOUS' ||
      semanticCategory?.status === 'ABSTAINED';
    // Role-aware item/service/activity evidence is more specific than the old
    // flat keyword table. A venue default remains below explicit text and
    // personalization, so “网吧买水” is food while “网吧消费” is entertainment.
    const semanticExplicitCategoryUsed =
      semanticCategoryResolved && semanticCategory.explicit;
    const keywordExplicitCategoryUsed =
      !semanticCategoryBlocksFallback &&
      !semanticExplicitCategoryUsed &&
      keywordCategory.explicit;
    const userRuleCategoryCompatible = isCategorySuggestionCompatible(
      userRule,
      type,
      context.categories,
    );
    const merchantCategoryCompatible = isCategorySuggestionCompatible(
      merchantDictionary,
      type,
      context.categories,
    );
    const userRuleCategoryUsed =
      !semanticCategoryBlocksFallback &&
      !semanticExplicitCategoryUsed &&
      !keywordExplicitCategoryUsed &&
      userRuleCategoryCompatible;
    const merchantDictionaryCategoryUsed =
      !semanticCategoryBlocksFallback &&
      !semanticExplicitCategoryUsed &&
      !keywordExplicitCategoryUsed &&
      !userRuleCategoryUsed &&
      merchantCategoryCompatible;
    const semanticDefaultCategoryUsed =
      !semanticCategoryBlocksFallback &&
      semanticCategoryResolved &&
      !semanticExplicitCategoryUsed &&
      !keywordExplicitCategoryUsed &&
      !userRuleCategoryUsed &&
      !merchantDictionaryCategoryUsed;
    const semanticCategoryUsed =
      semanticExplicitCategoryUsed || semanticDefaultCategoryUsed;
    const keywordFallbackCategoryUsed =
      !semanticCategoryBlocksFallback &&
      !semanticCategoryUsed &&
      !keywordExplicitCategoryUsed &&
      !userRuleCategoryUsed &&
      !merchantDictionaryCategoryUsed &&
      keywordCategory.categoryKey !== undefined;
    const keywordCategoryUsed =
      keywordExplicitCategoryUsed || keywordFallbackCategoryUsed;
    const categoryKey = semanticExplicitCategoryUsed
      ? semanticCategory?.categoryKey
      : keywordExplicitCategoryUsed
        ? keywordCategory.categoryKey
        : userRuleCategoryUsed
          ? userRule.categoryKey
          : merchantDictionaryCategoryUsed
            ? merchantDictionary.categoryKey
            : semanticDefaultCategoryUsed
              ? semanticCategory?.categoryKey
              : semanticCategoryBlocksFallback
                ? undefined
                : keywordCategory.categoryKey;
    const subcategoryKey = semanticExplicitCategoryUsed
      ? semanticCategory?.subcategoryKey
      : keywordExplicitCategoryUsed
        ? keywordCategory.subcategoryKey
        : userRuleCategoryUsed
          ? userRule.subcategoryKey
          : merchantDictionaryCategoryUsed
            ? merchantDictionary.subcategoryKey
            : semanticDefaultCategoryUsed
              ? semanticCategory?.subcategoryKey
              : semanticCategoryBlocksFallback
                ? undefined
                : keywordCategory.subcategoryKey;
    const categoryIdHint = userRuleCategoryUsed
      ? userRule.categoryIdHint
      : merchantDictionaryCategoryUsed
        ? merchantDictionary.categoryIdHint
        : undefined;
    const subcategoryIdHint = userRuleCategoryUsed
      ? userRule.subcategoryIdHint
      : merchantDictionaryCategoryUsed
        ? merchantDictionary.subcategoryIdHint
        : undefined;
    const ignoredIncompatibleHistory =
      (hasCategorySuggestion(userRule) && !userRuleCategoryCompatible) ||
      (hasCategorySuggestion(merchantDictionary) &&
        !merchantCategoryCompatible);
    const userRuleTypeUsed =
      !typeRecognition.explicit && userRule.type !== undefined;

    let accountKey = explicitAccounts?.accountKey;
    let accountIdHint = explicitAccounts?.accountIdHint;
    let accountResolutionSource: ConfidenceEvidence['accountResolutionSource'] =
      explicitAccounts?.accountKey === undefined ? 'MISSING' : 'EXPLICIT_TEXT';
    if (accountKey === undefined && userRule.accountKey !== undefined) {
      accountKey = userRule.accountKey;
      accountIdHint = userRule.accountIdHint;
      accountResolutionSource = 'USER_RULE';
    }
    const userRuleAccountUsed =
      explicitAccounts?.accountKey === undefined &&
      userRule.accountKey !== undefined &&
      accountIdHint === userRule.accountIdHint;
    const recentAccount = context.accounts?.find(
      account => account.type === context.recentAccountKey,
    );
    if (accountKey === undefined && recentAccount !== undefined) {
      accountKey = recentAccount.type;
      accountIdHint = recentAccount.id;
      accountResolutionSource = 'RECENT_FALLBACK';
    }

    if (
      type === 'TRANSFER' &&
      accountKey === undefined &&
      explicitAccounts?.targetAccountKey !== undefined &&
      recentAccount !== undefined
    ) {
      accountKey = recentAccount.type;
      accountIdHint = recentAccount.id;
      accountResolutionSource = 'RECENT_FALLBACK';
    }

    // 12. 项目与标签仅作为候选建议，不自动创建项目或标签
    const projectAndTags = inferProjectAndTags(segment);
    const advisoryReasons: string[] = [];
    if (ignoredIncompatibleHistory) {
      advisoryReasons.push('历史分类与当前交易类型不一致，已安全忽略');
    }
    if (accountResolutionSource === 'RECENT_FALLBACK') {
      const fallbackAccountName = context.accounts?.find(
        account => account.id === accountIdHint || account.type === accountKey,
      )?.name;
      advisoryReasons.push(
        fallbackAccountName === undefined
          ? '账户按最近使用填入'
          : `账户按最近使用填为${fallbackAccountName}`,
      );
    }
    const ambiguityReasons: string[] = [];
    addUnique(ambiguityReasons, transactionEvent.ambiguityReasons);
    addUnique(ambiguityReasons, amount.ambiguityReasons);
    const higherLevelCategoryResolved =
      semanticCategoryUsed ||
      userRuleCategoryUsed ||
      merchantDictionaryCategoryUsed;
    const keywordAmbiguityRelevant =
      semanticCategoryBlocksFallback ||
      keywordCategoryUsed ||
      (!higherLevelCategoryResolved &&
        keywordCategory.categoryKey === undefined);
    if (keywordAmbiguityRelevant) {
      addUnique(ambiguityReasons, keywordCategory.ambiguityReasons);
    }
    if (
      semanticCategory?.status === 'AMBIGUOUS' ||
      semanticCategory?.status === 'ABSTAINED'
    ) {
      addUnique(ambiguityReasons, semanticCategory.ambiguityReasons);
    }
    if (merchantRecognition.personalRecipient) {
      ambiguityReasons.push('个人收款或付款对象无法可靠推断消费分类');
    }
    if (merchantRecognition.broadMerchant) {
      ambiguityReasons.push('综合商户可能对应多种商品分类');
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
    if (amount.amountMinor === undefined) {
      risks.push('MISSING_AMOUNT');
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
      amountEvidence: amount.evidence,
      hasType: type !== undefined,
      hasCategory: categoryKey !== undefined || categoryIdHint !== undefined,
      hasSubcategory:
        subcategoryKey !== undefined || subcategoryIdHint !== undefined,
      accountResolutionSource,
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
    const suggestionSource = semanticCategoryUsed
      ? 'SEMANTIC_ONTOLOGY'
      : keywordExplicitCategoryUsed
        ? 'EXPLICIT_TEXT'
        : userRuleContributed
          ? userRule.learnedFromCorrections === true &&
            userRule.ruleType === 'MERCHANT'
            ? 'LEARNED_MERCHANT'
            : 'USER_RULE'
          : merchantDictionaryCategoryUsed
            ? 'MERCHANT_DICTIONARY'
            : keywordFallbackCategoryUsed
              ? 'COMMON_KEYWORD'
              : 'DEFAULT';

    const semanticCategoryAlternatives: CandidateAlternative[] =
      semanticCategory?.status === 'AMBIGUOUS'
        ? semanticCategory.alternatives.map(alternative => ({
            label:
              alternative.evidence[0]?.conceptLabel ??
              alternative.subcategoryKey ??
              alternative.categoryKey,
            categoryKey: alternative.categoryKey,
            subcategoryKey: alternative.subcategoryKey,
          }))
        : [];
    const categoryAlternatives: CandidateAlternative[] = [
      ...(keywordAmbiguityRelevant ? keywordCategory.alternatives : []),
      ...semanticCategoryAlternatives,
    ].filter(
      (alternative, index, all) =>
        all.findIndex(
          candidateAlternative =>
            candidateAlternative.type === alternative.type &&
            candidateAlternative.categoryKey === alternative.categoryKey &&
            candidateAlternative.subcategoryKey === alternative.subcategoryKey,
        ) === index,
    );

    const candidate: ParsedTransactionCandidate = {
      ...simplifyBookkeepingClassification({
        type,
        categoryKey,
        storedValueRecharge: typeRecognition.risk === 'RECHARGE',
      }),
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
      advisoryReasons,
      accountResolutionSource,
      originalText: value.trim(),
      sourceText: segment,
      categoryAlternatives,
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
