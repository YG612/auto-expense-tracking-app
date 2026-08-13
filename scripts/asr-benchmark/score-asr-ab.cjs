'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');

const DEFAULT_PRODUCTION_SAMPLE_MINIMUM = 300;
const PREMATURE_END_TOLERANCE_MS = 200;

function parseJsonLines(text, sourceName = '<memory>') {
  return text
    .split(/\r?\n/u)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(entry => entry.line && !entry.line.startsWith('#'))
    .map(entry => {
      try {
        return JSON.parse(entry.line);
      } catch (error) {
        throw new Error(
          `${sourceName}:${entry.lineNumber}: invalid JSON: ${error.message}`,
        );
      }
    });
}

function normalizeTranscript(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]《》<>—…·]/gu, '');
}

function levenshteinDistance(reference, hypothesis) {
  const left = Array.from(reference);
  const right = Array.from(hypothesis);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + substitutionCost,
      );
    }
    previous = current;
  }

  return previous[right.length];
}

function parseChineseInteger(raw) {
  if (/^\d+$/u.test(raw)) {
    return Number.parseInt(raw, 10);
  }

  const digits = {
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
  const units = { 十: 10, 百: 100, 千: 1000 };
  let section = 0;
  let number = 0;
  let total = 0;

  for (const character of raw) {
    if (Object.hasOwn(digits, character)) {
      number = digits[character];
      continue;
    }
    if (Object.hasOwn(units, character)) {
      section += (number || 1) * units[character];
      number = 0;
      continue;
    }
    if (character === '万') {
      total += (section + number) * 10000;
      section = 0;
      number = 0;
      continue;
    }
    return null;
  }

  return total + section + number;
}

function parseNumericToken(raw) {
  const normalized = String(raw).normalize('NFKC');
  if (/^\d+(?:\.\d+)?$/u.test(normalized)) {
    return Number(normalized);
  }
  return parseChineseInteger(normalized);
}

function extractAmountSequenceFen(transcript) {
  const normalized = String(transcript ?? '').normalize('NFKC');
  const token = '[零〇一二两三四五六七八九十百千万\\d]+';
  const pattern = new RegExp(
    `(${token}(?:\\.\\d+)?)(元|块钱|块)(?:(${token})(?:角|毛))?(?:(${token})分)?|(${token})(?:角|毛)(?:(${token})分)?|(${token})分`,
    'gu',
  );
  const amounts = [];
  let match;

  while ((match = pattern.exec(normalized)) !== null) {
    if (match[1] !== undefined) {
      const major = parseNumericToken(match[1]);
      const bareKuai = match[2] === '块';
      const prefix = normalized.slice(
        Math.max(0, match.index - 12),
        match.index,
      );
      const suffix = normalized.slice(pattern.lastIndex);
      const shorthand =
        bareKuai && match[3] === undefined
          ? suffix.match(
              /^([零〇一二两三四五六七八九\d])(?=$|[^零〇一二两三四五六七八九十百千万\d])/u,
            )
          : null;
      const suffixStartsNonNumericWord =
        bareKuai && /^[\p{L}]/u.test(suffix) && !shorthand;
      const hasMonetaryCue =
        /(?:花了?|消费|支付|付了?|收了?|收入|工资|退款|退给|转账?|充值|押金|售价|价格|总共|合计|每(?:瓶|个|件|份|斤|张|次))$/u.test(
          prefix,
        );
      if (suffixStartsNonNumericWord && !hasMonetaryCue) {
        continue;
      }
      const jiao =
        match[3] === undefined
          ? shorthand
            ? parseNumericToken(shorthand[1])
            : 0
          : parseNumericToken(match[3]);
      const fen = match[4] === undefined ? 0 : parseNumericToken(match[4]);
      if ([major, jiao, fen].every(Number.isFinite)) {
        amounts.push(Math.round(major * 100 + jiao * 10 + fen));
      }
      if (shorthand) {
        pattern.lastIndex += shorthand[1].length;
      }
    } else if (match[5] !== undefined) {
      const jiao = parseNumericToken(match[5]);
      const fen = match[6] === undefined ? 0 : parseNumericToken(match[6]);
      if ([jiao, fen].every(Number.isFinite)) {
        amounts.push(Math.round(jiao * 10 + fen));
      }
    } else if (match[7] !== undefined) {
      const fen = parseNumericToken(match[7]);
      if (Number.isFinite(fen)) {
        amounts.push(Math.round(fen));
      }
    }
  }

  return amounts;
}

function extractNumberSequence(transcript) {
  const normalized = String(transcript ?? '').normalize('NFKC');
  const matches =
    normalized.match(/\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+/gu) ??
    [];
  return matches.map(parseNumericToken).filter(Number.isFinite);
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(ratio * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function arraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validateManifest(cases) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('manifest must contain at least one row');
  }
  const ids = new Set();
  for (const entry of cases) {
    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      throw new Error('every manifest row must have a string id');
    }
    if (ids.has(entry.id)) {
      throw new Error(`duplicate manifest id: ${entry.id}`);
    }
    ids.add(entry.id);
    for (const field of ['audioFile', 'environment', 'accentProfile']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        throw new Error(`${entry.id}: ${field} must be a non-empty string`);
      }
    }
    if (typeof entry.referenceText !== 'string') {
      throw new Error(`${entry.id}: referenceText must be a string`);
    }
    if (typeof entry.requiresFullAudio !== 'boolean') {
      throw new Error(`${entry.id}: requiresFullAudio must be boolean`);
    }
    if (!['TRANSCRIBE', 'REJECT'].includes(entry.expectedOutcome)) {
      throw new Error(
        `${entry.id}: expectedOutcome must be TRANSCRIBE or REJECT`,
      );
    }
    if (
      !Array.isArray(entry.sceneTags) ||
      entry.sceneTags.length === 0 ||
      entry.sceneTags.some(tag => typeof tag !== 'string' || tag.trim() === '')
    ) {
      throw new Error(`${entry.id}: sceneTags must be a non-empty array`);
    }
    if (
      !Array.isArray(entry.expectedAmountSequenceFen) ||
      entry.expectedAmountSequenceFen.some(
        amount =>
          !Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0,
      )
    ) {
      throw new Error(
        `${entry.id}: expectedAmountSequenceFen must contain non-negative integer fen values`,
      );
    }
    if (
      !Array.isArray(entry.expectedNumberSequence) ||
      entry.expectedNumberSequence.some(
        number => !Number.isFinite(number) || number < 0,
      )
    ) {
      throw new Error(
        `${entry.id}: expectedNumberSequence must contain non-negative finite numbers`,
      );
    }
    if (
      entry.expectedLedgerAmountFen !== undefined &&
      entry.expectedLedgerAmountFen !== null &&
      (!Number.isFinite(entry.expectedLedgerAmountFen) ||
        !Number.isInteger(entry.expectedLedgerAmountFen) ||
        entry.expectedLedgerAmountFen < 0)
    ) {
      throw new Error(
        `${entry.id}: expectedLedgerAmountFen must be null or a non-negative integer`,
      );
    }
  }
}

function validateResults(results, manifestById) {
  const keys = new Set();
  for (const entry of results) {
    if (
      typeof entry.model !== 'string' ||
      entry.model.trim() === '' ||
      typeof entry.id !== 'string' ||
      entry.id.trim() === ''
    ) {
      throw new Error('every result row must have model and id');
    }
    const testCase = manifestById.get(entry.id);
    if (!testCase) {
      throw new Error(`${entry.model}/${entry.id}: id is not in the manifest`);
    }
    if (!['TRANSCRIBED', 'REJECTED', 'FAILED'].includes(entry.status)) {
      throw new Error(
        `${entry.model}/${entry.id}: status must be TRANSCRIBED, REJECTED, or FAILED`,
      );
    }
    if (typeof entry.transcript !== 'string') {
      throw new Error(
        `${entry.model}/${entry.id}: transcript must be a string`,
      );
    }
    if (!Number.isFinite(entry.finalLatencyMs) || entry.finalLatencyMs < 0) {
      throw new Error(
        `${entry.model}/${entry.id}: finalLatencyMs must be finite and non-negative`,
      );
    }
    const hasAudioDuration = entry.audioDurationMs !== undefined;
    const hasProcessedDuration = entry.processedAudioMs !== undefined;
    if (hasAudioDuration !== hasProcessedDuration) {
      throw new Error(
        `${entry.model}/${entry.id}: audioDurationMs and processedAudioMs must be reported together`,
      );
    }
    if (
      hasAudioDuration &&
      (!Number.isFinite(entry.audioDurationMs) ||
        entry.audioDurationMs <= 0 ||
        !Number.isFinite(entry.processedAudioMs) ||
        entry.processedAudioMs < 0 ||
        entry.processedAudioMs >
          entry.audioDurationMs + PREMATURE_END_TOLERANCE_MS)
    ) {
      throw new Error(
        `${entry.model}/${entry.id}: invalid audio duration telemetry`,
      );
    }
    if (
      testCase.requiresFullAudio &&
      (!hasAudioDuration || entry.processedAudioMs <= 0)
    ) {
      throw new Error(
        `${entry.model}/${entry.id}: full-audio cases require positive audioDurationMs and processedAudioMs`,
      );
    }
    if (
      entry.prematureEnd !== undefined &&
      typeof entry.prematureEnd !== 'boolean'
    ) {
      throw new Error(
        `${entry.model}/${entry.id}: prematureEnd must be boolean when supplied`,
      );
    }
    const key = `${entry.model}\0${entry.id}`;
    if (keys.has(key)) {
      throw new Error(`duplicate result row: ${entry.model}/${entry.id}`);
    }
    keys.add(key);
  }
}

function determinePrematureEnd(testCase, result) {
  if (!testCase.requiresFullAudio) {
    return { covered: false, premature: null };
  }
  if (!result) {
    return { covered: false, premature: null };
  }
  const durationPremature =
    result.processedAudioMs + PREMATURE_END_TOLERANCE_MS <
    result.audioDurationMs;
  const telemetryConsistent =
    typeof result.prematureEnd !== 'boolean' ||
    result.prematureEnd === durationPremature;
  return {
    covered: true,
    premature: durationPremature || result.prematureEnd === true,
    telemetryConsistent,
  };
}

function createAccumulator() {
  return {
    cases: 0,
    transcribeCases: 0,
    transcribed: 0,
    cerEdits: 0,
    cerCharacters: 0,
    amountCases: 0,
    amountExact: 0,
    numberExact: 0,
    rejectCases: 0,
    correctlyRejected: 0,
  };
}

function finalizeAccumulator(value) {
  return {
    cases: value.cases,
    transcriptionSuccessRate: rate(value.transcribed, value.transcribeCases),
    cer: rate(value.cerEdits, value.cerCharacters),
    amountExactRate: rate(value.amountExact, value.amountCases),
    numberSequenceExactRate: rate(value.numberExact, value.transcribeCases),
    rejectionAccuracy: rate(value.correctlyRejected, value.rejectCases),
  };
}

function addToAccumulator(accumulator, scoredCase) {
  accumulator.cases += 1;
  if (scoredCase.expectedOutcome === 'REJECT') {
    accumulator.rejectCases += 1;
    accumulator.correctlyRejected += scoredCase.correctlyRejected ? 1 : 0;
    return;
  }
  accumulator.transcribeCases += 1;
  accumulator.transcribed += scoredCase.transcribed ? 1 : 0;
  accumulator.cerEdits += scoredCase.cerEdits;
  accumulator.cerCharacters += scoredCase.cerCharacters;
  accumulator.numberExact += scoredCase.numberSequenceExact ? 1 : 0;
  if (scoredCase.amountEligible) {
    accumulator.amountCases += 1;
    accumulator.amountExact += scoredCase.amountExact ? 1 : 0;
  }
}

function scoreModel(cases, results, model, productionMinimum) {
  const resultById = new Map(
    results
      .filter(entry => entry.model === model)
      .map(entry => [entry.id, entry]),
  );
  const overall = createAccumulator();
  const slices = new Map();
  const latencies = [];
  let prematureCovered = 0;
  let prematureCount = 0;
  let prematureTelemetryInconsistent = 0;
  const scoredCases = [];

  for (const testCase of cases) {
    const result = resultById.get(testCase.id);
    const reference = normalizeTranscript(testCase.referenceText);
    const hypothesis = normalizeTranscript(result?.transcript);
    const expectedOutcome = testCase.expectedOutcome;
    const transcribed =
      result?.status === 'TRANSCRIBED' && hypothesis.length > 0;
    const cerEdits =
      expectedOutcome === 'TRANSCRIBE'
        ? levenshteinDistance(reference, hypothesis)
        : 0;
    const expectedAmounts = testCase.expectedAmountSequenceFen;
    const actualAmounts = extractAmountSequenceFen(result?.transcript);
    const actualNumbers = extractNumberSequence(result?.transcript);
    const amountEligible = expectedOutcome === 'TRANSCRIBE';
    const premature = determinePrematureEnd(testCase, result);
    if (premature.covered) {
      prematureCovered += 1;
      prematureCount += premature.premature ? 1 : 0;
      prematureTelemetryInconsistent +=
        premature.telemetryConsistent === false ? 1 : 0;
    }
    if (Number.isFinite(result?.finalLatencyMs)) {
      latencies.push(result.finalLatencyMs);
    }

    const scoredCase = {
      id: testCase.id,
      expectedOutcome,
      status: result?.status ?? 'MISSING',
      transcribed,
      correctlyRejected:
        expectedOutcome === 'REJECT' && result?.status === 'REJECTED',
      cerEdits,
      cerCharacters: Array.from(reference).length,
      amountEligible,
      amountExact: transcribed && arraysEqual(expectedAmounts, actualAmounts),
      numberSequenceExact:
        transcribed &&
        arraysEqual(testCase.expectedNumberSequence, actualNumbers),
      prematureEnd: premature.premature,
      expectedAmounts,
      actualAmounts,
      expectedNumbers: testCase.expectedNumberSequence,
      actualNumbers,
    };
    scoredCases.push(scoredCase);
    addToAccumulator(overall, scoredCase);

    const sliceNames = [
      `environment:${testCase.environment}`,
      `accent:${testCase.accentProfile}`,
      ...testCase.sceneTags.map(tag => `scene:${tag}`),
    ];
    for (const sliceName of sliceNames) {
      if (!slices.has(sliceName)) {
        slices.set(sliceName, createAccumulator());
      }
      addToAccumulator(slices.get(sliceName), scoredCase);
    }
  }

  const summary = finalizeAccumulator(overall);
  const cleanCer = finalizeAccumulator(
    slices.get('environment:clean') ?? createAccumulator(),
  ).cer;
  const noisy = createAccumulator();
  for (const testCase of cases.filter(entry =>
    ['cafe_noise', 'road_noise', 'music_noise', 'distant_mic'].includes(
      entry.environment,
    ),
  )) {
    addToAccumulator(
      noisy,
      scoredCases.find(entry => entry.id === testCase.id),
    );
  }
  const noisyCer = finalizeAccumulator(noisy).cer;
  const latencyCoverage = rate(latencies.length, cases.length);
  const prematureCoverage = rate(
    prematureCovered,
    cases.filter(entry => entry.requiresFullAudio).length,
  );
  const smokeGates = {
    amountExact:
      summary.amountExactRate !== null && summary.amountExactRate >= 0.98,
    numberSequenceExact: summary.numberSequenceExactRate === 1,
    cleanCer: cleanCer !== null && cleanCer <= 0.08,
    noisyCer: noisyCer !== null && noisyCer <= 0.15,
    rejection:
      summary.rejectionAccuracy !== null && summary.rejectionAccuracy >= 0.98,
    latency: latencyCoverage === 1 && percentile(latencies, 0.95) <= 1500,
    prematureEnd:
      prematureCoverage === 1 &&
      prematureCount === 0 &&
      prematureTelemetryInconsistent === 0,
  };
  const smokePassed = Object.values(smokeGates).every(Boolean);
  const asrMetricGatePassed = cases.length >= productionMinimum && smokePassed;

  return {
    model,
    ...summary,
    missingResults: cases.length - resultById.size,
    cleanCer,
    noisyCer,
    latency: {
      coverage: latencyCoverage,
      p50Ms: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
    },
    prematureEnd: {
      coverage: prematureCoverage,
      count: prematureCount,
      rate: rate(prematureCount, prematureCovered),
      telemetryInconsistent: prematureTelemetryInconsistent,
    },
    smokeGates,
    smokePassed,
    asrMetricGatePassed,
    productionEligible: false,
    externalGatesPending: [
      'device-matrix',
      'rtf-and-memory',
      '100-session-stability',
      'privacy-security-licensing',
      'package-and-rollback',
    ],
    productionIneligibility:
      cases.length < productionMinimum
        ? `manifest has ${cases.length} cases; production gate requires at least ${productionMinimum}`
        : !smokePassed
          ? 'ASR metric gates failed'
          : 'ASR metric gates passed; external device, performance, stability, privacy, licensing, package, and rollback gates are pending',
    slices: Object.fromEntries(
      [...slices.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, accumulator]) => [name, finalizeAccumulator(accumulator)]),
    ),
    cases: scoredCases,
  };
}

function scoreBenchmark(cases, results, options = {}) {
  validateManifest(cases);
  const manifestById = new Map(cases.map(entry => [entry.id, entry]));
  validateResults(results, manifestById);
  const models = [...new Set(results.map(entry => entry.model))].sort();
  if (models.length === 0) {
    throw new Error('at least one model result is required');
  }
  const productionMinimum =
    options.productionMinimum ?? DEFAULT_PRODUCTION_SAMPLE_MINIMUM;
  if (
    !Number.isInteger(productionMinimum) ||
    productionMinimum < DEFAULT_PRODUCTION_SAMPLE_MINIMUM
  ) {
    throw new Error(
      `productionMinimum cannot be lower than ${DEFAULT_PRODUCTION_SAMPLE_MINIMUM}`,
    );
  }
  return {
    schemaVersion: 1,
    manifestCases: cases.length,
    productionMinimum,
    models: models.map(model =>
      scoreModel(cases, results, model, productionMinimum),
    ),
  };
}

function formatPercent(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

function renderHumanReport(report) {
  const lines = [
    `ASR A/B baseline: ${report.manifestCases} cases (production minimum: ${report.productionMinimum})`,
  ];
  for (const model of report.models) {
    lines.push('', `[${model.model}]`);
    lines.push(
      `CER=${formatPercent(model.cer)} clean=${formatPercent(model.cleanCer)} noisy=${formatPercent(model.noisyCer)}`,
      `amount exact=${formatPercent(model.amountExactRate)} number sequence exact=${formatPercent(model.numberSequenceExactRate)}`,
      `reject accuracy=${formatPercent(model.rejectionAccuracy)} missing=${model.missingResults}`,
      `latency P50/P95=${model.latency.p50Ms ?? 'n/a'}/${model.latency.p95Ms ?? 'n/a'} ms coverage=${formatPercent(model.latency.coverage)}`,
      `premature end=${model.prematureEnd.count} coverage=${formatPercent(model.prematureEnd.coverage)}`,
      `smoke=${model.smokePassed ? 'PASS' : 'FAIL'} production=${model.productionEligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}`,
    );
    if (model.productionIneligibility) {
      lines.push(`reason: ${model.productionIneligibility}`);
    }
  }
  return lines.join('\n');
}

function parseArguments(argv) {
  const args = { resultPaths: [], json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--manifest') {
      args.manifestPath = argv[++index];
    } else if (current === '--results') {
      args.resultPaths.push(argv[++index]);
    } else if (current === '--json') {
      args.json = true;
    } else if (current === '--production-minimum') {
      args.productionMinimum = Number.parseInt(argv[++index], 10);
    } else {
      throw new Error(`unknown argument: ${current}`);
    }
  }
  if (!args.manifestPath || args.resultPaths.length === 0) {
    throw new Error(
      'usage: node score-asr-ab.cjs --manifest <manifest.jsonl> --results <results.jsonl> [--results <more.jsonl>] [--json]',
    );
  }
  return args;
}

function main(argv) {
  const args = parseArguments(argv);
  const manifestPath = path.resolve(args.manifestPath);
  const cases = parseJsonLines(
    readFileSync(manifestPath, 'utf8'),
    manifestPath,
  );
  const results = args.resultPaths.flatMap(resultPath => {
    const resolved = path.resolve(resultPath);
    return parseJsonLines(readFileSync(resolved, 'utf8'), resolved);
  });
  const report = scoreBenchmark(cases, results, {
    productionMinimum: args.productionMinimum,
  });
  process.stdout.write(
    `${args.json ? JSON.stringify(report, null, 2) : renderHumanReport(report)}\n`,
  );
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  extractAmountSequenceFen,
  extractNumberSequence,
  levenshteinDistance,
  normalizeTranscript,
  parseJsonLines,
  renderHumanReport,
  scoreBenchmark,
};
