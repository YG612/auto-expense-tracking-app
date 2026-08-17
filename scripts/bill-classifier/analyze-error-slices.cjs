const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWrite,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');
const { applyTemperature } = require('./unified-model-metrics.cjs');

const TREATMENTS = new Set([
  'RULE',
  'ONTOLOGY',
  'TRAINING_DATA',
  'NORMALIZATION',
  'THRESHOLD',
  'OOD_REJECTION',
  'LABEL_GUIDE',
]);

function readJsonLines(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function readTreatments(file) {
  if (file === undefined) return {};
  const values = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('Treatments must be a JSON object keyed by error slice.');
  }
  return values;
}

function analyze(options) {
  if (options.split !== 'validation') {
    throw new Error(
      'Error-slice analysis is validation-only; frozen data must remain sealed.',
    );
  }
  for (const key of [
    'dataset',
    'results',
    'riskDataset',
    'riskResults',
    'manifest',
    'matrix',
    'output',
  ]) {
    if (typeof options[key] !== 'string')
      throw new Error(`--${key} is required.`);
  }
  const dataset = readJsonLines(options.dataset);
  const results = readJsonLines(options.results);
  const riskDataset = readJsonLines(options.riskDataset);
  const riskResults = readJsonLines(options.riskResults);
  const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
  const matrix = JSON.parse(fs.readFileSync(options.matrix, 'utf8'));
  const treatments = readTreatments(options.treatments);
  const resultById = new Map(results.map(row => [row.id, row]));
  const riskResultById = new Map(riskResults.map(row => [row.id, row]));
  if (resultById.size !== results.length)
    throw new Error('Result IDs are not unique.');
  if (riskResultById.size !== riskResults.length)
    throw new Error('Risk result IDs are not unique.');
  const requiredSlices = matrix.requiredErrorSlices;
  if (!Array.isArray(requiredSlices) || requiredSlices.length === 0) {
    throw new Error('Generation matrix has no required error slices.');
  }
  const slices = {};
  for (const slice of requiredSlices) {
    const rows = dataset.filter(row => row.scenario === slice);
    const riskRows = riskDataset.filter(row => row.scenario === slice);
    const failures = [];
    for (const row of rows) {
      const result = resultById.get(row.id);
      if (result === undefined)
        throw new Error(`${row.id}: result is missing.`);
      const calibrated = applyTemperature(
        result.probabilities,
        manifest.calibrationTemperature,
      ).sort((left, right) => right.probability - left.probability);
      const first = calibrated[0];
      const second = calibrated[1];
      const policy = manifest.categoryPolicies?.[first.label];
      const accepted =
        policy?.enabled === true &&
        first.probability >= policy.confidenceThreshold &&
        first.probability - second.probability >= policy.marginThreshold;
      const correct =
        row.label === 'expense.other_expense'
          ? !accepted
          : accepted && first.label === row.label;
      if (!correct) {
        failures.push({
          id: row.id,
          expectedLabel: row.label,
          predictedLabel: first.label,
          accepted,
          confidence: first.probability,
          margin: first.probability - second.probability,
        });
      }
    }
    for (const row of riskRows) {
      const result = riskResultById.get(row.id);
      if (
        result === undefined ||
        typeof result.modelAccepted !== 'boolean' ||
        typeof result.committed !== 'boolean'
      ) {
        throw new Error(`${row.id}: risk result is missing or malformed.`);
      }
      if (result.modelAccepted || result.committed) {
        failures.push({
          id: row.id,
          expectedDisposition: 'ABSTAIN',
          modelAccepted: result.modelAccepted,
          committed: result.committed,
        });
      }
    }
    const assignment = treatments[slice];
    const treatment =
      typeof assignment === 'string' ? assignment : assignment?.treatment;
    if (treatment !== undefined && !TREATMENTS.has(treatment)) {
      throw new Error(`${slice}: invalid treatment ${treatment}.`);
    }
    slices[slice] = {
      cases: rows.length + riskRows.length,
      errors: failures.length,
      errorRate:
        rows.length + riskRows.length === 0
          ? null
          : failures.length / (rows.length + riskRows.length),
      treatment: treatment ?? 'UNASSIGNED',
      notes:
        typeof assignment === 'object' && typeof assignment?.notes === 'string'
          ? assignment.notes
          : undefined,
      examples: failures.slice(0, 20),
    };
  }
  const allRequiredPresent = Object.values(slices).every(
    value => value.cases > 0,
  );
  const allTreatmentsAssigned = Object.values(slices).every(
    value => value.treatment !== 'UNASSIGNED',
  );
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    split: 'validation',
    datasetSha256: sha256(fs.readFileSync(options.dataset)),
    resultsSha256: sha256(fs.readFileSync(options.results)),
    riskDatasetSha256: sha256(fs.readFileSync(options.riskDataset)),
    riskResultsSha256: sha256(fs.readFileSync(options.riskResults)),
    manifestSha256: sha256(fs.readFileSync(options.manifest)),
    requiredSlices,
    slices,
    allRequiredPresent,
    allTreatmentsAssigned,
    passed: allRequiredPresent && allTreatmentsAssigned,
  };
  atomicWrite(options.output, `${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 2;
  return report;
}

function main(argv) {
  const args = parseArgs(argv);
  return analyze({
    split: args.split,
    dataset: args.dataset,
    results: args.results,
    riskDataset: args['risk-dataset'],
    riskResults: args['risk-results'],
    manifest: args.manifest,
    matrix: args.matrix ?? 'data/synthetic/generation-matrix.json',
    treatments: args.treatments,
    output: args.output,
  });
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { TREATMENTS, analyze };
