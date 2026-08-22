const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWrite,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');
const {
  LABELS,
  releaseGate,
  scoreCategoryRows,
} = require('./unified-model-metrics.cjs');

function readJsonLines(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1}: ${error.message}`);
      }
    });
}

function validateCategoryResults(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (typeof row.id !== 'string' || ids.has(row.id))
      throw new Error('Category result IDs must be unique strings.');
    ids.add(row.id);
    if (!LABELS.includes(row.expectedLabel))
      throw new Error(`${row.id}: invalid expectedLabel.`);
    if (
      !Array.isArray(row.probabilities) ||
      row.probabilities.length !== LABELS.length
    ) {
      throw new Error(`${row.id}: all nine probabilities are required.`);
    }
    const labels = new Set(row.probabilities.map(item => item.label));
    const total = row.probabilities.reduce(
      (sum, item) => sum + item.probability,
      0,
    );
    if (
      LABELS.some(label => !labels.has(label)) ||
      Math.abs(total - 1) > 0.02
    ) {
      throw new Error(`${row.id}: probability vector is invalid.`);
    }
    if (!(row.latencyMs >= 0 && Number.isFinite(row.latencyMs))) {
      throw new Error(`${row.id}: latencyMs is invalid.`);
    }
  }
}

function evaluate(options) {
  for (const key of ['manifest', 'categoryResults', 'riskResults', 'output']) {
    if (typeof options[key] !== 'string')
      throw new Error(
        `--${key.replace(/[A-Z]/gu, value => `-${value.toLowerCase()}`)} is required.`,
      );
  }
  const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
  if (manifest.schemaVersion !== 2 || manifest.taxonomyVersion !== 3) {
    throw new Error('Only a v3 unified candidate manifest can be evaluated.');
  }
  const categoryRows = readJsonLines(options.categoryResults);
  const riskRows = readJsonLines(options.riskResults);
  validateCategoryResults(categoryRows);
  if (
    riskRows.some(
      row =>
        typeof row.id !== 'string' ||
        typeof row.committed !== 'boolean' ||
        typeof row.modelAccepted !== 'boolean',
    )
  ) {
    throw new Error(
      'Risk results require id, modelAccepted, and committed fields.',
    );
  }
  const metrics = scoreCategoryRows(categoryRows, {
    temperature: manifest.calibrationTemperature,
    confidenceThreshold: manifest.thresholds.unifiedConfidence,
    marginThreshold: manifest.thresholds.unifiedMargin,
    categoryPolicies: manifest.categoryPolicies,
  });
  const gate = releaseGate(metrics, riskRows);
  const report = {
    schemaVersion: 1,
    modelId: manifest.modelId,
    modelVersion: manifest.modelVersion,
    evaluatedAt: new Date().toISOString(),
    datasetManifestSha256: manifest.trainingData.preparedManifestSha256,
    categoryResultsSha256: sha256(fs.readFileSync(options.categoryResults)),
    riskResultsSha256: sha256(fs.readFileSync(options.riskResults)),
    metrics,
    gate,
  };
  atomicWrite(options.output, `${JSON.stringify(report, null, 2)}\n`);
  if (!gate.passed) process.exitCode = 2;
  return report;
}

function main(argv) {
  const args = parseArgs(argv);
  evaluate({
    manifest: args.manifest,
    categoryResults: args['category-results'],
    riskResults: args['risk-results'],
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

module.exports = { evaluate, readJsonLines, validateCategoryResults };
