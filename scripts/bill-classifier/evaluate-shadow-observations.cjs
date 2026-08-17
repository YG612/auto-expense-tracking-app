const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWrite,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

const ALLOWED_ROW_KEYS = new Set([
  'id',
  'transactionId',
  'modelId',
  'modelVersion',
  'taxonomyVersion',
  'predictedCategoryKey',
  'finalCategoryKey',
  'matched',
  'calibratedConfidence',
  'latencyMs',
  'createdAt',
  'autoCommitted',
]);

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
  ];
}

function wilsonLowerBound(successes, total, z = 1.959963984540054) {
  if (total <= 0) return 0;
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = proportion + (z * z) / (2 * total);
  const spread =
    z *
    Math.sqrt(
      (proportion * (1 - proportion)) / total + (z * z) / (4 * total * total),
    );
  return (center - spread) / denominator;
}

function readRows(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function evaluateShadowObservations(options) {
  const root = options.root ?? process.cwd();
  for (const key of [
    'observations',
    'selectionReport',
    'activation',
    'shadowManifest',
    'output',
  ]) {
    if (typeof options[key] !== 'string')
      throw new Error(`--${key} is required.`);
  }
  const output = path.resolve(root, options.output);
  if (fs.existsSync(output)) {
    throw new Error(
      'Shadow observation report already exists; it is immutable.',
    );
  }
  const observationsFile = path.resolve(root, options.observations);
  const selectionFile = path.resolve(root, options.selectionReport);
  const activationFile = path.resolve(root, options.activation);
  const manifestFile = path.resolve(root, options.shadowManifest);
  const configFile = path.resolve(
    root,
    options.config ?? 'ml/category-classifier/config/shadow_observation.json',
  );
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const selectionBytes = fs.readFileSync(selectionFile);
  const activationBytes = fs.readFileSync(activationFile);
  const manifestBytes = fs.readFileSync(manifestFile);
  const activation = JSON.parse(activationBytes.toString('utf8'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const selected = JSON.parse(selectionBytes.toString('utf8')).selection
    ?.selected;
  if (
    config.schemaVersion !== 1 ||
    selected === undefined ||
    activation.status !== 'MODEL_SELECTED_FOR_SHADOW' ||
    activation.allowAutoCommit !== false ||
    activation.modelVersion !== selected.modelVersion ||
    activation.manifestSha256 !== selected.manifestSha256 ||
    activation.selectionReportSha256 !== sha256(selectionBytes) ||
    !/^[a-f0-9]{64}$/u.test(activation.completionReceiptSha256 ?? '') ||
    manifest.schemaVersion !== 2 ||
    manifest.modelVersion !== selected.modelVersion ||
    manifest.deployment?.mode !== 'SHADOW' ||
    manifest.deployment?.allowAutoCommit !== false ||
    manifest.deployment?.selectionReportSha256 !== sha256(selectionBytes) ||
    manifest.deployment?.completionReceiptSha256 !==
      activation.completionReceiptSha256 ||
    manifest.deployment?.activationSha256 !== sha256(activationBytes)
  ) {
    throw new Error(
      'Shadow observation evidence does not bind the approved model.',
    );
  }
  const rows = readRows(observationsFile);
  const ids = new Set();
  const transactionIds = new Set();
  const labelCounts = new Map();
  const timestamps = [];
  let matchedCount = 0;
  for (const row of rows) {
    if (
      Object.keys(row).some(key => !ALLOWED_ROW_KEYS.has(key)) ||
      typeof row.id !== 'string' ||
      ids.has(row.id) ||
      typeof row.transactionId !== 'string' ||
      transactionIds.has(row.transactionId) ||
      row.modelVersion !== selected.modelVersion ||
      typeof row.modelId !== 'string' ||
      !Number.isSafeInteger(row.taxonomyVersion) ||
      typeof row.predictedCategoryKey !== 'string' ||
      typeof row.finalCategoryKey !== 'string' ||
      typeof row.matched !== 'boolean' ||
      row.matched !== (row.predictedCategoryKey === row.finalCategoryKey) ||
      typeof row.calibratedConfidence !== 'number' ||
      row.calibratedConfidence < 0 ||
      row.calibratedConfidence > 1 ||
      typeof row.latencyMs !== 'number' ||
      !Number.isFinite(row.latencyMs) ||
      row.latencyMs < 0 ||
      row.autoCommitted !== false ||
      Number.isNaN(Date.parse(row.createdAt))
    ) {
      throw new Error(
        'Shadow observation input contains malformed or unsafe rows.',
      );
    }
    ids.add(row.id);
    transactionIds.add(row.transactionId);
    matchedCount += row.matched ? 1 : 0;
    labelCounts.set(
      row.predictedCategoryKey,
      (labelCounts.get(row.predictedCategoryKey) ?? 0) + 1,
    );
    timestamps.push(Date.parse(row.createdAt));
  }
  const first = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const last = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  const calendarDays = new Set(
    timestamps.map(timestamp => new Date(timestamp).toISOString().slice(0, 10)),
  ).size;
  const enabledLabels = Object.entries(manifest.categoryPolicies ?? {})
    .filter(([, policy]) => policy.enabled === true)
    .map(([label]) => label)
    .sort();
  const matchedRate = rows.length === 0 ? 0 : matchedCount / rows.length;
  const checks = {
    minimumObservations: rows.length >= config.minimumObservations,
    minimumCalendarDays:
      calendarDays >= config.minimumCalendarDays &&
      last - first >= (config.minimumCalendarDays - 1) * 86_400_000,
    perEnabledLabel: enabledLabels.every(
      label => (labelCounts.get(label) ?? 0) >= config.minimumPerEnabledLabel,
    ),
    disabledLabels: config.disabledLabels.every(
      label => (labelCounts.get(label) ?? 0) === 0,
    ),
    matchedRate: matchedRate >= config.minimumMatchedRate,
    wilsonLowerBound95:
      wilsonLowerBound(matchedCount, rows.length) >=
      config.minimumWilsonLowerBound95,
    latency:
      rows.length > 0 &&
      percentile(
        rows.map(row => row.latencyMs),
        0.95,
      ) <= config.maximumP95LatencyMs,
    autoCommit: rows.every(row => row.autoCommitted === false),
  };
  const report = {
    schemaVersion: 1,
    status: Object.values(checks).every(Boolean)
      ? 'SHADOW_OBSERVATION_PASSED'
      : 'SHADOW_OBSERVATION_FAILED',
    modelVersion: selected.modelVersion,
    generatedAt: new Date().toISOString(),
    observationCount: rows.length,
    matchedCount,
    matchedRate,
    wilsonLowerBound95: wilsonLowerBound(matchedCount, rows.length),
    p95LatencyMs:
      rows.length === 0
        ? null
        : percentile(
            rows.map(row => row.latencyMs),
            0.95,
          ),
    calendarDays,
    firstObservedAt: first === 0 ? null : new Date(first).toISOString(),
    lastObservedAt: last === 0 ? null : new Date(last).toISOString(),
    labelCounts: Object.fromEntries([...labelCounts.entries()].sort()),
    checks,
    evidence: {
      observationsSha256: sha256(fs.readFileSync(observationsFile)),
      selectionReportSha256: sha256(selectionBytes),
      activationSha256: sha256(activationBytes),
      shadowManifestSha256: sha256(manifestBytes),
      configSha256: sha256(fs.readFileSync(configFile)),
    },
  };
  atomicWrite(output, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function main(argv) {
  const args = parseArgs(argv);
  const report = evaluateShadowObservations({
    observations: args.observations,
    selectionReport: args['selection-report'],
    activation: args.activation,
    shadowManifest: args['shadow-manifest'],
    config: args.config,
    output: args.output,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'SHADOW_OBSERVATION_PASSED') process.exitCode = 2;
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { evaluateShadowObservations, percentile, wilsonLowerBound };
