const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { parseArgs } = require('../synthetic-data/pipeline-utils.cjs');
const {
  candidateRows,
  checkedDataset,
  metricsAt,
  parsePredictions,
  transactionPredictions,
} = require('./train-candidate-model.cjs');

function main(argv) {
  const args = parseArgs(argv);
  if (typeof args.model !== 'string') throw new Error('--model is required.');
  const root = process.cwd();
  const split = args.split ?? 'validation';
  const dataset = checkedDataset(
    path.resolve(
      root,
      args['dataset-dir'] ?? 'data/synthetic/work/counterparty-v1',
    ),
  );
  const transactions = dataset.rows[split];
  if (transactions === undefined) throw new Error(`Unknown split: ${split}`);
  const rows = candidateRows(transactions, false);
  const input = path.join(
    path.dirname(path.resolve(args.model)),
    `diagnose-${split}.txt`,
  );
  fs.writeFileSync(input, `${rows.map(row => row.modelText).join('\n')}\n`);
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
  const report = {
    split,
    thresholds: [0.01, 0.05, 0.1, 0.2, 0.5, 0.9, 0.99, 0.999].map(threshold =>
      metricsAt(predictions, threshold),
    ),
    highestScoringNoGold: predictions
      .filter(
        row => row.transaction.counterparty === null && row.best !== undefined,
      )
      .sort((left, right) => right.best.primaryScore - left.best.primaryScore)
      .slice(0, 12)
      .map(row => ({
        text: row.transaction.text,
        difficulty: row.transaction.difficulty,
        candidate: row.best.candidate,
        score: row.best.primaryScore,
      })),
  };
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
