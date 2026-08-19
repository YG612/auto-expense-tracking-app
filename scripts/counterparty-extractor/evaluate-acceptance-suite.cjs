const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  atomicWrite,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');
const {
  candidateRows,
  metricsAt,
  parsePredictions,
  transactionPredictions,
} = require('./train-candidate-model.cjs');

function readRows(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function main(argv) {
  const args = parseArgs(argv);
  if (typeof args.model !== 'string' || typeof args.report !== 'string') {
    throw new Error('--model and --report are required.');
  }
  const root = process.cwd();
  const suiteDir = path.resolve(
    root,
    args['suite-dir'] ?? 'data/synthetic/work/counterparty-acceptance-v2',
  );
  const suiteManifest = JSON.parse(
    fs.readFileSync(path.join(suiteDir, 'manifest.json'), 'utf8'),
  );
  const suiteFile = path.join(suiteDir, suiteManifest.file);
  const suiteText = fs.readFileSync(suiteFile, 'utf8');
  if (sha256(suiteText) !== suiteManifest.sha256) {
    throw new Error('Acceptance suite hash mismatch.');
  }
  const modelReport = JSON.parse(
    fs.readFileSync(path.resolve(args.report), 'utf8'),
  );
  const threshold = modelReport.validation.threshold;
  const transactions = readRows(suiteFile);
  const rows = candidateRows(transactions, false);
  const outputDir = path.dirname(path.resolve(args.output ?? args.report));
  const input = path.join(outputDir, 'acceptance-input.txt');
  atomicWrite(input, `${rows.map(row => row.modelText).join('\n')}\n`);
  const tool = path.join(
    root,
    'build',
    'bill-classifier-tools',
    process.platform === 'win32' ? 'fasttext-qingji.exe' : 'fasttext-qingji',
  );
  const result = spawnSync(
    tool,
    ['predict-prob', path.resolve(args.model), input, '3'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error(result.stderr || 'Inference failed.');
  const predictions = transactionPredictions(
    transactions,
    parsePredictions(result.stdout, rows),
  );
  const metrics = metricsAt(predictions, threshold);
  const gate = {
    candidateRecall: metrics.candidateRecall >= 0.98,
    exactPrecision: metrics.exactPrecision >= 0.95,
    exactRecall: metrics.exactRecall >= 0.9,
    noCounterpartyFalsePositiveRate:
      metrics.noCounterpartyFalsePositiveRate <= 0.02,
  };
  const report = {
    schemaVersion: 1,
    suiteId: suiteManifest.datasetId,
    suiteSha256: suiteManifest.sha256,
    modelSha256: modelReport.model.sha256,
    threshold,
    status: Object.values(gate).every(Boolean)
      ? 'ACCEPTANCE_PASSED'
      : 'ACCEPTANCE_FAILED',
    gate,
    metrics,
    errors: predictions
      .filter(item => {
        const predicted =
          item.best !== undefined && item.best.primaryScore >= threshold;
        if (!predicted) return item.transaction.counterparty !== null;
        const expected = item.transaction.counterparty;
        return (
          expected === null ||
          item.best.candidate.start !== expected.start ||
          item.best.candidate.end !== expected.end
        );
      })
      .map(item => ({
        id: item.transaction.id,
        text: item.transaction.text,
        scenario: item.transaction.scenario,
        expected: item.transaction.counterparty,
        candidateContainsGold: item.candidateContainsGold,
        predicted:
          item.best !== undefined && item.best.primaryScore >= threshold
            ? { ...item.best.candidate, score: item.best.primaryScore }
            : null,
      })),
  };
  const output = path.resolve(
    args.output ?? path.join(outputDir, 'acceptance-report.json'),
  );
  atomicWrite(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
