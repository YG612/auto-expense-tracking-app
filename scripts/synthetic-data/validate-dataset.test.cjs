const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRows } = require('./validate-dataset.cjs');

test('accepts a direction-consistent nine-label category row', () => {
  const payload = JSON.stringify({
    id: 'syn-cat-000001',
    rawText: '下班坐地铁回家花了四块',
    normalizedModelText: '下班坐地铁回家花了 <AMOUNT>',
    label: 'expense.transport',
    direction: 'EXPENSE',
    scenario: 'VOICE_COLLOQUIAL',
    merchantFamily: null,
    generatorModel: 'test-generator',
    promptVersion: 'category-v1',
    taxonomyVersion: 3,
    difficulty: 'MEDIUM',
    splitGroup: 'transport.metro.commute',
  });
  const rows = validateRows(payload, 'category');
  assert.equal(rows.length, 1);
});

test('rejects label/direction contradictions', () => {
  const payload = JSON.stringify({
    id: 'syn-cat-000002',
    rawText: '工资到账八千',
    normalizedModelText: '工资到账 <AMOUNT>',
    label: 'income',
    direction: 'EXPENSE',
    scenario: 'TEXT',
    generatorModel: 'test-generator',
    promptVersion: 'category-v1',
    taxonomyVersion: 3,
    difficulty: 'EASY',
    splitGroup: 'income.salary',
  });
  const matcher = /label\/direction mismatch/u;
  assert.throws(() => validateRows(payload, 'category'), matcher);
});

test('rejects income e2e rows carrying an expense category', () => {
  const payload = JSON.stringify({
    id: 'syn-e2e-000001',
    text: '工资到账八千',
    expected: {
      direction: 'INCOME',
      amountMinor: 800000,
      categoryKey: 'expense.other_expense',
    },
    requiredReview: false,
    scenario: 'TEXT',
    generatorModel: 'test-generator',
    promptVersion: 'e2e-v1',
    splitGroup: 'income.salary',
  });
  const matcher = /income must not have an expense category/u;
  assert.throws(() => validateRows(payload, 'e2e'), matcher);
});

test('rejects expense e2e rows carrying the income label', () => {
  const row = {
    id: 'syn-e2e-invalid-expense',
    text: '买菜25元',
    expected: {
      direction: 'EXPENSE',
      amountMinor: 2500,
      categoryKey: 'income',
    },
    requiredReview: false,
    scenario: 'INVALID',
    generatorModel: 'test-model',
    promptVersion: 'test-v1',
    splitGroup: 'invalid-expense',
  };
  assert.throws(
    () => validateRows(`${JSON.stringify(row)}\n`, 'e2e'),
    /expense requires a known primary category/u,
  );
});

test('rejects ambiguous amounts that still declare a ground-truth value', () => {
  const row = {
    id: 'syn-amount-ambiguous-value',
    text: '用了20还是30元记不清',
    expectedStatus: 'AMBIGUOUS',
    expectedAmountMinor: 2000,
    amountEvidence: ['20', '30'],
    scenario: 'MULTIPLE_AMOUNTS',
    generatorModel: 'test-model',
    promptVersion: 'test-v1',
  };
  assert.throws(
    () => validateRows(`${JSON.stringify(row)}\n`, 'amount'),
    /must not declare expectedAmountMinor/u,
  );
});
