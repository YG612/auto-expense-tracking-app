const LABELS = [
  'income',
  'expense.food',
  'expense.transport',
  'expense.shopping',
  'expense.housing',
  'expense.entertainment',
  'expense.healthcare',
  'expense.education',
  'expense.other_expense',
];

function topTwo(probabilities) {
  return [...probabilities]
    .sort((left, right) => right.probability - left.probability)
    .slice(0, 2);
}

function applyTemperature(probabilities, temperature) {
  const adjusted = probabilities.map(item => ({
    label: item.label,
    weight: Math.pow(Math.max(item.probability, 1e-12), 1 / temperature),
  }));
  const total = adjusted.reduce((sum, item) => sum + item.weight, 0);
  return adjusted.map(item => ({
    label: item.label,
    probability: item.weight / total,
  }));
}

function classification(row, options) {
  const calibrated = applyTemperature(row.probabilities, options.temperature);
  const [first, second] = topTwo(calibrated);
  const margin = first.probability - (second?.probability ?? 0);
  const categoryPolicy = options.categoryPolicies?.[first.label];
  return {
    expectedLabel: row.expectedLabel,
    predictedLabel: first.label,
    confidence: first.probability,
    margin,
    accepted:
      categoryPolicy === undefined
        ? first.probability >= options.confidenceThreshold &&
          margin >= options.marginThreshold
        : categoryPolicy.enabled === true &&
          first.probability >= categoryPolicy.confidenceThreshold &&
          margin >= categoryPolicy.marginThreshold,
    latencyMs: row.latencyMs,
  };
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
  ];
}

function scoreCategoryRows(rows, options) {
  const classified = rows.map(row => classification(row, options));
  const accepted = classified.filter(row => row.accepted);
  const enabledLabels = new Set(
    options.categoryPolicies === undefined
      ? LABELS
      : LABELS.filter(
          label => options.categoryPolicies[label]?.enabled === true,
        ),
  );
  const eligible = classified.filter(row =>
    enabledLabels.has(row.expectedLabel),
  );
  const correctAccepted = accepted.filter(
    row =>
      enabledLabels.has(row.expectedLabel) &&
      row.predictedLabel === row.expectedLabel,
  ).length;
  const perLabel = {};
  for (const label of enabledLabels) {
    const expected = classified.filter(row => row.expectedLabel === label);
    const predicted = classified.filter(
      row => row.accepted && row.predictedLabel === label,
    );
    const truePositive = predicted.filter(
      row => row.expectedLabel === label,
    ).length;
    const precision =
      predicted.length === 0 ? 0 : truePositive / predicted.length;
    const recall = expected.length === 0 ? 0 : truePositive / expected.length;
    perLabel[label] = {
      support: expected.length,
      precision,
      recall,
      f1:
        precision + recall === 0
          ? 0
          : (2 * precision * recall) / (precision + recall),
    };
  }
  let calibrationError = 0;
  for (let bin = 0; bin < 10; bin += 1) {
    const lower = bin / 10;
    const upper = (bin + 1) / 10;
    const members = eligible.filter(row =>
      bin === 9
        ? row.confidence >= lower && row.confidence <= upper
        : row.confidence >= lower && row.confidence < upper,
    );
    if (members.length === 0) continue;
    const accuracy =
      members.filter(row => row.predictedLabel === row.expectedLabel).length /
      members.length;
    const meanConfidence =
      members.reduce((sum, row) => sum + row.confidence, 0) / members.length;
    calibrationError +=
      (members.length / Math.max(1, eligible.length)) *
      Math.abs(accuracy - meanConfidence);
  }
  return {
    cases: classified.length,
    eligibleCases: eligible.length,
    excludedCases: classified.length - eligible.length,
    coverage:
      eligible.length === 0
        ? 0
        : accepted.filter(row => enabledLabels.has(row.expectedLabel)).length /
          eligible.length,
    acceptedPrecision:
      accepted.length === 0 ? 0 : correctAccepted / accepted.length,
    overallAccuracy:
      classified.filter(
        row =>
          (enabledLabels.has(row.expectedLabel) &&
            row.accepted &&
            row.predictedLabel === row.expectedLabel) ||
          (!enabledLabels.has(row.expectedLabel) && !row.accepted),
      ).length / classified.length,
    macroF1:
      Object.values(perLabel).reduce((sum, value) => sum + value.f1, 0) /
      Math.max(1, enabledLabels.size),
    minLabelRecall: Math.min(
      ...Object.values(perLabel).map(value => value.recall),
      ...(enabledLabels.size === 0 ? [0] : []),
    ),
    expectedCalibrationError: calibrationError,
    p95LatencyMs: percentile(
      classified.map(row => row.latencyMs),
      0.95,
    ),
    perLabel,
  };
}

const PRODUCTION_GATES = {
  minimumFrozenCases: 9000,
  minimumAcceptedPrecision: 0.99,
  minimumOverallAccuracy: 0.88,
  minimumMacroF1: 0.86,
  minimumLabelRecall: 0.75,
  minimumCoverage: 0.5,
  maximumEce: 0.05,
  maximumP95LatencyMs: 50,
  maximumOodFalseAcceptRate: 0.01,
};

function releaseGate(metrics, riskRows, overrides = {}) {
  const gates = { ...PRODUCTION_GATES, ...overrides };
  const unsafeRiskCommits = riskRows.filter(
    row => row.committed === true,
  ).length;
  const oodFalseAccepts = riskRows.filter(
    row => row.modelAccepted === true,
  ).length;
  const oodFalseAcceptRate =
    riskRows.length === 0 ? 1 : oodFalseAccepts / riskRows.length;
  const checks = {
    frozenCases: metrics.cases >= gates.minimumFrozenCases,
    acceptedPrecision:
      metrics.acceptedPrecision >= gates.minimumAcceptedPrecision,
    overallAccuracy: metrics.overallAccuracy >= gates.minimumOverallAccuracy,
    macroF1: metrics.macroF1 >= gates.minimumMacroF1,
    minLabelRecall: metrics.minLabelRecall >= gates.minimumLabelRecall,
    coverage: metrics.coverage >= gates.minimumCoverage,
    calibration: metrics.expectedCalibrationError <= gates.maximumEce,
    latency: metrics.p95LatencyMs <= gates.maximumP95LatencyMs,
    riskSafety:
      riskRows.length > 0 &&
      unsafeRiskCommits === 0 &&
      oodFalseAcceptRate <= gates.maximumOodFalseAcceptRate,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    unsafeRiskCommits,
    oodFalseAccepts,
    oodFalseAcceptRate,
    gates,
  };
}

function selectOperatingPoint(rows, temperature) {
  let best;
  for (const confidenceThreshold of [
    0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9,
  ]) {
    for (const marginThreshold of [0.05, 0.08, 0.1, 0.12, 0.15, 0.18, 0.22]) {
      const options = { temperature, confidenceThreshold, marginThreshold };
      const metrics = scoreCategoryRows(rows, options);
      if (
        metrics.acceptedPrecision >= 0.99 &&
        (best === undefined ||
          metrics.coverage > best.metrics.coverage ||
          (metrics.coverage === best.metrics.coverage &&
            metrics.macroF1 > best.metrics.macroF1))
      ) {
        best = { options, metrics };
      }
    }
  }
  return best;
}

function selectCategoryPolicies(
  rows,
  temperature,
  {
    minimumSupport = 300,
    minimumAcceptedPrecision = 0.99,
    alwaysDisabled = [],
  } = {},
) {
  const disabled = new Set(alwaysDisabled);
  const policies = {};
  for (const label of LABELS) {
    const support = rows.filter(row => row.expectedLabel === label).length;
    if (disabled.has(label)) {
      policies[label] = {
        enabled: false,
        support,
        reason: 'USER_EXPLICIT_ONLY',
      };
      continue;
    }
    if (support < minimumSupport) {
      policies[label] = {
        enabled: false,
        support,
        reason: 'INSUFFICIENT_EVIDENCE',
      };
      continue;
    }
    let best;
    for (const confidenceThreshold of [
      0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95,
    ]) {
      for (const marginThreshold of [
        0.05, 0.08, 0.1, 0.12, 0.15, 0.18, 0.22, 0.28, 0.31,
      ]) {
        const classified = rows.map(row =>
          classification(row, {
            temperature,
            confidenceThreshold,
            marginThreshold,
          }),
        );
        const predicted = classified.filter(
          row => row.accepted && row.predictedLabel === label,
        );
        const truePositive = predicted.filter(
          row => row.expectedLabel === label,
        ).length;
        const precision =
          predicted.length === 0 ? 0 : truePositive / predicted.length;
        const coverage = truePositive / support;
        if (
          precision >= minimumAcceptedPrecision &&
          (best === undefined || coverage > best.coverage)
        ) {
          best = {
            enabled: true,
            support,
            confidenceThreshold,
            marginThreshold,
            acceptedPrecision: precision,
            coverage,
          };
        }
      }
    }
    policies[label] = best ?? {
      enabled: false,
      support,
      reason: 'PRECISION_GATE_FAILED',
    };
  }
  return policies;
}

function selectTemperature(rows) {
  let best;
  for (let value = 50; value <= 300; value += 5) {
    const temperature = value / 100;
    const metrics = scoreCategoryRows(rows, {
      temperature,
      confidenceThreshold: 0,
      marginThreshold: 0,
    });
    if (best === undefined || metrics.expectedCalibrationError < best.ece) {
      best = { temperature, ece: metrics.expectedCalibrationError };
    }
  }
  return best;
}

module.exports = {
  LABELS,
  PRODUCTION_GATES,
  applyTemperature,
  releaseGate,
  scoreCategoryRows,
  selectCategoryPolicies,
  selectOperatingPoint,
  selectTemperature,
};
