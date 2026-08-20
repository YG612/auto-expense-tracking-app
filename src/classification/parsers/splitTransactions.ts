import { parseAmount, type NumericMention } from './amountParser';

const POTENTIAL_BOUNDARY =
  /,|(?:然后|接着|随后|后来|但是|不过|可是|却|但(?=没|未|取消|改为))/gu;
const NUMBER_TOKEN =
  '(?:\\d+(?:\\.\\d{1,2})?|[零〇一二两三四五六七八九十百千万]+(?:点[零〇一二两三四五六七八九]{1,2})?)';
const AGGREGATE_PATTERN = new RegExp(
  `(?:总共|一共|总计|合计|共计|共)\\s*(${NUMBER_TOKEN})\\s*(元|块钱?|块)?`,
  'giu',
);
const EVENT_ANCHOR_SOURCE = String.raw`(?:退款手续费|信用卡还款|花呗还款|朋友还我|还钱给我|归还给我|借款到账|收到借款|早餐|早饭|午饭|午餐|晚饭|晚餐|夜宵|宵夜|打车|出租车|网约车|地铁|公交|高铁|火车|动车|飞机|机票|酒店|宾馆|民宿|房租|水果|牛奶|鸡蛋|面包|大米|工资|薪资|薪水|奖金|年终奖|奖学金|兼职收入|项目补助|理财收益|投资收益|利息收入|二手出售|收到红包|生活费|退款|报销|还款|借入|借出|借给|转入|转到|转账|提现|存入|充值|手续费|收款成功(?=\s*(?:[¥￥]?\s*)?(?:\d|[零〇一二两三四五六七八九十百千万]))|收到(?=\s*(?:了\s*)?(?:[¥￥]?\s*)?(?:\d|[零〇一二两三四五六七八九十百千万]))|买了?|购买|花了?|付了?|支付(?!宝)|消费|扣款|订了?|交了?|赚了?|挣了?|收入)`;
const EVENT_ANCHOR = new RegExp(EVENT_ANCHOR_SOURCE, 'gu');
const EVENT_ANCHOR_TEST = new RegExp(EVENT_ANCHOR_SOURCE, 'u');
const GENERIC_ACTION =
  /^(?:买了?|购买|花了?|付了?|支付|消费|扣款|订了?|交了?|赚了?|挣了?|收入)$/u;
const PAYMENT_COMPLEMENT =
  /^(?:花了?|付了?|支付|消费|扣款|交了?|赚了?|挣了?|收入)$/u;
const EXPLICIT_DO_NOT_RECORD =
  /(?:不要|别|不用|无需)(?:再)?(?:记|记录|记账|入账)|取消(?:这笔)?记账|撤销(?:这笔)?(?:记录|记账)/u;
const NON_FINAL_EVENT =
  /(?:没(?:有)?(?:(?:在|去).{0,20})?(?:买|花|付|支付|消费|扣款|收到|到账|入账|收款)|未(?:(?:在|去).{0,20})?(?:买|付款|支付|消费|扣款|收到|到账|入账|收款)|(?:退款|报销|还款|付款|支付|扣款|转账|交易|收入|收到|到账|入账|收款).{0,8}(?:失败|未成功|被拒|取消|撤销)|(?:失败|未成功|被拒|取消|撤销).{0,8}(?:退款|报销|还款|付款|支付|扣款|转账|交易|收入|收到|到账|入账|收款))/u;
const PLANNED_EVENT =
  /(?:(?:计划|准备|打算|预计|考虑|如果|可能会|待会(?:儿)?|将要).{0,24}(?:去|买|购买|花|付|支付|消费|退款|报销|还款|转账|收到|到账|入账|收款|早餐|午饭|晚饭|打车|酒店|网吧|网咖|电竞馆)|(?:本来|原本)?想(?:去|在|买|购买|花|付|支付|消费|收到|到账|入账|收款))/u;
const UNCERTAIN_INFLOW_EVENT =
  /(?:(?:是否|有没有|有没|会不会|能否|可否|等(?:到)?|待).{0,20}(?:收到|到账|入账|收款)|(?:收到|到账|入账|收款).{0,20}(?:了吗|了没|没有|吗|么|[？?]))/u;
const REVERSED_INFLOW_EVENT =
  /(?:收到|到账|入账|收款成功).{0,24}(?:退回|退还|撤回|冲正)/u;
const STALE_CONTEXT =
  /(?:为了|用于|用来).{0,20}(?:退款|报销|还款|转账)|(?:吃完|喝完|买完|付完|结束|完成|到账|失败|未成功|被拒|取消|撤销)(?:了)?(?:后|之后|以后)|(?:退款|报销|还款|工资|薪资|奖金|收入|早餐|午饭|晚饭|酒店).{0,8}后/u;
const AMBIGUOUS_NUMERIC_COMMA = /\d+,\d{3}(?:\D|$)/u;
const NUMERIC_COMMA_REASON =
  '数字之间的逗号可能是千分位或交易分隔符，请逐笔确认';
const AGGREGATE_MISMATCH_REASON =
  '总价与逐笔金额不一致，已保留明细并要求逐笔确认';

const NON_EVENT_CONTEXT =
  /今天|今日|昨天|昨晚|前天|明天|早上|早晨|上午|中午|下午|晚上|微信|微信支付|支付宝|信用卡|银行卡|储蓄卡|借记卡|花呗|现金|然后|接着|随后|后来|花了?|付了?|支付了?|消费了?|收(?:到)?的|实付|实际支付|应付|共计|总共|一共|总计|合计|原价|标价|售价|优惠|立减|减免|折扣|省了?|每|单价|元|块钱?|块|的|了/gu;

export type TransactionEventSegment = {
  text: string;
  ambiguityReasons: string[];
};

export type TransactionEventAnalysis = {
  segments: TransactionEventSegment[];
  suppressed: boolean;
};

type AggregateMention = {
  start: number;
  end: number;
  amountMinor: number;
};

type EventAnchorMatch = {
  start: number;
  end: number;
  raw: string;
  generic: boolean;
  paymentComplement: boolean;
};

type EventPiece = {
  text: string;
  hasAmount: boolean;
  substantive: boolean;
  paymentComplement: boolean;
  contextOnly: boolean;
};

type BaseExtraction = {
  segments: TransactionEventSegment[];
  discardedContext: boolean;
  suppressedEvent: boolean;
};

function textWithoutMentions(
  text: string,
  mentions: readonly NumericMention[],
): string {
  let result = '';
  let cursor = 0;
  for (const mention of [...mentions].sort(
    (left, right) => left.start - right.start,
  )) {
    result += text.slice(cursor, mention.start);
    cursor = Math.max(cursor, mention.end);
  }
  return `${result}${text.slice(cursor)}`;
}

function eventResidual(
  text: string,
  mentions: readonly NumericMention[],
): string {
  return textWithoutMentions(text, mentions)
    .replace(NON_EVENT_CONTEXT, '')
    .replace(/[\s,，。.！!？?;；:：\d]/gu, '');
}

function trimmedSegment(text: string): string {
  return text
    .trim()
    .replace(/^(?:又|再)\s*/u, '')
    .replace(/\s*(?:又|再)$/u, '')
    .replace(/^[.]+|[.]+$/gu, '')
    .trim();
}

function shouldSuppressEvent(text: string): boolean {
  return (
    NON_FINAL_EVENT.test(text) ||
    PLANNED_EVENT.test(text) ||
    UNCERTAIN_INFLOW_EVENT.test(text) ||
    REVERSED_INFLOW_EVENT.test(text)
  );
}

function aggregateMentions(text: string): AggregateMention[] {
  const mentions: AggregateMention[] = [];
  for (const match of text.matchAll(AGGREGATE_PATTERN)) {
    if (match.index === undefined) {
      continue;
    }
    const parsed = parseAmount(`总共${match[1]}${match[2] ?? ''}`);
    if (parsed.amountMinor === undefined) {
      continue;
    }
    mentions.push({
      start: match.index,
      end: match.index + match[0].length,
      amountMinor: parsed.amountMinor,
    });
  }
  return mentions;
}

function maskMentions(
  text: string,
  mentions: readonly AggregateMention[],
): string {
  let result = text;
  for (const mention of [...mentions].reverse()) {
    result = `${result.slice(0, mention.start)}${' '.repeat(
      mention.end - mention.start,
    )}${result.slice(mention.end)}`;
  }
  return result;
}

function potentialClauses(text: string): string[] {
  return text
    .replace(POTENTIAL_BOUNDARY, ',')
    .split(',')
    .map(trimmedSegment)
    .filter(value => value.length > 0);
}

function anchorsIn(text: string): EventAnchorMatch[] {
  return [...text.matchAll(EVENT_ANCHOR)].flatMap(match =>
    match.index === undefined
      ? []
      : [
          {
            start: match.index,
            end: match.index + match[0].length,
            raw: match[0],
            generic: GENERIC_ACTION.test(match[0]),
            paymentComplement: PAYMENT_COMPLEMENT.test(match[0]),
          },
        ],
  );
}

function pieceForRange(
  text: string,
  start: number,
  end: number,
  substantive: boolean,
  paymentComplement: boolean,
): EventPiece | undefined {
  const value = trimmedSegment(text.slice(start, end));
  if (value.length === 0) {
    return undefined;
  }
  const amount = parseAmount(value);
  const residual = eventResidual(value, amount.mentions);
  return {
    text: value,
    hasAmount: amount.amountMinor !== undefined,
    substantive,
    paymentComplement,
    contextOnly:
      amount.amountMinor === undefined && !substantive && residual.length === 0,
  };
}

function eventPiecesForClause(text: string): {
  pieces: EventPiece[];
  discardedContext: boolean;
} {
  const anchors = anchorsIn(text);
  if (anchors.length === 0) {
    const amount = parseAmount(text);
    const residual = eventResidual(text, amount.mentions);
    return {
      pieces: [
        {
          text,
          hasAmount: amount.amountMinor !== undefined,
          substantive: residual.length > 0,
          paymentComplement: amount.amountMinor !== undefined,
          contextOnly:
            amount.amountMinor === undefined && residual.length === 0,
        },
      ],
      discardedContext: false,
    };
  }

  const pieces: EventPiece[] = [];
  let groupStart = 0;
  let groupHasSubstantive = false;
  let discardedContext = false;

  for (const [index, anchor] of anchors.entries()) {
    const nextStart = anchors[index + 1]?.start ?? text.length;
    const window = text.slice(anchor.start, nextStart);
    const windowAmount = parseAmount(window);
    const groupBeforeAnchor = text.slice(groupStart, anchor.start);

    if (windowAmount.amountMinor !== undefined) {
      if (groupHasSubstantive) {
        const priorText = text.slice(groupStart, anchor.start);
        if (STALE_CONTEXT.test(priorText)) {
          discardedContext = true;
          groupStart = anchor.start;
          groupHasSubstantive = false;
        } else if (!anchor.generic && windowAmount.role !== 'TOTAL') {
          const priorPiece = pieceForRange(
            text,
            groupStart,
            anchor.start,
            true,
            false,
          );
          if (priorPiece !== undefined) {
            pieces.push(priorPiece);
          }
          groupStart = anchor.start;
          groupHasSubstantive = false;
        }
      } else if (STALE_CONTEXT.test(groupBeforeAnchor)) {
        discardedContext = true;
        groupStart = anchor.start;
      }

      const piece = pieceForRange(
        text,
        groupStart,
        nextStart,
        groupHasSubstantive || !anchor.generic,
        anchor.paymentComplement,
      );
      if (piece !== undefined) {
        pieces.push(piece);
      }
      groupStart = nextStart;
      groupHasSubstantive = false;
      continue;
    }

    if (!anchor.generic) {
      groupHasSubstantive = true;
    }
    const pendingText = text.slice(groupStart, nextStart);
    if (index < anchors.length - 1 && STALE_CONTEXT.test(pendingText)) {
      discardedContext = true;
      groupStart = nextStart;
      groupHasSubstantive = false;
    }
  }

  if (groupStart < text.length) {
    const remainder = text.slice(groupStart);
    const remainderAmount = parseAmount(remainder);
    const piece = pieceForRange(
      text,
      groupStart,
      text.length,
      groupHasSubstantive ||
        eventResidual(remainder, remainderAmount.mentions).length > 0,
      false,
    );
    if (piece !== undefined) {
      pieces.push(piece);
    }
  }

  if (!pieces.some(piece => piece.hasAmount)) {
    const wholeAmount = parseAmount(text);
    if (wholeAmount.amountMinor !== undefined) {
      return {
        pieces: [
          {
            text,
            hasAmount: true,
            substantive: true,
            paymentComplement: false,
            contextOnly: false,
          },
        ],
        discardedContext,
      };
    }
  }

  return { pieces, discardedContext };
}

function appendText(left: string, right: string): string {
  return `${left},${right}`.replace(/,+/gu, ',').replace(/^,|,$/gu, '');
}

function extractBaseEvents(text: string): BaseExtraction {
  const events: EventPiece[] = [];
  let discardedContext = false;
  let suppressedEvent = false;

  for (const clause of potentialClauses(text)) {
    const extracted = eventPiecesForClause(clause);
    discardedContext ||= extracted.discardedContext;
    for (const piece of extracted.pieces) {
      if (shouldSuppressEvent(piece.text)) {
        suppressedEvent = true;
        continue;
      }
      const previous = events.at(-1);
      if (piece.contextOnly) {
        if (previous !== undefined) {
          previous.text = appendText(previous.text, piece.text);
        }
        continue;
      }
      if (
        piece.hasAmount &&
        piece.paymentComplement &&
        previous !== undefined &&
        !previous.hasAmount
      ) {
        previous.text = appendText(previous.text, piece.text);
        previous.hasAmount = true;
        previous.paymentComplement = false;
        continue;
      }
      // A trailing aggregate prices the preceding unpriced item group. It is
      // not an independent transaction and must keep that context attached.
      if (
        piece.hasAmount &&
        parseAmount(piece.text).role === 'TOTAL' &&
        previous !== undefined &&
        !previous.hasAmount
      ) {
        previous.text = appendText(previous.text, piece.text);
        previous.hasAmount = true;
        continue;
      }
      events.push({ ...piece });
    }
  }

  const segments = events.map(event => ({
    text: event.text,
    ambiguityReasons: [],
  }));
  return { segments, discardedContext, suppressedEvent };
}

function addReason(
  segments: readonly TransactionEventSegment[],
  reason: string,
): TransactionEventSegment[] {
  return segments.map(segment => ({
    ...segment,
    ambiguityReasons: segment.ambiguityReasons.includes(reason)
      ? segment.ambiguityReasons
      : [...segment.ambiguityReasons, reason],
  }));
}

function hasIndependentEventAfterNumericComma(text: string): boolean {
  const comma = /\d+,(?=\d{3}(?:\D|$))/u.exec(text);
  if (comma === null) {
    return false;
  }
  return EVENT_ANCHOR_TEST.test(text.slice(comma.index + comma[0].length));
}

function restoreWholeTextWhenSafe(
  normalizedText: string,
  extraction: BaseExtraction,
): TransactionEventSegment[] {
  if (
    extraction.segments.length === 1 &&
    !extraction.discardedContext &&
    !extraction.suppressedEvent
  ) {
    return [
      {
        ...extraction.segments[0],
        text: normalizedText,
      },
    ];
  }
  return extraction.segments;
}

/**
 * Resolves candidate transaction events before type/category classification.
 * Numeric punctuation, narrative connectors and aggregate totals are treated
 * as evidence rather than unconditional boundaries. Ambiguous relations are
 * preserved as review reasons so they can never become a direct confirmation.
 */
export function analyzeTransactionEvents(
  normalizedText: string,
): TransactionEventAnalysis {
  if (normalizedText.length === 0) {
    return { segments: [], suppressed: false };
  }
  if (
    EXPLICIT_DO_NOT_RECORD.test(normalizedText) ||
    PLANNED_EVENT.test(normalizedText)
  ) {
    return { segments: [], suppressed: true };
  }

  const numericCommaAmbiguous = AMBIGUOUS_NUMERIC_COMMA.test(normalizedText);
  if (
    numericCommaAmbiguous &&
    !hasIndependentEventAfterNumericComma(normalizedText)
  ) {
    return {
      segments: [
        {
          text: normalizedText,
          ambiguityReasons: [NUMERIC_COMMA_REASON],
        },
      ],
      suppressed: false,
    };
  }

  const aggregates = aggregateMentions(normalizedText);
  if (aggregates.length > 0) {
    const detailExtraction = extractBaseEvents(
      maskMentions(normalizedText, aggregates),
    );
    const pricedDetails = detailExtraction.segments.filter(
      segment => parseAmount(segment.text).amountMinor !== undefined,
    );
    if (pricedDetails.length >= 2) {
      const detailTotal = pricedDetails.reduce((total, segment) => {
        const amount = parseAmount(segment.text).amountMinor ?? 0;
        return Number.isSafeInteger(total + amount) ? total + amount : NaN;
      }, 0);
      const totalsMatch =
        Number.isSafeInteger(detailTotal) &&
        aggregates.every(aggregate => aggregate.amountMinor === detailTotal);
      let segments = detailExtraction.segments;
      if (!totalsMatch) {
        segments = addReason(segments, AGGREGATE_MISMATCH_REASON);
      }
      if (numericCommaAmbiguous) {
        segments = addReason(segments, NUMERIC_COMMA_REASON);
      }
      return {
        segments,
        suppressed: detailExtraction.suppressedEvent,
      };
    }
  }

  const extraction = extractBaseEvents(normalizedText);
  let segments = restoreWholeTextWhenSafe(normalizedText, extraction);
  if (numericCommaAmbiguous) {
    segments = addReason(segments, NUMERIC_COMMA_REASON);
  }
  return { segments, suppressed: extraction.suppressedEvent };
}

export function splitTransactionSegments(normalizedText: string): string[] {
  return analyzeTransactionEvents(normalizedText).segments.map(
    segment => segment.text,
  );
}
