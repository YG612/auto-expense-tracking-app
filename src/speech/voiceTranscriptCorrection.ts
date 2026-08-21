import type { Merchant } from '../domain/entities';
import { FINANCIAL_VOICE_VOCABULARY_RULES } from './financialVoiceVocabulary';

export type VoiceTranscriptCorrectionSource =
  | 'CURATED'
  | 'FINANCIAL_VOCABULARY'
  | 'MERCHANT_ALIAS';

export type VoiceTranscriptCorrectionRule = {
  id: string;
  from: string;
  to: string;
  source: VoiceTranscriptCorrectionSource;
};

export type VoiceTranscriptCorrectionEdit = {
  ruleId: string;
  source: VoiceTranscriptCorrectionSource;
  start: number;
  end: number;
  original: string;
  replacement: string;
};

export type VoiceTranscriptCorrectionResult = {
  rawText: string;
  correctedText: string;
  edits: VoiceTranscriptCorrectionEdit[];
  rulesetVersion: number;
};

export const VOICE_TRANSCRIPT_CORRECTION_RULESET_VERSION = 2;

/**
 * Intentionally empty until authorized failure recordings establish real,
 * reviewable substitutions. Local merchant aliases are still active.
 */
export const CURATED_VOICE_TRANSCRIPT_CORRECTION_RULES: readonly VoiceTranscriptCorrectionRule[] =
  [];

const ARABIC_NUMERIC_SOURCE = String.raw`\d+(?:[.:：点]\d+)?`;
const CHINESE_NUMERIC_SOURCE = '[零〇一二两三四五六七八九十百千万亿]+';
const NUMERIC_UNIT_SOURCE =
  '(?:元|块钱|块|角|毛|分|年|月|日|号|点|时|秒|个|瓶|件|份|次|张|斤|公里|天)';
const NUMERIC_LEXEME = new RegExp(
  String.raw`${ARABIC_NUMERIC_SOURCE}|${CHINESE_NUMERIC_SOURCE}(?=\s*${NUMERIC_UNIT_SOURCE})`,
  'gu',
);
const NUMERIC_CONTEXT = new RegExp(
  String.raw`(?:${ARABIC_NUMERIC_SOURCE}|${CHINESE_NUMERIC_SOURCE})\s*${NUMERIC_UNIT_SOURCE}`,
  'gu',
);
const MAX_BOOKKEEPING_TEXT_LENGTH = 2_000;

type Span = { start: number; end: number };

function normalizedTerm(value: string): string {
  return value.normalize('NFKC').trim();
}

function protectedNumericSpans(text: string): Span[] {
  return [NUMERIC_LEXEME, NUMERIC_CONTEXT].flatMap(pattern =>
    Array.from(text.matchAll(pattern), match => ({
      start: match.index,
      end: match.index + match[0].length,
    })),
  );
}

function overlaps(left: Span, right: Span): boolean {
  return left.start < right.end && right.start < left.end;
}

function numericSignature(text: string): string[] {
  return Array.from(text.matchAll(NUMERIC_LEXEME), match => match[0]);
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function merchantRules(
  merchants: readonly Merchant[],
): VoiceTranscriptCorrectionRule[] {
  return merchants.flatMap(merchant => {
    const canonical = normalizedTerm(merchant.canonicalName);
    if (canonical.length < 2) {
      return [];
    }
    return merchant.aliases.flatMap(aliasValue => {
      const alias = normalizedTerm(aliasValue);
      if (
        alias.length < 2 ||
        alias === canonical ||
        !arraysEqual(numericSignature(alias), numericSignature(canonical))
      ) {
        return [];
      }
      return [
        {
          id: `merchant:${merchant.id}:${alias}`,
          from: alias,
          to: canonical,
          source: 'MERCHANT_ALIAS' as const,
        },
      ];
    });
  });
}

function usableRules(
  rules: readonly VoiceTranscriptCorrectionRule[],
): VoiceTranscriptCorrectionRule[] {
  const normalized = rules
    .map(rule => ({
      ...rule,
      id: rule.id.trim(),
      from: normalizedTerm(rule.from),
      to: normalizedTerm(rule.to),
    }))
    .filter(
      rule =>
        rule.id.length > 0 &&
        rule.from.length >= 2 &&
        rule.to.length >= 2 &&
        rule.from !== rule.to &&
        arraysEqual(numericSignature(rule.from), numericSignature(rule.to)),
    );

  const targetsBySource = new Map<string, Set<string>>();
  for (const rule of normalized) {
    const targets = targetsBySource.get(rule.from) ?? new Set<string>();
    targets.add(rule.to);
    targetsBySource.set(rule.from, targets);
  }
  return normalized.filter(rule => targetsBySource.get(rule.from)?.size === 1);
}

type ProposedEdit = VoiceTranscriptCorrectionEdit & Span;

function proposedEdits(
  rawText: string,
  rules: readonly VoiceTranscriptCorrectionRule[],
): ProposedEdit[] {
  const protectedSpans = protectedNumericSpans(rawText);
  const proposals: ProposedEdit[] = [];
  for (const rule of rules) {
    let offset = 0;
    while (offset <= rawText.length - rule.from.length) {
      const start = rawText.indexOf(rule.from, offset);
      if (start < 0) break;
      const span = { start, end: start + rule.from.length };
      if (
        !protectedSpans.some(protectedSpan => overlaps(span, protectedSpan))
      ) {
        proposals.push({
          ...span,
          ruleId: rule.id,
          source: rule.source,
          original: rule.from,
          replacement: rule.to,
        });
      }
      offset = start + rule.from.length;
    }
  }
  return proposals.sort(
    (left, right) =>
      left.start - right.start ||
      right.original.length - left.original.length ||
      left.ruleId.localeCompare(right.ruleId),
  );
}

function selectNonOverlappingEdits(proposals: readonly ProposedEdit[]) {
  const selected: ProposedEdit[] = [];
  let cursor = 0;
  for (let index = 0; index < proposals.length;) {
    const start = proposals[index].start;
    const sameStart: ProposedEdit[] = [];
    while (index < proposals.length && proposals[index].start === start) {
      sameStart.push(proposals[index]);
      index += 1;
    }
    if (start < cursor) continue;
    const longestLength = Math.max(
      ...sameStart.map(item => item.original.length),
    );
    const longest = sameStart.filter(
      item => item.original.length === longestLength,
    );
    const replacements = new Set(longest.map(item => item.replacement));
    if (replacements.size !== 1) continue;
    selected.push(longest[0]);
    cursor = longest[0].end;
  }
  return selected;
}

export function correctVoiceTranscript(
  value: string,
  options: {
    merchants?: readonly Merchant[];
    rules?: readonly VoiceTranscriptCorrectionRule[];
    financialRules?: readonly VoiceTranscriptCorrectionRule[];
  } = {},
): VoiceTranscriptCorrectionResult {
  const rawText = value.trim();
  const noChange = (): VoiceTranscriptCorrectionResult => ({
    rawText,
    correctedText: rawText,
    edits: [],
    rulesetVersion: VOICE_TRANSCRIPT_CORRECTION_RULESET_VERSION,
  });
  if (rawText.length === 0 || rawText.length > MAX_BOOKKEEPING_TEXT_LENGTH) {
    return noChange();
  }

  const rules = usableRules([
    ...(options.rules ?? CURATED_VOICE_TRANSCRIPT_CORRECTION_RULES),
    ...(options.financialRules ?? FINANCIAL_VOICE_VOCABULARY_RULES),
    ...merchantRules(options.merchants ?? []),
  ]);
  const edits = selectNonOverlappingEdits(proposedEdits(rawText, rules));
  if (edits.length === 0) return noChange();

  let correctedText = '';
  let cursor = 0;
  for (const edit of edits) {
    correctedText += rawText.slice(cursor, edit.start);
    correctedText += edit.replacement;
    cursor = edit.end;
  }
  correctedText += rawText.slice(cursor);

  if (
    correctedText.length > MAX_BOOKKEEPING_TEXT_LENGTH ||
    !arraysEqual(numericSignature(rawText), numericSignature(correctedText))
  ) {
    return noChange();
  }
  return {
    rawText,
    correctedText,
    edits: edits.map(
      ({ ruleId, source, start, end, original, replacement }) => ({
        ruleId,
        source,
        start,
        end,
        original,
        replacement,
      }),
    ),
    rulesetVersion: VOICE_TRANSCRIPT_CORRECTION_RULESET_VERSION,
  };
}
