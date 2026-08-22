const assert = require('node:assert/strict');
const test = require('node:test');

const { accepted } = require('./run-unified-model.cjs');
const { LABELS } = require('./unified-model-metrics.cjs');

function prediction(winner, confidence = 0.92) {
  const remainder = (1 - confidence) / (LABELS.length - 1);
  return {
    probabilities: LABELS.map(label => ({
      label,
      probability: label === winner ? confidence : remainder,
    })),
  };
}

test('candidate runner applies category policy and permanently rejects other', () => {
  const categoryPolicies = Object.fromEntries(
    LABELS.map(label => [
      label,
      label === 'expense.other_expense'
        ? { enabled: false }
        : { enabled: true, confidenceThreshold: 0.8, marginThreshold: 0.2 },
    ]),
  );
  const manifest = { calibrationTemperature: 1, categoryPolicies };
  assert.equal(accepted(prediction('expense.food'), manifest), true);
  assert.equal(accepted(prediction('expense.other_expense'), manifest), false);
  assert.equal(accepted(prediction('expense.food', 0.7), manifest), false);
});
