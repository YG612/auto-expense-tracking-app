const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { sha256 } = require('../synthetic-data/pipeline-utils.cjs');
const {
  evaluateShadowObservations,
  wilsonLowerBound,
} = require('./evaluate-shadow-observations.cjs');

function fixture({ mismatch = false, autoCommitted = false } = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qingji-shadow-observation-'),
  );
  const file = name => path.join(root, name);
  const selected = {
    candidateId: 'PASSING',
    modelVersion: '3.0.0-shadow',
    manifestSha256: 'a'.repeat(64),
  };
  const selection = { selection: { winner: 'PASSING', selected } };
  fs.writeFileSync(file('selection.json'), JSON.stringify(selection));
  const selectionHash = sha256(fs.readFileSync(file('selection.json')));
  const activation = {
    status: 'MODEL_SELECTED_FOR_SHADOW',
    modelVersion: selected.modelVersion,
    manifestSha256: selected.manifestSha256,
    selectionReportSha256: selectionHash,
    completionReceiptSha256: 'b'.repeat(64),
    allowAutoCommit: false,
  };
  fs.writeFileSync(file('activation.json'), JSON.stringify(activation));
  const labels = [
    'income',
    'expense.food',
    'expense.transport',
    'expense.shopping',
    'expense.housing',
    'expense.entertainment',
    'expense.healthcare',
    'expense.education',
  ];
  const policies = Object.fromEntries(
    [...labels, 'expense.other_expense'].map(label => [
      label,
      { enabled: label !== 'expense.other_expense' },
    ]),
  );
  fs.writeFileSync(
    file('manifest.json'),
    JSON.stringify({
      schemaVersion: 2,
      modelVersion: selected.modelVersion,
      categoryPolicies: policies,
      deployment: {
        mode: 'SHADOW',
        allowAutoCommit: false,
        selectionReportSha256: selectionHash,
        completionReceiptSha256: activation.completionReceiptSha256,
        activationSha256: sha256(fs.readFileSync(file('activation.json'))),
      },
    }),
  );
  const start = Date.parse('2026-08-01T00:00:00.000Z');
  const rows = Array.from({ length: 500 }, (_, index) => {
    const predicted = labels[index % labels.length];
    const isMismatch = mismatch && index === 0;
    return {
      id: `observation-${index}`,
      transactionId: `transaction-${index}`,
      modelId: 'qingji-bill-category-fasttext',
      modelVersion: selected.modelVersion,
      taxonomyVersion: 3,
      predictedCategoryKey: predicted,
      finalCategoryKey: isMismatch ? 'expense.food' : predicted,
      matched: !isMismatch,
      calibratedConfidence: 0.995,
      latencyMs: 2,
      createdAt: new Date(start + (index % 7) * 86_400_000).toISOString(),
      autoCommitted,
    };
  });
  fs.writeFileSync(
    file('observations.jsonl'),
    `${rows.map(row => JSON.stringify(row)).join('\n')}\n`,
  );
  return { file };
}

test('passes a seven-day privacy-minimal shadow observation window', () => {
  const { file } = fixture();
  const report = evaluateShadowObservations({
    observations: file('observations.jsonl'),
    selectionReport: file('selection.json'),
    activation: file('activation.json'),
    shadowManifest: file('manifest.json'),
    config: path.resolve(
      __dirname,
      '..',
      '..',
      'ml/category-classifier/config/shadow_observation.json',
    ),
    output: file('report.json'),
  });
  assert.equal(report.status, 'SHADOW_OBSERVATION_PASSED');
  assert.equal(report.observationCount, 500);
  assert.equal(report.checks.autoCommit, true);
  assert.ok(report.wilsonLowerBound95 > 0.99);
});

test('fails closed on automatic commits', () => {
  const { file } = fixture({ autoCommitted: true });
  assert.throws(
    () =>
      evaluateShadowObservations({
        observations: file('observations.jsonl'),
        selectionReport: file('selection.json'),
        activation: file('activation.json'),
        shadowManifest: file('manifest.json'),
        config: path.resolve(
          __dirname,
          '..',
          '..',
          'ml/category-classifier/config/shadow_observation.json',
        ),
        output: file('report.json'),
      }),
    /malformed or unsafe/u,
  );
});

test('Wilson lower bound is conservative for small samples', () => {
  assert.ok(wilsonLowerBound(10, 10) < 0.8);
  assert.ok(wilsonLowerBound(500, 500) > 0.99);
});
