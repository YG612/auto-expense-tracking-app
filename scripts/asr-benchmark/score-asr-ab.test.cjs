'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  extractAmountSequenceFen,
  extractNumberSequence,
  levenshteinDistance,
  normalizeTranscript,
  parseJsonLines,
  scoreBenchmark,
} = require('./score-asr-ab.cjs');

const manifest = [
  {
    id: 'clean-expense',
    audioFile: 'audio/clean-expense.wav',
    referenceText: '买5瓶牛奶每瓶10块',
    expectedOutcome: 'TRANSCRIBE',
    expectedAmountSequenceFen: [1000],
    expectedNumberSequence: [5, 10],
    sceneTags: ['expense', 'quantity_unit_price'],
    environment: 'clean',
    accentProfile: 'standard_mandarin',
    requiresFullAudio: true,
  },
  {
    id: 'noisy-expense',
    audioFile: 'audio/noisy-expense.wav',
    referenceText: '坐车来回花了4块钱',
    expectedOutcome: 'TRANSCRIBE',
    expectedAmountSequenceFen: [400],
    expectedNumberSequence: [4],
    sceneTags: ['expense', 'transport'],
    environment: 'road_noise',
    accentProfile: 'standard_mandarin',
    requiresFullAudio: true,
  },
  {
    id: 'silence',
    audioFile: 'audio/silence.wav',
    referenceText: '',
    expectedOutcome: 'REJECT',
    expectedAmountSequenceFen: [],
    expectedNumberSequence: [],
    sceneTags: ['negative_control'],
    environment: 'silence',
    accentProfile: 'none',
    requiresFullAudio: false,
  },
];

test('normalizes punctuation and computes character edit distance', () => {
  assert.equal(normalizeTranscript(' 午饭，25 元！'), '午饭25元');
  assert.equal(levenshteinDistance('牛奶', '牛来'), 1);
});

test('extracts Arabic and Chinese monetary and numeric sequences', () => {
  assert.deepEqual(
    extractAmountSequenceFen('花25元，又花三块五毛'),
    [2500, 350],
  );
  assert.deepEqual(extractNumberSequence('买五瓶，每瓶10块'), [5, 10]);
  assert.deepEqual(extractAmountSequenceFen('买一块蛋糕'), []);
  assert.deepEqual(extractAmountSequenceFen('午饭12块5'), [1250]);
});

test('a complete perfect run passes smoke metrics but cannot claim production eligibility', () => {
  const results = [
    {
      model: 'small-cn-25mb',
      id: 'clean-expense',
      status: 'TRANSCRIBED',
      transcript: '买5瓶牛奶每瓶10块',
      finalLatencyMs: 400,
      audioDurationMs: 2100,
      processedAudioMs: 2100,
    },
    {
      model: 'small-cn-25mb',
      id: 'noisy-expense',
      status: 'TRANSCRIBED',
      transcript: '坐车来回花了4块钱',
      finalLatencyMs: 600,
      audioDurationMs: 1800,
      processedAudioMs: 1800,
    },
    {
      model: 'small-cn-25mb',
      id: 'silence',
      status: 'REJECTED',
      transcript: '',
      finalLatencyMs: 100,
    },
  ];
  const model = scoreBenchmark(manifest, results).models[0];
  assert.equal(model.smokePassed, true);
  assert.equal(model.asrMetricGatePassed, false);
  assert.equal(model.productionEligible, false);
  assert.match(model.productionIneligibility, /requires at least 300/u);
  assert.equal(model.amountExactRate, 1);
  assert.equal(model.numberSequenceExactRate, 1);
  assert.equal(model.prematureEnd.rate, 0);
});

test('scores Android system, sherpa-ncnn, and sherpa-onnx in one comparison', () => {
  const template = [
    { id: 'clean-expense', status: 'TRANSCRIBED', transcript: '买5瓶牛奶每瓶10块', finalLatencyMs: 400, audioDurationMs: 2100, processedAudioMs: 2100 },
    { id: 'noisy-expense', status: 'TRANSCRIBED', transcript: '坐车来回花了4块钱', finalLatencyMs: 600, audioDurationMs: 1800, processedAudioMs: 1800 },
    { id: 'silence', status: 'REJECTED', transcript: '', finalLatencyMs: 100 },
  ];
  const models = ['android-system-local', 'sherpa-ncnn', 'sherpa-onnx'];
  const results = models.flatMap(model => template.map(row => ({ ...row, model })));
  const report = scoreBenchmark(manifest, results);
  assert.deepEqual(report.models.map(entry => entry.model), models);
  assert.ok(report.models.every(entry => entry.smokePassed));
});

test('quantity loss, hallucinated silence, early ending, and missing telemetry fail visibly', () => {
  const results = [
    {
      model: 'broken-model',
      id: 'clean-expense',
      status: 'TRANSCRIBED',
      transcript: '买1瓶牛奶每瓶10块',
      finalLatencyMs: 2000,
      audioDurationMs: 2100,
      processedAudioMs: 900,
    },
    {
      model: 'broken-model',
      id: 'noisy-expense',
      status: 'FAILED',
      transcript: '',
      finalLatencyMs: 0,
      audioDurationMs: 1800,
      processedAudioMs: 1800,
    },
    {
      model: 'broken-model',
      id: 'silence',
      status: 'TRANSCRIBED',
      transcript: '今天花了10元',
      finalLatencyMs: 200,
    },
  ];
  const model = scoreBenchmark(manifest, results).models[0];
  assert.equal(model.numberSequenceExactRate, 0);
  assert.equal(model.rejectionAccuracy, 0);
  assert.equal(model.prematureEnd.count, 1);
  assert.equal(model.prematureEnd.coverage, 1);
  assert.equal(model.latency.coverage, 1);
  assert.equal(model.smokePassed, false);
});

test('quantity-only recognition error fails the 100% number sequence gate', () => {
  const quantityManifest = [
    {
      ...manifest[0],
      referenceText: '今天下午去超市买5瓶新鲜牛奶每瓶10块微信支付',
    },
    manifest[1],
    manifest[2],
  ];
  const results = [
    {
      model: 'quantity-wrong',
      id: 'clean-expense',
      status: 'TRANSCRIBED',
      transcript: '今天下午去超市买1瓶新鲜牛奶每瓶10块微信支付',
      finalLatencyMs: 400,
      audioDurationMs: 2100,
      processedAudioMs: 2100,
    },
    {
      model: 'quantity-wrong',
      id: 'noisy-expense',
      status: 'TRANSCRIBED',
      transcript: '坐车来回花了4块钱',
      finalLatencyMs: 600,
      audioDurationMs: 1800,
      processedAudioMs: 1800,
    },
    {
      model: 'quantity-wrong',
      id: 'silence',
      status: 'REJECTED',
      transcript: '',
      finalLatencyMs: 100,
    },
  ];
  const model = scoreBenchmark(quantityManifest, results).models[0];
  assert.equal(model.smokeGates.amountExact, true);
  assert.equal(model.smokeGates.cleanCer, true);
  assert.equal(model.smokeGates.noisyCer, true);
  assert.equal(model.smokeGates.latency, true);
  assert.equal(model.smokeGates.prematureEnd, true);
  assert.equal(model.smokeGates.numberSequenceExact, false);
  assert.equal(model.smokePassed, false);
});

test('hallucinated amount in a no-amount utterance fails amount exact gate', () => {
  const noAmountCase = {
    ...manifest[0],
    id: 'no-transaction',
    audioFile: 'audio/no-transaction.wav',
    referenceText: '今天没有消费',
    expectedAmountSequenceFen: [],
    expectedNumberSequence: [],
    sceneTags: ['no_transaction'],
  };
  const result = {
    model: 'hallucinator',
    id: 'no-transaction',
    status: 'TRANSCRIBED',
    transcript: '今天没有消费10元',
    finalLatencyMs: 300,
    audioDurationMs: 1200,
    processedAudioMs: 1200,
  };
  const model = scoreBenchmark([noAmountCase], [result]).models[0];
  assert.equal(model.amountExactRate, 0);
  assert.equal(model.smokeGates.amountExact, false);
  assert.equal(model.smokePassed, false);
});

test('rejects lowered production threshold and malformed manifest/result telemetry', () => {
  const validResult = {
    model: 'strict',
    id: 'clean-expense',
    status: 'TRANSCRIBED',
    transcript: '买5瓶牛奶每瓶10块',
    finalLatencyMs: 100,
    audioDurationMs: 1000,
    processedAudioMs: 1000,
  };
  assert.throws(
    () =>
      scoreBenchmark([manifest[0]], [validResult], {
        productionMinimum: 299,
      }),
    /cannot be lower than 300/u,
  );
  assert.throws(
    () => scoreBenchmark([{ ...manifest[0], audioFile: '' }], [validResult]),
    /audioFile/u,
  );
  assert.throws(
    () =>
      scoreBenchmark(
        [manifest[0]],
        [{ ...validResult, finalLatencyMs: Number.NaN }],
      ),
    /finalLatencyMs/u,
  );
  assert.throws(
    () =>
      scoreBenchmark(
        [manifest[0]],
        [{ ...validResult, processedAudioMs: 1300 }],
      ),
    /invalid audio duration/u,
  );
});

test('contradictory premature-end boolean cannot override duration evidence', () => {
  const result = {
    model: 'contradictory',
    id: 'clean-expense',
    status: 'TRANSCRIBED',
    transcript: '买5瓶牛奶每瓶10块',
    finalLatencyMs: 100,
    audioDurationMs: 2100,
    processedAudioMs: 900,
    prematureEnd: false,
  };
  const model = scoreBenchmark([manifest[0]], [result]).models[0];
  assert.equal(model.prematureEnd.count, 1);
  assert.equal(model.prematureEnd.telemetryInconsistent, 1);
  assert.equal(model.smokeGates.prematureEnd, false);
});

test('rejects invalid JSONL and duplicate model/id rows', () => {
  assert.throws(
    () => parseJsonLines('{bad}', 'fixture.jsonl'),
    /fixture\.jsonl:1/u,
  );
  const duplicate = {
    model: 'same',
    id: 'clean-expense',
    status: 'TRANSCRIBED',
    transcript: '买5瓶牛奶每瓶10块',
    finalLatencyMs: 100,
    audioDurationMs: 1000,
    processedAudioMs: 1000,
  };
  assert.throws(
    () => scoreBenchmark(manifest, [duplicate, duplicate]),
    /duplicate result row/u,
  );
});
