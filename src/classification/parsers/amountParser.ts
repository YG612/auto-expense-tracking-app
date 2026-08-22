export type NumericMentionRole =
  | 'MONEY'
  | 'QUANTITY'
  | 'DATE_TIME'
  | 'IDENTIFIER'
  | 'UNIT_PRICE'
  | 'TOTAL'
  | 'LIST_PRICE'
  | 'DISCOUNT';

export type AmountEvidence =
  | 'EXPLICIT_CURRENCY'
  | 'STRONG_CUE_BARE'
  | 'CONTEXTUAL_BARE'
  | 'AMBIGUOUS'
  | 'NONE';

export type NumericMention = {
  start: number;
  end: number;
  raw: string;
  value: number;
  amountMinor?: number;
  role: NumericMentionRole;
  explicitUnit: boolean;
  evidence: AmountEvidence;
};

export type ParsedAmount = {
  amountMinor?: number;
  explicitUnit: boolean;
  matchCount: number;
  ambiguityReasons: string[];
  evidence: AmountEvidence;
  role?: NumericMentionRole;
  mentions: NumericMention[];
};

export type AmountParsingContext = Readonly<{
  /**
   * Event-local ranges already proven to be money by the shared fact layer.
   * The amount parser still owns numeric conversion and all ambiguity checks.
   */
  moneyRanges?: readonly Readonly<{ start: number; end: number }>[];
}>;

const CHINESE_DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const SMALL_UNITS: Readonly<Record<string, number>> = {
  十: 10,
  百: 100,
  千: 1000,
};

const NUMERIC_TOKEN =
  '(?:\\d+(?:\\.\\d{1,2})?|[零〇一二两三四五六七八九十百千万]+(?:点[零〇一二两三四五六七八九]{1,2})?)';
const INTEGER_NUMERIC_TOKEN = '(?:\\d+|[零〇一二两三四五六七八九十百千万]+)';

const QUANTITY_UNIT_SOURCE =
  '(?:公斤|千克|公里|瓶|盒|箱|袋|包|个|人|位|份|杯|斤|克|件|本|张|支|条|只|桶|罐|听|套|次|趟|米|片|枚|颗|碗|盘|束|双|对|台|辆|间|块)';
const QUANTITY_UNIT = new RegExp(`^${QUANTITY_UNIT_SOURCE}`, 'u');
const DATE_TIME_UNIT = /^(?:年|月|日|号|点|时|分|秒)/u;
const IDENTIFIER_PREFIX =
  /(?:订单号|订单编号|单号|编号|尾号|验证码|手机号|电话|桌号|工号|房间号|房号|航班|车次|版本|型号|座位号|门牌号|第)\s*[A-Za-z]*$/u;
const IDENTIFIER_SUFFIX = /^(?:号线|号|岁|%|折)/u;
const NON_CNY_CURRENCY = /(?:us|hk)\s*\$|\$|usd|hkd|美元|美金|港币|港元/iu;
const INVALID_NUMERIC_SYNTAX =
  /\d+\.\d{3,}|\d+(?:\.\d+){2,}|\d+\.\.+\d*|\d*\.\.+\d+|\d+\s*[eE][+-]?\s*\d+|[零〇一二两三四五六七八九十百千万]+点[零〇一二两三四五六七八九]{3,}|(?:^|[^\d年月日])(?:[-−﹣]|负)\s*(?:\d+(?:\.\d+)?|\.\d+|[零〇一二两三四五六七八九十百千万]+)/u;
const STRONG_MONEY_CUE =
  /(?:花(?:了)?|付(?:了)?|支付(?:了)?|消费(?:了)?|扣款|实付|实际支付|应付|共计|总共|一共|总计|合计|赚(?:了|到)?|挣(?:了|到)?|收入|工资|奖金|退款|报销|还款|到账|收到|转|借|手续费)\s*$/u;
const CONTEXTUAL_MONEY_CUE =
  /早餐|早饭|午饭|午餐|晚饭|晚餐|夜宵|打车|地铁|公交|高铁|火车|机票|酒店|宾馆|房租|水果|牛奶|鸡蛋|面包|大米|买|购买|卖|出售|吃饭|餐厅|医院|药/u;
const UNMODELED_PROMOTION_CUE =
  /优惠|满减|满\s*[零〇一二两三四五六七八九十百千万\d]+\s*(?:元|块钱?|块)?\s*(?:立?减|送)|(?:打\s*)?[零〇一二两三四五六七八九\d](?:\.\d+)?\s*折|半价|买\s*[一1]\s*送\s*[一1]|赠品|赠送|免费|免单|不算钱|(?:用|用了|使用)(?:优惠券|代金券|券)/u;

type NumericValue = {
  value?: number;
  colloquialAmbiguous: boolean;
};

type AmountMatch = NumericMention & {
  amountMinor: number;
  colloquialAmbiguous: boolean;
};

function parseChineseInteger(value: string): NumericValue {
  if (value.length === 0) {
    return { value: undefined, colloquialAmbiguous: false };
  }

  if (/^[零〇一二两三四五六七八九]+$/u.test(value)) {
    const digits = [...value].map(character => CHINESE_DIGITS[character]);
    if (digits.some(digit => digit === undefined)) {
      return { value: undefined, colloquialAmbiguous: false };
    }
    return { value: Number(digits.join('')), colloquialAmbiguous: false };
  }

  const colloquial = /^(.+[百千万])([一二两三四五六七八九])$/u.exec(value);
  if (colloquial !== null && !colloquial[1].includes('零')) {
    const prefix = parseChineseInteger(colloquial[1]);
    const finalDigit = CHINESE_DIGITS[colloquial[2]];
    const finalUnit = SMALL_UNITS[colloquial[1].at(-1) ?? ''] ?? 10000;
    if (prefix.value !== undefined && finalDigit !== undefined) {
      return {
        value: prefix.value + finalDigit * (finalUnit / 10),
        colloquialAmbiguous: true,
      };
    }
  }

  let total = 0;
  let section = 0;
  let digit = 0;
  let sawValue = false;
  for (const character of value) {
    const mappedDigit = CHINESE_DIGITS[character];
    if (mappedDigit !== undefined) {
      digit = mappedDigit;
      sawValue = true;
      continue;
    }
    const smallUnit = SMALL_UNITS[character];
    if (smallUnit !== undefined) {
      section += (digit === 0 ? 1 : digit) * smallUnit;
      digit = 0;
      sawValue = true;
      continue;
    }
    if (character === '万') {
      section += digit;
      total += (section === 0 ? 1 : section) * 10000;
      section = 0;
      digit = 0;
      sawValue = true;
      continue;
    }
    return { value: undefined, colloquialAmbiguous: false };
  }
  return {
    value: sawValue ? total + section + digit : undefined,
    colloquialAmbiguous: false,
  };
}

function parseNumericToken(value: string): NumericValue {
  if (/^\d+(?:\.\d{1,2})?$/u.test(value)) {
    return { value: Number(value), colloquialAmbiguous: false };
  }
  const [integerText, decimalText] = value.split('点');
  const integer = parseChineseInteger(integerText);
  if (integer.value === undefined || decimalText === undefined) {
    return integer;
  }
  if (!/^[零〇一二两三四五六七八九]{1,2}$/u.test(decimalText)) {
    return { value: undefined, colloquialAmbiguous: false };
  }
  const decimalDigits = [...decimalText]
    .map(character => CHINESE_DIGITS[character])
    .join('');
  return {
    value: Number(`${integer.value}.${decimalDigits}`),
    colloquialAmbiguous: integer.colloquialAmbiguous,
  };
}

function fractionFromTail(value: string): number | undefined {
  const normalized = [...value]
    .map(character => CHINESE_DIGITS[character] ?? character)
    .join('');
  return /^\d{1,2}$/u.test(normalized)
    ? Number(normalized.padEnd(2, '0')) / 100
    : undefined;
}

type FractionSuffix = {
  value: number;
  length: number;
};

function explicitFractionSuffix(text: string): FractionSuffix | undefined {
  const token = '[零〇一二两三四五六七八九十\\d]{1,2}';
  const match = new RegExp(
    `^(?:(${token})(?:角|毛)(?:(${token})分)?|(${token})分)`,
    'u',
  ).exec(text);
  if (match === null) {
    return undefined;
  }
  const jiao = match[1] === undefined ? 0 : parseNumericToken(match[1]).value;
  const fenText = match[2] ?? match[3];
  const fen = fenText === undefined ? 0 : parseNumericToken(fenText).value;
  if (
    jiao === undefined ||
    fen === undefined ||
    !Number.isInteger(jiao) ||
    !Number.isInteger(fen) ||
    jiao < 0 ||
    jiao > 9 ||
    fen < 0 ||
    fen > 99
  ) {
    return undefined;
  }
  return { value: jiao / 10 + fen / 100, length: match[0].length };
}

function blockShorthandSuffix(text: string): FractionSuffix | undefined {
  const digit = '[零〇一二两三四五六七八九\\d]';
  const singleDigitBeforeUnitPrice = new RegExp(
    `^(${digit})(?=(?:(?:一|每)\\s*${QUANTITY_UNIT_SOURCE}|[/／]\\s*${QUANTITY_UNIT_SOURCE}))`,
    'u',
  ).exec(text);
  if (singleDigitBeforeUnitPrice !== null) {
    const value = fractionFromTail(singleDigitBeforeUnitPrice[1]);
    return value === undefined
      ? undefined
      : { value, length: singleDigitBeforeUnitPrice[0].length };
  }

  const match =
    /^([零〇一二两三四五六七八九\d]{1,2})(?![零〇一二两三四五六七八九\d])/u.exec(
      text,
    );
  if (match === null) {
    return undefined;
  }
  const remainder = text.slice(match[0].length);
  const unitPricePostfix = new RegExp(
    `^\\s*(?:(?:一|每)\\s*${QUANTITY_UNIT_SOURCE}|[/／]\\s*${QUANTITY_UNIT_SOURCE})`,
    'u',
  );
  if (
    !/^\s*(?:$|[,，。.！!？?;；]|微信|支付宝|现金|信用卡|银行卡|花呗)/u.test(
      remainder,
    ) &&
    !unitPricePostfix.test(remainder)
  ) {
    return undefined;
  }
  const value = fractionFromTail(match[1]);
  return value === undefined ? undefined : { value, length: match[0].length };
}

function emptyParsedAmount(reason?: string): ParsedAmount {
  return {
    amountMinor: undefined,
    explicitUnit: false,
    matchCount: 0,
    ambiguityReasons: reason === undefined ? [] : [reason],
    evidence: 'NONE',
    role: undefined,
    mentions: [],
  };
}

function toMinor(value: number): number | undefined {
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : undefined;
}

function overlaps(
  start: number,
  end: number,
  mentions: readonly NumericMention[],
): boolean {
  return mentions.some(mention => start < mention.end && end > mention.start);
}

function isDateOrTimeNumber(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 3), start);
  const after = text.slice(end, Math.min(text.length, end + 3));
  return (
    /[:：年/月.-]$/u.test(before) || /^[:：年月日号点时分秒/.-]/u.test(after)
  );
}

function priceRole(
  text: string,
  start: number,
  end: number = start,
): NumericMentionRole {
  const before = text.slice(Math.max(0, start - 12), start).trimEnd();
  const after = text.slice(end, Math.min(text.length, end + 8)).trimStart();
  const unitPricePrefix = new RegExp(
    `(?:每|一)\\s*${QUANTITY_UNIT_SOURCE}(?:\\s*[\\p{Script=Han}A-Za-z·&]{0,8})?\\s*$`,
    'u',
  );
  const unitPricePostfix = new RegExp(
    `^(?:(?:每|一)\\s*${QUANTITY_UNIT_SOURCE}|[/／]\\s*${QUANTITY_UNIT_SOURCE})`,
    'u',
  );
  if (/(?:实付|实际支付|应付|共计|总共|一共|总计|合计|共)$/u.test(before)) {
    return 'TOTAL';
  }
  if (
    unitPricePrefix.test(before) ||
    unitPricePostfix.test(after) ||
    /(?:每(?:瓶|盒|箱|袋|包|个|份|杯|斤|公斤|件|本|张|支|条|只)?[\p{Script=Han}A-Za-z]{0,8}|单价)$/u.test(
      before,
    )
  ) {
    return 'UNIT_PRICE';
  }
  if (/(?:原价|标价|售价)$/u.test(before)) {
    return 'LIST_PRICE';
  }
  if (/(?:优惠|立减|减免|省(?:了)?|折扣)$/u.test(before)) {
    return 'DISCOUNT';
  }
  return 'MONEY';
}

function bareEvidence(
  text: string,
  start: number,
  end: number,
): AmountEvidence | undefined {
  const before = text.slice(0, start).trimEnd();
  const after = text.slice(end);
  if (STRONG_MONEY_CUE.test(before)) {
    return 'STRONG_CUE_BARE';
  }
  const isTerminal = /^\s*(?:[,，。.！!？?]|$)/u.test(after);
  if (!isTerminal) {
    return undefined;
  }
  if (
    CONTEXTUAL_MONEY_CUE.test(before) ||
    (start === 0 && end === text.length)
  ) {
    return 'CONTEXTUAL_BARE';
  }
  return undefined;
}

function addBareMention(
  text: string,
  start: number,
  raw: string,
  numeric: NumericValue,
  mentions: NumericMention[],
  amountMatches: AmountMatch[],
): void {
  if (numeric.value === undefined) {
    return;
  }
  const end = start + raw.length;
  if (overlaps(start, end, mentions)) {
    return;
  }
  const before = text.slice(0, start);
  const after = text.slice(end);
  let role: NumericMentionRole;
  let evidence: AmountEvidence = 'NONE';

  if (QUANTITY_UNIT.test(after)) {
    role = 'QUANTITY';
  } else if (
    isDateOrTimeNumber(text, start, end) ||
    DATE_TIME_UNIT.test(after)
  ) {
    role = 'DATE_TIME';
  } else if (
    IDENTIFIER_PREFIX.test(before) ||
    IDENTIFIER_SUFFIX.test(after) ||
    /(?:元|块钱?|块)\s*$/u.test(before)
  ) {
    role = 'IDENTIFIER';
  } else {
    const detectedEvidence = bareEvidence(text, start, end);
    if (detectedEvidence === undefined) {
      role = 'IDENTIFIER';
    } else {
      role = priceRole(text, start, end);
      evidence =
        role === 'MONEY' || role === 'TOTAL' ? detectedEvidence : 'AMBIGUOUS';
    }
  }

  const amountMinor = evidence === 'NONE' ? undefined : toMinor(numeric.value);
  const mention: NumericMention = {
    start,
    end,
    raw,
    value: numeric.value,
    amountMinor,
    role,
    explicitUnit: false,
    evidence,
  };
  mentions.push(mention);
  if (amountMinor !== undefined) {
    amountMatches.push({
      ...mention,
      amountMinor,
      colloquialAmbiguous: numeric.colloquialAmbiguous,
    });
  }
}

function addHalfQuantityMentions(
  text: string,
  mentions: NumericMention[],
): void {
  const trailingHalfPattern = new RegExp(
    `(${INTEGER_NUMERIC_TOKEN})(?=\\s*${QUANTITY_UNIT_SOURCE}\\s*半)`,
    'gu',
  );
  for (const match of text.matchAll(trailingHalfPattern)) {
    if (match.index === undefined) {
      continue;
    }
    const numeric = parseNumericToken(match[1]);
    if (numeric.value === undefined) {
      continue;
    }
    mentions.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      value: numeric.value + 0.5,
      role: 'QUANTITY',
      explicitUnit: false,
      evidence: 'NONE',
    });
  }

  const leadingHalfPattern = new RegExp(
    `半(?=\\s*${QUANTITY_UNIT_SOURCE})`,
    'gu',
  );
  for (const match of text.matchAll(leadingHalfPattern)) {
    if (
      match.index === undefined ||
      overlaps(match.index, match.index + 1, mentions)
    ) {
      continue;
    }
    mentions.push({
      start: match.index,
      end: match.index + 1,
      raw: match[0],
      value: 0.5,
      role: 'QUANTITY',
      explicitUnit: false,
      evidence: 'NONE',
    });
  }
}

function addBlockQuantityMentions(
  text: string,
  mentions: NumericMention[],
  ambiguityReasons: string[],
  context: AmountParsingContext,
): void {
  const pattern = new RegExp(`(${INTEGER_NUMERIC_TOKEN})\\s*块(?!钱)`, 'gu');
  const explicitPriceAfter = new RegExp(
    `^\\s*(?:[\\p{Script=Han}A-Za-z·&]{0,12}\\s*)?${NUMERIC_TOKEN}\\s*(?:元|块钱?)`,
    'u',
  );
  const amountFractionAfter =
    /^\s*[零〇一二两三四五六七八九十\d]{1,2}(?:角|毛|分)/u;
  const productAfter =
    /^\s*(?!到账|入账|支付|消费|扣款|钱|人民币)(?![零〇一二两三四五六七八九十百千万\d])\p{Script=Han}/u;
  const purchaseCueBefore = /(?:买(?:了)?|购买|要了|拿了|点了|吃了)\s*$/u;
  const unitPriceAfterBlock = new RegExp(
    `^\\s*(?:一|每)\\s*${QUANTITY_UNIT_SOURCE}`,
    'u',
  );
  const priceBeforeUnitMarker = new RegExp(
    `${NUMERIC_TOKEN}\\s*(?:元|块钱?)\\s*$`,
    'u',
  );

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const numeric = parseNumericToken(match[1]);
    if (numeric.value === undefined) continue;

    const numericStart = match.index;
    const numericEnd = numericStart + match[1].length;
    const blockEnd = match.index + match[0].length;
    const before = text.slice(0, numericStart).trimEnd();
    const after = text.slice(blockEnd);
    const wholeTextIsMoney =
      numericStart === 0 && /^\s*$/u.test(text.slice(blockEnd));
    const factRangeIsMoney =
      context.moneyRanges?.some(
        range => range.start <= numericStart && range.end >= blockEnd,
      ) === true;
    const explicitMoneyCue =
      factRangeIsMoney ||
      STRONG_MONEY_CUE.test(before) ||
      /(?:共|总价|小计)\s*$/u.test(before);
    const purchaseBefore = purchaseCueBefore.test(before);
    const contextualTerminalMoney =
      /^\s*(?:[,，。.！!？?;；]|$)/u.test(after) &&
      !purchaseBefore &&
      CONTEXTUAL_MONEY_CUE.test(before);
    const fractionMoney =
      amountFractionAfter.test(after) ||
      blockShorthandSuffix(after) !== undefined;
    const blockIsUnitPrice = unitPriceAfterBlock.test(after);
    const blockIsPostfixedUnitMarker =
      numeric.value === 1 &&
      priceBeforeUnitMarker.test(before) &&
      /^\s*(?:[,，。.！!？?;；]|$)/u.test(after);
    const clearQuantity =
      !explicitMoneyCue &&
      !fractionMoney &&
      !blockIsUnitPrice &&
      (blockIsPostfixedUnitMarker ||
        explicitPriceAfter.test(after) ||
        ((purchaseBefore || numericStart === 0) && productAfter.test(after)));

    if (
      !clearQuantity &&
      (wholeTextIsMoney ||
        explicitMoneyCue ||
        contextualTerminalMoney ||
        fractionMoney ||
        blockIsUnitPrice)
    ) {
      continue;
    }

    mentions.push({
      start: numericStart,
      end: numericEnd,
      raw: match[1],
      value: numeric.value,
      role: 'QUANTITY',
      explicitUnit: false,
      evidence: 'NONE',
    });
    if (!clearQuantity) {
      ambiguityReasons.push('“块”既可能表示数量也可能表示金额，请补充明确金额');
    }
  }
}

function rolePriority(role: NumericMentionRole): number {
  switch (role) {
    case 'TOTAL':
      return 5;
    case 'MONEY':
      return 4;
    case 'UNIT_PRICE':
      return 3;
    case 'LIST_PRICE':
      return 2;
    case 'DISCOUNT':
      return 1;
    default:
      return 0;
  }
}

type ExactQuantity = {
  numerator: bigint;
  denominator: bigint;
};

type UnitPriceDerivation =
  | { status: 'DERIVED'; amountMinor: number }
  | { status: 'UNAVAILABLE'; reason: string };

function exactQuantity(mention: NumericMention): ExactQuantity | undefined {
  if (!Number.isFinite(mention.value) || mention.value <= 0) {
    return undefined;
  }
  if (Number.isSafeInteger(mention.value)) {
    return { numerator: BigInt(mention.value), denominator: 1n };
  }

  const decimalPart = /\.(\d{1,2})$/u.exec(String(mention.value))?.[1];
  if (decimalPart === undefined || decimalPart.length > 2) {
    return undefined;
  }
  const denominator = 10 ** decimalPart.length;
  const scaled = Math.round(mention.value * denominator);
  if (
    !Number.isSafeInteger(scaled) ||
    Math.abs(mention.value * denominator - scaled) > Number.EPSILON
  ) {
    return undefined;
  }
  return {
    numerator: BigInt(scaled),
    denominator: BigInt(denominator),
  };
}

function quantityUnitAfter(
  text: string,
  mention: NumericMention,
): string | undefined {
  const pattern = new RegExp(`^\\s*(${QUANTITY_UNIT_SOURCE})`, 'u');
  return pattern.exec(text.slice(mention.end))?.[1];
}

function unitPriceUnit(
  text: string,
  mention: NumericMention,
): string | undefined {
  const beforePattern = new RegExp(
    `(?:每|一)\\s*(${QUANTITY_UNIT_SOURCE})(?:\\s*[\\p{Script=Han}A-Za-z·&]{0,12})?\\s*$`,
    'u',
  );
  const afterPattern = new RegExp(
    `^\\s*(?:(?:每|一)\\s*|[/／]\\s*)(${QUANTITY_UNIT_SOURCE})`,
    'u',
  );
  return (
    beforePattern.exec(
      text.slice(Math.max(0, mention.start - 28), mention.start),
    )?.[1] ?? afterPattern.exec(text.slice(mention.end))?.[1]
  );
}

function deriveUnitPriceTotal(
  text: string,
  unitPrice: AmountMatch,
  mentions: readonly NumericMention[],
): UnitPriceDerivation {
  const unit = unitPriceUnit(text, unitPrice);
  if (unit === undefined) {
    return {
      status: 'UNAVAILABLE',
      reason: '检测到单价但无法确定计价单位，请补充总价',
    };
  }
  let quantities = mentions.filter(
    mention =>
      mention.role === 'QUANTITY' &&
      mention.end <= unitPrice.start &&
      quantityUnitAfter(text, mention) === unit,
  );
  if (quantities.length > 1) {
    const unitPricePrefixMarker = new RegExp(
      `^一\\s*${unit}(?:\\s*[\\p{Script=Han}A-Za-z·&]{0,12})?$`,
      'u',
    );
    quantities = quantities.filter(
      mention =>
        mention.value !== 1 ||
        !unitPricePrefixMarker.test(
          text.slice(mention.start, unitPrice.start).trim(),
        ),
    );
  }
  if (quantities.length === 0) {
    return {
      status: 'UNAVAILABLE',
      reason: '检测到单价但没有匹配的购买数量，请补充总价',
    };
  }
  if (quantities.length > 1) {
    return {
      status: 'UNAVAILABLE',
      reason: '同一计价单位存在多个数量，无法安全推导总价',
    };
  }

  const quantity = exactQuantity(quantities[0]);
  if (quantity === undefined) {
    return {
      status: 'UNAVAILABLE',
      reason: '购买数量无法进行精确金额计算，请补充总价',
    };
  }
  const product = BigInt(unitPrice.amountMinor) * quantity.numerator;
  if (product % quantity.denominator !== 0n) {
    return {
      status: 'UNAVAILABLE',
      reason: '数量与单价的乘积不能精确到分，请补充总价',
    };
  }
  const amountMinor = product / quantity.denominator;
  if (amountMinor <= 0n || amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      status: 'UNAVAILABLE',
      reason: '数量与单价推导出的总价超出安全范围',
    };
  }
  return { status: 'DERIVED', amountMinor: Number(amountMinor) };
}

export function parseAmount(
  text: string,
  context: AmountParsingContext = {},
): ParsedAmount {
  if (NON_CNY_CURRENCY.test(text)) {
    return emptyParsedAmount('检测到非人民币币种，当前仅支持人民币金额');
  }
  if (INVALID_NUMERIC_SYNTAX.test(text)) {
    return emptyParsedAmount('金额数字格式无效，请修改后重试');
  }

  const mentions: NumericMention[] = [];
  const amountMatches: AmountMatch[] = [];
  const ambiguityReasons: string[] = [];
  addBlockQuantityMentions(text, mentions, ambiguityReasons, context);
  const unitPattern = new RegExp(
    `(?:¥|￥|rmb\\s*)?(${NUMERIC_TOKEN})\\s*(元|块钱?|块)`,
    'giu',
  );

  for (const match of text.matchAll(unitPattern)) {
    const token = parseNumericToken(match[1]);
    if (token.value === undefined || match.index === undefined) {
      continue;
    }
    const baseEnd = match.index + match[0].length;
    if (overlaps(match.index, baseEnd, mentions)) {
      continue;
    }
    const suffixText = text.slice(baseEnd);
    const explicitFraction = explicitFractionSuffix(suffixText);
    const shorthandFraction = match[2].startsWith('块')
      ? blockShorthandSuffix(suffixText)
      : undefined;
    const fraction = explicitFraction ?? shorthandFraction;
    const value = token.value + (fraction?.value ?? 0);
    const amountMinor = toMinor(value);
    if (amountMinor === undefined) {
      continue;
    }
    const mentionEnd = baseEnd + (fraction?.length ?? 0);
    const role = priceRole(text, match.index, mentionEnd);
    const mention: AmountMatch = {
      start: match.index,
      end: mentionEnd,
      raw: text.slice(match.index, mentionEnd),
      value,
      amountMinor,
      role,
      explicitUnit: true,
      evidence:
        role === 'MONEY' || role === 'TOTAL'
          ? 'EXPLICIT_CURRENCY'
          : 'AMBIGUOUS',
      colloquialAmbiguous: token.colloquialAmbiguous,
    };
    mentions.push(mention);
    amountMatches.push(mention);
  }

  const symbolPattern = new RegExp(
    `(?:¥|￥|rmb)\\s*(${NUMERIC_TOKEN})(?!\\s*(?:元|块))`,
    'giu',
  );
  for (const match of text.matchAll(symbolPattern)) {
    if (
      match.index === undefined ||
      overlaps(match.index, match.index + match[0].length, mentions)
    ) {
      continue;
    }
    const token = parseNumericToken(match[1]);
    const amountMinor =
      token.value === undefined ? undefined : toMinor(token.value);
    if (token.value === undefined || amountMinor === undefined) {
      continue;
    }
    const mentionEnd = match.index + match[0].length;
    const role = priceRole(text, match.index, mentionEnd);
    const mention: AmountMatch = {
      start: match.index,
      end: mentionEnd,
      raw: match[0],
      value: token.value,
      amountMinor,
      role,
      explicitUnit: true,
      evidence:
        role === 'MONEY' || role === 'TOTAL'
          ? 'EXPLICIT_CURRENCY'
          : 'AMBIGUOUS',
      colloquialAmbiguous: token.colloquialAmbiguous,
    };
    mentions.push(mention);
    amountMatches.push(mention);
  }

  addHalfQuantityMentions(text, mentions);

  for (const match of text.matchAll(/\d+(?:\.\d{1,2})?/gu)) {
    if (match.index !== undefined) {
      addBareMention(
        text,
        match.index,
        match[0],
        parseNumericToken(match[0]),
        mentions,
        amountMatches,
      );
    }
  }
  for (const match of text.matchAll(
    /[零〇一二两三四五六七八九十百千万点]+/gu,
  )) {
    if (match.index !== undefined) {
      addBareMention(
        text,
        match.index,
        match[0],
        parseNumericToken(match[0]),
        mentions,
        amountMatches,
      );
    }
  }

  mentions.sort((left, right) => left.start - right.start);
  amountMatches.sort(
    (left, right) =>
      rolePriority(right.role) - rolePriority(left.role) ||
      left.start - right.start,
  );
  if (
    UNMODELED_PROMOTION_CUE.test(text) &&
    !amountMatches.some(match => match.role === 'TOTAL')
  ) {
    return {
      amountMinor: undefined,
      explicitUnit:
        amountMatches.length > 0 &&
        amountMatches.every(match => match.explicitUnit),
      matchCount: amountMatches.length,
      ambiguityReasons: [
        '检测到尚未建模的优惠、赠送或减免，请补充明确实付总价',
      ],
      evidence: 'AMBIGUOUS',
      role: amountMatches.some(match => match.role === 'UNIT_PRICE')
        ? 'UNIT_PRICE'
        : amountMatches[0]?.role,
      mentions,
    };
  }
  const unitPrices = amountMatches.filter(match => match.role === 'UNIT_PRICE');
  if (unitPrices.length > 1) {
    return {
      amountMinor: undefined,
      explicitUnit: unitPrices.every(match => match.explicitUnit),
      matchCount: amountMatches.length,
      ambiguityReasons: ['同一条描述中存在多个单价，无法安全推导总价'],
      evidence: 'AMBIGUOUS',
      role: 'UNIT_PRICE',
      mentions,
    };
  }
  const unitPrice = unitPrices[0];
  if (unitPrice !== undefined) {
    const derivation = deriveUnitPriceTotal(text, unitPrice, mentions);
    if (derivation.status === 'UNAVAILABLE') {
      return {
        amountMinor: undefined,
        explicitUnit: unitPrice.explicitUnit,
        matchCount: amountMatches.length,
        ambiguityReasons: [derivation.reason],
        evidence: 'AMBIGUOUS',
        role: 'UNIT_PRICE',
        mentions,
      };
    }

    const otherPrices = amountMatches.filter(match => match !== unitPrice);
    if (otherPrices.length === 0) {
      return {
        amountMinor: derivation.amountMinor,
        explicitUnit: unitPrice.explicitUnit,
        matchCount: amountMatches.length,
        ambiguityReasons: [],
        evidence: 'EXPLICIT_CURRENCY',
        role: 'TOTAL',
        mentions,
      };
    }
    if (
      otherPrices.length === 1 &&
      (otherPrices[0]?.role === 'TOTAL' || otherPrices[0]?.role === 'MONEY')
    ) {
      const statedTotal = otherPrices[0];
      if (statedTotal?.amountMinor === derivation.amountMinor) {
        return {
          amountMinor: statedTotal.amountMinor,
          explicitUnit: statedTotal.explicitUnit,
          matchCount: amountMatches.length,
          ambiguityReasons: [],
          evidence: statedTotal.evidence,
          role: 'TOTAL',
          mentions,
        };
      }
      return {
        amountMinor: undefined,
        explicitUnit: true,
        matchCount: amountMatches.length,
        ambiguityReasons: ['明确总价与数量乘单价的结果不一致，请核对'],
        evidence: 'AMBIGUOUS',
        role: 'TOTAL',
        mentions,
      };
    }
    return {
      amountMinor: undefined,
      explicitUnit: amountMatches.every(match => match.explicitUnit),
      matchCount: amountMatches.length,
      ambiguityReasons: ['数量与单价之外还存在其他价格，无法安全确定实付总价'],
      evidence: 'AMBIGUOUS',
      role: 'TOTAL',
      mentions,
    };
  }
  const chosen = amountMatches[0];

  if (amountMatches.length > 1) {
    const distinctAmounts = new Set(
      amountMatches.map(match => match.amountMinor),
    );
    if (chosen?.role !== 'TOTAL' && distinctAmounts.size > 1) {
      return {
        amountMinor: undefined,
        explicitUnit: amountMatches.every(match => match.explicitUnit),
        matchCount: amountMatches.length,
        ambiguityReasons: [
          ...ambiguityReasons,
          '同一条描述中存在多个不同金额且未明确总价，请补充实付金额',
        ],
        evidence: 'AMBIGUOUS',
        role: chosen?.role,
        mentions,
      };
    }
    ambiguityReasons.push(
      chosen?.role === 'TOTAL'
        ? '检测到多个价格，已优先采用总价或实付金额，请确认'
        : '同一条描述中存在多个金额，已保留证据最强的金额供确认',
    );
  }
  if (chosen?.role === 'LIST_PRICE' || chosen?.role === 'DISCOUNT') {
    ambiguityReasons.push('检测到价格或优惠金额但未明确实付金额，请确认');
  }
  if (chosen?.colloquialAmbiguous) {
    ambiguityReasons.push('“两百三”一类口语金额可能有歧义，请确认');
  }

  return {
    amountMinor: chosen?.amountMinor,
    explicitUnit: chosen?.explicitUnit ?? false,
    matchCount: amountMatches.length,
    ambiguityReasons,
    evidence: chosen?.evidence ?? 'NONE',
    role: chosen?.role,
    mentions,
  };
}
