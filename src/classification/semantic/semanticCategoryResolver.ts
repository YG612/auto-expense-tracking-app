import {
  SEMANTIC_CATEGORY_ONTOLOGY,
  SEMANTIC_TRANSACTION_RISKS,
} from './semanticOntology';
import type {
  SemanticCategoryAlternative,
  SemanticCategoryProposal,
  SemanticCategoryProposalCollection,
  SemanticCategoryResolution,
  SemanticCategoryResolveOptions,
  SemanticConceptDefinition,
  SemanticEvidence,
  SemanticProposalKind,
  SemanticRiskSignal,
  SuppressedSemanticEvidence,
} from './types';

const EXPLICIT_PROPOSAL_KINDS: ReadonlySet<SemanticProposalKind> = new Set([
  'EXPLICIT_SERVICE',
  'EXPLICIT_ITEM',
  'EXPLICIT_ACTIVITY',
]);

const NEGATION_BEFORE_CONCEPT =
  /(?:没有(?:去|到|在)?|没(?:有|去|到|在)?|未(?:去|到|在)?|不(?:是|去|到|在)?|并非|取消(?:去|到)?)\s*$/u;
const NEGATION_AFTER_CONCEPT =
  /^[^，。；]{0,12}(?:(?:但|可是|不过)\s*)?(?:没有?去|没去|未去|取消(?:了|行程)?|没有?消费|没消费)/u;
const VENUE_RELATION_BEFORE = /(?:在|去|到|来到|进|逛|从)\s*$/u;
const VENUE_CONSUMPTION_AFTER =
  /^(?:消费|花(?:了|费)?|付(?:了|款)?|支付|结账|买单|上网|包夜|开黑|唱歌|k歌|看电影|观影|玩|健身|游泳|瑜伽|吃饭|用餐|挂号|看病|就医|买)/iu;
const VENUE_AS_OBJECT =
  /(?:代金券|优惠券|会员卡|充值卡|礼品卡|股票|基金|债券|周边|加盟权)/u;
const ITEM_PURCHASE_BEFORE =
  /(?:买|购买|购入|下单|入手|添置|点|换)(?:了)?(?:\d+|[零〇一二两三四五六七八九十半]+)?(?:个|瓶|包|盒|台|部|本|件|斤|份|杯|支|条|套)?\s*$/u;
const ITEM_CONSUMPTION_BEFORE =
  /(?:吃|喝|服用)(?:了)?(?:\d+|[零〇一二两三四五六七八九十半]+)?(?:个|瓶|包|盒|份|杯|片|粒)?\s*$/u;
const ITEM_SOLD_TO_SPEAKER_BEFORE = /卖给我(?:的)?(?:二手)?\s*$/u;
const ITEM_NON_PURCHASE_ROLE_BEFORE =
  /(?:用|使用|拿|带|借|修|修理|维修|退|退还|出租|租用)(?:了|着|的)?\s*$/u;
const NON_PURCHASE_ITEM_ROLE =
  /(?:修(?:理|复|补)?|维修|退(?!款|费)|退还|退掉|出租|租(?:用|借)?|借(?:用)?)(?:了)?(?:\d+|[零〇一二两三四五六七八九十半]+)?(?:台|部|个|件|本|辆|套)?(?:电脑|手机|设备|商品|货物|物品|耳机|鼠标|键盘|书|车|房|衣服)/u;
const ITEM_IMMEDIATE_PRICE_AFTER =
  /^(?:\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块)/u;

const MULTI_EVENT_CONNECTOR = /又|另外|然后|随后|同时|以及|再(?:去|买|付|花)/u;
const EXPLICIT_MONEY =
  /(?:\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块)/gu;

type MutableProposal = {
  categoryKey: string;
  subcategoryKey?: string;
  proposalKind: SemanticProposalKind;
  score: number;
  confidence: number;
  explicit: boolean;
  source: 'SEMANTIC_ONTOLOGY';
  evidence: SemanticEvidence[];
};

function normalizeSemanticText(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/gu, ' ');
}

function allMatches(
  text: string,
  patterns: readonly RegExp[],
): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g')
      ? pattern.flags
      : `${pattern.flags}g`;
    const globalPattern = new RegExp(pattern.source, flags);
    for (const match of text.matchAll(globalPattern)) {
      matches.push(match);
    }
  }
  return matches.sort(
    (left, right) =>
      left.index - right.index || right[0].length - left[0].length,
  );
}

function isNegated(text: string, start: number, end: number): boolean {
  const prefix = text.slice(Math.max(0, start - 8), start);
  const suffix = text.slice(end, Math.min(text.length, end + 20));
  return (
    NEGATION_BEFORE_CONCEPT.test(prefix) || NEGATION_AFTER_CONCEPT.test(suffix)
  );
}

function hasVenueUsageContext(
  text: string,
  start: number,
  end: number,
): boolean {
  const prefix = text.slice(Math.max(0, start - 8), start);
  const suffix = text.slice(end, Math.min(text.length, end + 18));
  const localContext = text.slice(
    Math.max(0, start - 4),
    Math.min(text.length, end + 12),
  );
  if (VENUE_AS_OBJECT.test(localContext)) {
    return false;
  }
  return (
    VENUE_RELATION_BEFORE.test(prefix) || VENUE_CONSUMPTION_AFTER.test(suffix)
  );
}

function hasPurchasedItemContext(
  text: string,
  start: number,
  end: number,
): boolean {
  const prefix = text.slice(Math.max(0, start - 18), start);
  const suffix = text.slice(end, Math.min(text.length, end + 14));
  if (ITEM_NON_PURCHASE_ROLE_BEFORE.test(prefix)) {
    return false;
  }
  return (
    ITEM_PURCHASE_BEFORE.test(prefix) ||
    ITEM_CONSUMPTION_BEFORE.test(prefix) ||
    ITEM_SOLD_TO_SPEAKER_BEFORE.test(prefix) ||
    ITEM_IMMEDIATE_PRICE_AFTER.test(suffix)
  );
}

function patternMatches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function conceptContextMatches(
  concept: SemanticConceptDefinition,
  text: string,
): boolean {
  if (
    concept.excludedContextAny?.some(pattern =>
      patternMatches(pattern, text),
    ) === true
  ) {
    return false;
  }
  return (
    concept.requiredContextAny === undefined ||
    concept.requiredContextAny.some(pattern => patternMatches(pattern, text))
  );
}

function proposalConfidence(
  proposalKind: SemanticProposalKind,
  evidenceCount: number,
): number {
  const base: Record<SemanticProposalKind, number> = {
    EXPLICIT_SERVICE: 0.95,
    EXPLICIT_ITEM: 0.94,
    EXPLICIT_ACTIVITY: 0.92,
    VENUE_DEFAULT: 0.78,
  };
  return Math.min(
    0.98,
    base[proposalKind] + Math.max(0, evidenceCount - 1) * 0.01,
  );
}

function proposalKey(
  categoryKey: string,
  subcategoryKey: string | undefined,
): string {
  return `${categoryKey}\u0000${subcategoryKey ?? ''}`;
}

function mostSpecificKind(
  evidence: readonly SemanticEvidence[],
): SemanticProposalKind {
  const rank: Record<SemanticProposalKind, number> = {
    EXPLICIT_SERVICE: 4,
    EXPLICIT_ITEM: 3,
    EXPLICIT_ACTIVITY: 2,
    VENUE_DEFAULT: 1,
  };
  return evidence.reduce(
    (best, current) =>
      rank[current.proposalKind] > rank[best] ? current.proposalKind : best,
    evidence[0].proposalKind,
  );
}

function buildProposals(
  definitions: readonly SemanticConceptDefinition[],
  normalizedText: string,
): {
  proposals: SemanticCategoryProposal[];
  suppressedEvidence: SuppressedSemanticEvidence[];
} {
  const grouped = new Map<string, MutableProposal>();
  const suppressedEvidence: SuppressedSemanticEvidence[] = [];

  for (const concept of definitions) {
    if (!conceptContextMatches(concept, normalizedText)) {
      continue;
    }
    let selected:
      { evidence: SemanticEvidence; matchedLength: number } | undefined;
    for (const match of allMatches(normalizedText, concept.aliases)) {
      const start = match.index;
      const end = start + match[0].length;
      const evidence: SemanticEvidence = {
        conceptId: concept.id,
        conceptLabel: concept.label,
        conceptKind: concept.kind,
        role: concept.role,
        matchedText: match[0],
        start,
        end,
        categoryKey: concept.categoryKey,
        subcategoryKey: concept.subcategoryKey,
        proposalKind: concept.proposalKind,
        source: 'SEMANTIC_ONTOLOGY',
      };

      if (isNegated(normalizedText, start, end)) {
        suppressedEvidence.push({
          ...evidence,
          suppressedBy: 'NEGATION',
        });
        continue;
      }
      if (
        concept.kind === 'VENUE' &&
        !hasVenueUsageContext(normalizedText, start, end)
      ) {
        continue;
      }
      if (
        concept.kind === 'ITEM' &&
        !hasPurchasedItemContext(normalizedText, start, end)
      ) {
        continue;
      }
      selected ??= { evidence, matchedLength: match[0].length };
    }

    if (selected === undefined) {
      continue;
    }
    const { evidence, matchedLength } = selected;

    const key = proposalKey(concept.categoryKey, concept.subcategoryKey);
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, {
        categoryKey: concept.categoryKey,
        subcategoryKey: concept.subcategoryKey,
        proposalKind: concept.proposalKind,
        score: concept.baseScore + Math.min(20, matchedLength),
        confidence: proposalConfidence(concept.proposalKind, 1),
        explicit: EXPLICIT_PROPOSAL_KINDS.has(concept.proposalKind),
        source: 'SEMANTIC_ONTOLOGY',
        evidence: [evidence],
      });
      continue;
    }

    existing.evidence.push(evidence);
    existing.proposalKind = mostSpecificKind(existing.evidence);
    existing.score = Math.max(
      existing.score,
      concept.baseScore + Math.min(20, matchedLength),
    );
    existing.score += Math.min(12, existing.evidence.length * 2);
    existing.explicit = existing.evidence.some(item =>
      EXPLICIT_PROPOSAL_KINDS.has(item.proposalKind),
    );
    existing.confidence = proposalConfidence(
      existing.proposalKind,
      existing.evidence.length,
    );
  }

  return {
    proposals: [...grouped.values()].sort(
      (left, right) =>
        right.score - left.score ||
        left.categoryKey.localeCompare(right.categoryKey),
    ),
    suppressedEvidence,
  };
}

function collectRiskSignals(
  normalizedText: string,
  options: SemanticCategoryResolveOptions,
): SemanticRiskSignal[] {
  const riskSignals: SemanticRiskSignal[] = [];
  if (options.transactionType !== 'EXPENSE') {
    riskSignals.push({
      ruleId: 'transaction.type',
      kind: 'NON_EXPENSE_TRANSACTION',
      reason: `交易类型为 ${options.transactionType ?? 'UNKNOWN'}，支出语义分类器主动弃权`,
    });
  }

  for (const definition of options.riskDefinitions ??
    SEMANTIC_TRANSACTION_RISKS) {
    definition.pattern.lastIndex = 0;
    const match = definition.pattern.exec(normalizedText);
    if (match !== null) {
      riskSignals.push({
        ruleId: definition.id,
        kind: definition.kind,
        matchedText: match[0],
        reason: definition.reason,
      });
    }
  }
  return riskSignals;
}

export function collectSemanticCategoryProposals(
  text: string,
  options: SemanticCategoryResolveOptions = {},
): SemanticCategoryProposalCollection {
  const normalizedText = normalizeSemanticText(text);
  const { proposals, suppressedEvidence } = buildProposals(
    options.ontology ?? SEMANTIC_CATEGORY_ONTOLOGY,
    normalizedText,
  );
  return {
    normalizedText,
    proposals,
    suppressedEvidence,
    riskSignals: collectRiskSignals(normalizedText, options),
  };
}

function toAlternative(
  proposal: SemanticCategoryProposal,
): SemanticCategoryAlternative {
  return {
    categoryKey: proposal.categoryKey,
    subcategoryKey: proposal.subcategoryKey,
    score: proposal.score,
    confidence: proposal.confidence,
    evidence: proposal.evidence,
  };
}

function hasMultipleExplicitMoneyEvents(
  normalizedText: string,
  proposals: readonly SemanticCategoryProposal[],
): boolean {
  const explicitParents = new Set(
    proposals
      .filter(proposal => proposal.explicit)
      .map(proposal => proposal.categoryKey),
  );
  if (explicitParents.size < 2 || !MULTI_EVENT_CONNECTOR.test(normalizedText)) {
    return false;
  }
  EXPLICIT_MONEY.lastIndex = 0;
  return [...normalizedText.matchAll(EXPLICIT_MONEY)].length >= 2;
}

export function resolveSemanticCategory(
  text: string,
  options: SemanticCategoryResolveOptions = {},
): SemanticCategoryResolution {
  const collection = collectSemanticCategoryProposals(text, options);
  const allEvidence = collection.proposals.flatMap(
    proposal => proposal.evidence,
  );

  if (collection.riskSignals.length > 0) {
    return {
      status: 'ABSTAINED',
      explicit: false,
      confidence: 0,
      alternatives: collection.proposals.map(toAlternative),
      evidence: allEvidence,
      suppressedEvidence: collection.suppressedEvidence,
      riskSignals: collection.riskSignals,
      ambiguityReasons: collection.riskSignals.map(signal => signal.reason),
    };
  }

  if (NON_PURCHASE_ITEM_ROLE.test(collection.normalizedText)) {
    return {
      status: 'AMBIGUOUS',
      explicit: false,
      confidence: 0,
      alternatives: collection.proposals.map(toAlternative),
      evidence: allEvidence,
      suppressedEvidence: collection.suppressedEvidence,
      riskSignals: [],
      ambiguityReasons: [
        '文本描述修理、退还、租用或借用等非购买关系，不能按场所默认用途自动分类',
      ],
    };
  }

  if (collection.proposals.length === 0) {
    return {
      status: 'NO_MATCH',
      explicit: false,
      confidence: 0,
      alternatives: [],
      evidence: [],
      suppressedEvidence: collection.suppressedEvidence,
      riskSignals: [],
      ambiguityReasons: [],
    };
  }

  if (
    hasMultipleExplicitMoneyEvents(
      collection.normalizedText,
      collection.proposals,
    )
  ) {
    return {
      status: 'AMBIGUOUS',
      explicit: false,
      confidence: 0,
      alternatives: collection.proposals.map(toAlternative),
      evidence: allEvidence,
      suppressedEvidence: collection.suppressedEvidence,
      riskSignals: [],
      ambiguityReasons: ['一句话中可能包含多笔不同用途的交易，应先拆分后分类'],
    };
  }

  const winner = collection.proposals[0];
  const runnerUp = collection.proposals[1];
  if (
    runnerUp !== undefined &&
    runnerUp.categoryKey !== winner.categoryKey &&
    runnerUp.score >= winner.score - 8
  ) {
    return {
      status: 'AMBIGUOUS',
      explicit: false,
      confidence: 0,
      alternatives: collection.proposals.map(toAlternative),
      evidence: allEvidence,
      suppressedEvidence: collection.suppressedEvidence,
      riskSignals: [],
      ambiguityReasons: ['检测到强度接近且用途不同的分类证据，需要用户确认'],
    };
  }

  return {
    status: 'RESOLVED',
    categoryKey: winner.categoryKey,
    subcategoryKey: winner.subcategoryKey,
    explicit: winner.explicit,
    confidence: winner.confidence,
    source: 'SEMANTIC_ONTOLOGY',
    proposal: winner,
    alternatives: collection.proposals.slice(1).map(toAlternative),
    evidence: winner.evidence,
    suppressedEvidence: collection.suppressedEvidence,
    riskSignals: [],
    ambiguityReasons: [],
  };
}
