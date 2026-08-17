const assert = require('node:assert/strict');
const test = require('node:test');

const {
  LABELS,
  releaseGate,
  scoreCategoryRows,
  selectCategoryPolicies,
  selectOperatingPoint,
  selectTemperature,
} = require('./unified-model-metrics.cjs');

function result(
  expectedLabel,
  predictedLabel = expectedLabel,
  confidence = 0.98,
) {
  const remainder = (1 - confidence) / (LABELS.length - 1);
  return {
    expectedLabel,
    probabilities: LABELS.map(label => ({
      label,
      probability: label === predictedLabel ? confidence : remainder,
    })),
    latencyMs: 4,
  };
}

test('scores all nine labels, abstention coverage, calibration and latency', () => {
  const rows = LABELS.flatMap(label => [result(label), result(label)]);
  const metrics = scoreCategoryRows(rows, {
    temperature: 1,
    confidenceThreshold: 0.75,
    marginThreshold: 0.12,
  });
  assert.equal(metrics.acceptedPrecision, 1);
  assert.equal(metrics.macroF1, 1);
  assert.equal(metrics.minLabelRecall, 1);
  assert.equal(metrics.p95LatencyMs, 4);
  assert.ok(metrics.expectedCalibrationError < 0.03);
});

test('selects calibration and an operating point without relaxing precision', () => {
  const rows = LABELS.flatMap(label => [
    result(label, label, 0.9),
    result(label, label, 0.8),
  ]);
  const calibration = selectTemperature(rows);
  const selected = selectOperatingPoint(rows, calibration.temperature);
  assert.ok(calibration.temperature > 0);
  assert.ok(selected.metrics.acceptedPrecision >= 0.99);
});

test('blocks production without enough frozen cases or with a risky commit', () => {
  const metrics = scoreCategoryRows(
    LABELS.map(label => result(label)),
    {
      temperature: 1,
      confidenceThreshold: 0.75,
      marginThreshold: 0.12,
    },
  );
  assert.equal(
    releaseGate(metrics, [{ committed: false, modelAccepted: false }]).passed,
    false,
  );
  assert.equal(
    releaseGate(metrics, [{ committed: true, modelAccepted: false }], {
      minimumFrozenCases: 1,
    }).checks.riskSafety,
    false,
  );
});

test('derives per-label policies and always disables other expense', () => {
  const rows = LABELS.flatMap(label =>
    Array.from({ length: 4 }, () => result(label)),
  );
  const policies = selectCategoryPolicies(rows, 1, {
    minimumSupport: 4,
    alwaysDisabled: ['expense.other_expense'],
  });
  assert.equal(policies['expense.food'].enabled, true);
  assert.deepEqual(policies['expense.other_expense'], {
    enabled: false,
    support: 4,
    reason: 'USER_EXPLICIT_ONLY',
  });
});

test('treats a disabled category as safe abstention and penalizes false acceptance', () => {
  const policies = Object.fromEntries(
    LABELS.map(label => [
      label,
      label === 'expense.other_expense'
        ? { enabled: false }
        : {
            enabled: true,
            confidenceThreshold: 0.8,
            marginThreshold: 0.2,
          },
    ]),
  );
  const safe = scoreCategoryRows(
    [result('expense.food'), result('expense.other_expense')],
    {
      temperature: 1,
      confidenceThreshold: 0.5,
      marginThreshold: 0.05,
      categoryPolicies: policies,
    },
  );
  assert.equal(safe.acceptedPrecision, 1);
  assert.equal(safe.overallAccuracy, 1);
  assert.equal(safe.excludedCases, 1);

  const unsafe = scoreCategoryRows(
    [result('expense.other_expense', 'expense.food')],
    {
      temperature: 1,
      confidenceThreshold: 0.5,
      marginThreshold: 0.05,
      categoryPolicies: policies,
    },
  );
  assert.equal(unsafe.acceptedPrecision, 0);
  assert.equal(unsafe.overallAccuracy, 0);
});
