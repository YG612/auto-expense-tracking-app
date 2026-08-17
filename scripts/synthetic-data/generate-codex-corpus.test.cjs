const assert = require('node:assert/strict');
const test = require('node:test');

const {
  LABELS,
  createAmountRows,
  createCategoryRows,
  createE2eRows,
  createRiskRows,
} = require('./generate-codex-corpus.cjs');
const { groupBucket } = require('./prepare-category-dataset.cjs');
const { validateRows } = require('./validate-dataset.cjs');
const { jsonl } = require('./pipeline-utils.cjs');

test('Codex category corpus has exact label and hash split targets', () => {
  const development = createCategoryRows();
  const frozen = createCategoryRows({ frozen: true });
  assert.equal(development.length, 31500);
  assert.equal(frozen.length, 9000);
  validateRows(jsonl(development), 'category');
  validateRows(jsonl(frozen), 'category');

  for (const label of LABELS) {
    const labelRows = development.filter(row => row.label === label);
    assert.equal(
      labelRows.filter(row => groupBucket(row.splitGroup) < 15).length,
      500,
    );
    assert.equal(
      labelRows.filter(row => groupBucket(row.splitGroup) >= 15).length,
      3000,
    );
    assert.equal(frozen.filter(row => row.label === label).length, 1000);
  }
  for (const scenario of [
    'VENUE_VS_ITEM',
    'BROAD_PLATFORM',
    'ASR_HOMOPHONE',
    'CATEGORY_BOUNDARY',
    'INSUFFICIENT_INFORMATION',
    'NEW_MERCHANT',
  ]) {
    assert.ok(
      development.some(row => row.scenario === scenario),
      scenario,
    );
  }
  assert.equal(
    frozen.some(row => row.promptVersion === development[0].promptVersion),
    false,
  );
});

test('Codex auxiliary corpora have exact release targets and valid schemas', () => {
  const cases = [
    ['risk', createRiskRows(), 8000],
    ['amount', createAmountRows(), 3000],
    ['e2e', createE2eRows(), 4500],
  ];
  for (const [kind, rows, count] of cases) {
    assert.equal(rows.length, count);
    validateRows(jsonl(rows), kind);
  }
});

test('v2 corpus uses a fresh prompt family and complete scenario coverage', () => {
  const development = createCategoryRows({ version: 2 });
  const frozen = createCategoryRows({ frozen: true, version: 2 });
  assert.equal(development.length, 31500);
  assert.equal(frozen.length, 9000);
  assert.equal(development[0].promptVersion, 'codex-training-v2');
  assert.equal(frozen[0].promptVersion, 'codex-frozen-v2');
  assert.notEqual(development[0].rawText, createCategoryRows()[0].rawText);
});
