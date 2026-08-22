const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { analyze } = require('./analyze-error-slices.cjs');

test('refuses frozen-set error analysis', () => {
  assert.throws(() => analyze({ split: 'frozen' }), /validation-only/u);
});

test('requires every slice and an explicit treatment assignment', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-slices-'));
  const files = Object.fromEntries(
    [
      'dataset',
      'results',
      'riskDataset',
      'riskResults',
      'manifest',
      'matrix',
      'output',
      'treatments',
    ].map(name => [name, path.join(directory, `${name}.json`)]),
  );
  const slices = ['VENUE_VS_ITEM', 'OOD'];
  const rows = [
    { id: 'row-0', scenario: 'VENUE_VS_ITEM', label: 'expense.food' },
  ];
  const riskRows = [{ id: 'risk-0', scenario: 'OOD' }];
  fs.writeFileSync(files.dataset, `${rows.map(JSON.stringify).join('\n')}\n`);
  const probabilities = label =>
    [
      'income',
      'expense.food',
      'expense.transport',
      'expense.shopping',
      'expense.housing',
      'expense.entertainment',
      'expense.healthcare',
      'expense.education',
      'expense.other_expense',
    ].map(value => ({
      label: value,
      probability: value === label ? 0.92 : 0.01,
    }));
  fs.writeFileSync(
    files.results,
    `${rows.map(row => JSON.stringify({ id: row.id, probabilities: probabilities(row.label) })).join('\n')}\n`,
  );
  fs.writeFileSync(
    files.riskDataset,
    `${riskRows.map(JSON.stringify).join('\n')}\n`,
  );
  fs.writeFileSync(
    files.riskResults,
    `${JSON.stringify({ id: 'risk-0', modelAccepted: false, committed: false })}\n`,
  );
  const categoryPolicies = Object.fromEntries(
    probabilities('income').map(({ label }) => [
      label,
      label === 'expense.other_expense'
        ? { enabled: false }
        : { enabled: true, confidenceThreshold: 0.8, marginThreshold: 0.2 },
    ]),
  );
  fs.writeFileSync(
    files.manifest,
    JSON.stringify({ calibrationTemperature: 1, categoryPolicies }),
  );
  fs.writeFileSync(
    files.matrix,
    JSON.stringify({ requiredErrorSlices: slices }),
  );
  fs.writeFileSync(
    files.treatments,
    JSON.stringify({ VENUE_VS_ITEM: 'TRAINING_DATA', OOD: 'OOD_REJECTION' }),
  );
  const report = analyze({ ...files, split: 'validation' });
  assert.equal(report.passed, true);
  assert.equal(report.slices.OOD.errors, 0);
});
