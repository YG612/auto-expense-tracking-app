'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  extractAmountSequenceFen,
  extractNumberSequence,
  parseJsonLines,
} = require('./score-asr-ab.cjs');

const manifestPath = path.join(__dirname, 'financial-smoke-manifest.jsonl');
const cases = parseJsonLines(readFileSync(manifestPath, 'utf8'), manifestPath);

test('financial benchmark has at least 200 unique recording slots', () => {
  assert.ok(cases.length >= 200);
  assert.equal(new Set(cases.map(entry => entry.id)).size, cases.length);
  assert.equal(new Set(cases.map(entry => entry.audioFile)).size, cases.length);
});

test('generated references agree with locked numeric expectations', () => {
  for (const entry of cases.filter(value => value.recordingPromptGroup)) {
    assert.deepEqual(
      extractAmountSequenceFen(entry.referenceText),
      entry.expectedAmountSequenceFen,
      entry.id,
    );
    assert.deepEqual(
      extractNumberSequence(entry.referenceText),
      entry.expectedNumberSequence,
      entry.id,
    );
  }
});

test('expanded corpus covers required financial and acoustic slices', () => {
  const tags = new Set(cases.flatMap(entry => entry.sceneTags));
  for (const tag of [
    'expense',
    'income',
    'refund',
    'transfer',
    'reimbursement',
    'repayment',
    'multi_transaction',
    'quantity_unit_price',
    'negation',
  ]) {
    assert.ok(tags.has(tag), `missing scene tag ${tag}`);
  }
  assert.ok(new Set(cases.map(entry => entry.environment)).size >= 6);
  assert.ok(new Set(cases.map(entry => entry.accentProfile)).size >= 5);
});
