const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { generate } = require('./generate-dataset.cjs');
const { parseClaudeEnvelope } = require('./llm-provider.cjs');
const { groupBucket, prepare } = require('./prepare-category-dataset.cjs');
const { review } = require('./review-dataset.cjs');

const root = path.resolve(__dirname, '..', '..');

function categoryRow(
  index,
  promptVersion = 'training-v1',
  group = `group-${index}`,
) {
  return {
    id: `syn-cat-source-${index}`,
    rawText: `在不同商店买午餐${index}`,
    normalizedModelText: `商店午餐${index}`,
    label: 'expense.food',
    direction: 'EXPENSE',
    scenario: 'FOOD_MEAL',
    generatorModel: 'mock-model',
    promptVersion,
    taxonomyVersion: 3,
    difficulty: 'MEDIUM',
    splitGroup: group,
  };
}

test('parses Claude structured output envelopes', () => {
  assert.deepEqual(
    parseClaudeEnvelope(
      JSON.stringify({
        structured_output: { rows: [1] },
        total_cost_usd: 0.02,
      }),
    ),
    { value: { rows: [1] }, costUsd: 0.02, model: undefined },
  );
  assert.deepEqual(
    parseClaudeEnvelope(JSON.stringify({ result: '{"decisions":[]}' })),
    { value: { decisions: [] }, costUsd: undefined, model: undefined },
  );
});

test('generates validated batches with deterministic provenance and IDs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-generate-'));
  const output = path.join(directory, 'category.jsonl');
  let sourceIndex = 0;
  const rows = generate(
    {
      root,
      kind: 'category',
      output,
      count: 3,
      batchSize: 2,
      model: 'test-generator',
      maxBudgetUsd: 1,
      promptVersion: 'training-v1',
    },
    {
      invoke({ schema }) {
        const count = schema.properties.rows.minItems;
        return {
          value: {
            rows: Array.from({ length: count }, () =>
              categoryRow(sourceIndex++),
            ),
          },
          costUsd: 0.01,
          model: 'resolved-test-generator',
        };
      },
    },
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, 'syn-cat-0000001');
  assert.equal(rows[2].generatorModel, 'resolved-test-generator');
  assert.equal(fs.readFileSync(output, 'utf8').trim().split('\n').length, 3);
});

test('independent review emits accepted rows and a complete audit', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-review-'));
  const input = path.join(directory, 'input.jsonl');
  const output = path.join(directory, 'accepted.jsonl');
  const audit = path.join(directory, 'audit.jsonl');
  fs.writeFileSync(
    input,
    `${[categoryRow(1), categoryRow(2)].map(row => JSON.stringify(row)).join('\n')}\n`,
  );
  const result = review(
    {
      root,
      input,
      output,
      audit,
      kind: 'category',
      model: 'test-reviewer',
      maxBudgetUsd: 1,
    },
    {
      invoke() {
        return {
          value: {
            decisions: [
              {
                id: 'syn-cat-source-1',
                verdict: 'ACCEPT',
                reasonCodes: ['OK'],
              },
              {
                id: 'syn-cat-source-2',
                verdict: 'REJECT',
                reasonCodes: ['UNNATURAL_TEXT'],
              },
            ],
          },
          costUsd: 0.01,
        };
      },
    },
  );
  assert.equal(result.accepted.length, 1);
  assert.equal(result.decisions.length, 2);
  assert.match(fs.readFileSync(audit, 'utf8'), /test-reviewer/u);
});

test('prepares leak-free grouped splits and a hashed frozen manifest', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-prepare-'));
  const trainInput = path.join(directory, 'train-reviewed.jsonl');
  const frozenInput = path.join(directory, 'frozen-reviewed.jsonl');
  const outputDir = path.join(directory, 'prepared');
  const validationGroup = Array.from(
    { length: 100 },
    (_, index) => `validation-${index}`,
  ).find(group => groupBucket(group) < 15);
  const trainGroup = Array.from(
    { length: 100 },
    (_, index) => `train-${index}`,
  ).find(group => groupBucket(group) >= 15);
  const trainRows = [
    categoryRow(1, 'training-v1', validationGroup),
    categoryRow(2, 'training-v1', trainGroup),
    categoryRow(3, 'training-v1', trainGroup),
  ];
  trainRows[1].normalizedModelText = '面包店早餐';
  trainRows[2].normalizedModelText = trainRows[1].normalizedModelText;
  const frozenRows = [categoryRow(4, 'frozen-v1', 'frozen-family-4')];
  fs.writeFileSync(trainInput, `${trainRows.map(JSON.stringify).join('\n')}\n`);
  fs.writeFileSync(
    frozenInput,
    `${frozenRows.map(JSON.stringify).join('\n')}\n`,
  );

  const manifest = prepare({ root, trainInput, frozenInput, outputDir });
  assert.equal(manifest.files.train.rows, 1);
  assert.equal(manifest.files.validation.rows, 1);
  assert.equal(manifest.files.frozenTest.rows, 1);
  assert.equal(manifest.files.dedupeAudit.rows, 1);
  assert.match(manifest.files.train.sha256, /^[a-f0-9]{64}$/u);
});
