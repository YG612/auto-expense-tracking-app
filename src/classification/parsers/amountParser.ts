export type ParsedAmount = {
  amountMinor?: number;
  explicitUnit: boolean;
  matchCount: number;
  ambiguityReasons: string[];
};

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

type NumericValue = {
  value?: number;
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
    return {
      value: Number(digits.join('')),
      colloquialAmbiguous: false,
    };
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
  if (integer.value === undefined) {
    return integer;
  }

  if (decimalText === undefined) {
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
  if (!/^\d{1,2}$/u.test(normalized)) {
    return undefined;
  }
  return Number(normalized.padEnd(2, '0')) / 100;
}

type AmountMatch = {
  start: number;
  end: number;
  value: number;
  explicitUnit: boolean;
  colloquialAmbiguous: boolean;
};

function toMinor(value: number): number | undefined {
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : undefined;
}

function overlaps(
  start: number,
  end: number,
  matches: readonly AmountMatch[],
): boolean {
  return matches.some(match => start < match.end && end > match.start);
}

function isDateOrTimeNumber(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 2), start);
  const after = text.slice(end, Math.min(text.length, end + 2));
  return (
    /[:：年/月.-]$/u.test(before) || /^[:：年月日号点时分/.-]/u.test(after)
  );
}

export function parseAmount(text: string): ParsedAmount {
  const matches: AmountMatch[] = [];
  const ambiguityReasons: string[] = [];
  const unitPattern = new RegExp(
    `(?:¥|￥|rmb\\s*)?(${NUMERIC_TOKEN})\\s*(元|块钱?|块)([零〇一二两三四五六七八九\\d]{1,2})?`,
    'giu',
  );

  for (const match of text.matchAll(unitPattern)) {
    const token = parseNumericToken(match[1]);
    if (token.value === undefined || match.index === undefined) {
      continue;
    }
    const tail =
      match[3] === undefined ? undefined : fractionFromTail(match[3]);
    const value = token.value + (tail ?? 0);
    if (toMinor(value) === undefined) {
      continue;
    }
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      value,
      explicitUnit: true,
      colloquialAmbiguous: token.colloquialAmbiguous,
    });
  }

  const symbolPattern = new RegExp(
    `(?:¥|￥|rmb)\\s*(${NUMERIC_TOKEN})(?!\\s*(?:元|块))`,
    'giu',
  );
  for (const match of text.matchAll(symbolPattern)) {
    if (
      match.index === undefined ||
      overlaps(match.index, match.index + match[0].length, matches)
    ) {
      continue;
    }
    const token = parseNumericToken(match[1]);
    if (token.value !== undefined && toMinor(token.value) !== undefined) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        value: token.value,
        explicitUnit: true,
        colloquialAmbiguous: token.colloquialAmbiguous,
      });
    }
  }

  const bareArabic = /\d+(?:\.\d{1,2})?/gu;
  for (const match of text.matchAll(bareArabic)) {
    if (match.index === undefined) {
      continue;
    }
    const end = match.index + match[0].length;
    if (
      overlaps(match.index, end, matches) ||
      isDateOrTimeNumber(text, match.index, end)
    ) {
      continue;
    }
    const value = Number(match[0]);
    if (toMinor(value) !== undefined) {
      matches.push({
        start: match.index,
        end,
        value,
        explicitUnit: false,
        colloquialAmbiguous: false,
      });
    }
  }

  // Explicit currency expressions are stronger evidence than numeral-like
  // characters in names such as “张三”. Only scan bare Chinese numerals when
  // no explicit monetary token has already been found.
  if (!matches.some(match => match.explicitUnit)) {
    const bareChinese = /[零〇一二两三四五六七八九十百千万点]+/gu;
    for (const match of text.matchAll(bareChinese)) {
      if (match.index === undefined) {
        continue;
      }
      const end = match.index + match[0].length;
      if (
        overlaps(match.index, end, matches) ||
        isDateOrTimeNumber(text, match.index, end)
      ) {
        continue;
      }
      const token = parseNumericToken(match[0]);
      if (token.value !== undefined && toMinor(token.value) !== undefined) {
        matches.push({
          start: match.index,
          end,
          value: token.value,
          explicitUnit: false,
          colloquialAmbiguous: token.colloquialAmbiguous,
        });
      }
    }
  }

  matches.sort((left, right) => left.start - right.start);
  const uniqueMatches = matches.filter(
    (match, index) =>
      index === 0 ||
      match.start !== matches[index - 1].start ||
      match.end !== matches[index - 1].end,
  );
  const chosen = uniqueMatches[0];

  if (uniqueMatches.length > 1) {
    ambiguityReasons.push('同一条描述中存在多个金额，已保留首个金额供确认');
  }
  if (chosen?.colloquialAmbiguous) {
    ambiguityReasons.push('“两百三”一类口语金额可能有歧义，请确认');
  }

  return {
    amountMinor: chosen === undefined ? undefined : toMinor(chosen.value),
    explicitUnit: chosen?.explicitUnit ?? false,
    matchCount: uniqueMatches.length,
    ambiguityReasons,
  };
}
