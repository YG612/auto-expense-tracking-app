const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');
const { validateRows } = require('../synthetic-data/validate-dataset.cjs');
const {
  buildTrainingTool,
  parsePredictions,
} = require('./train-unified-model.cjs');
const { applyTemperature, LABELS } = require('./unified-model-metrics.cjs');
const { prefilterBillText } = require('./risk-prefilter.cjs');

function verifiedModel(manifestFile) {
  const directory = path.dirname(manifestFile);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (
    manifest.schemaVersion !== 2 ||
    manifest.taxonomyVersion !== 3 ||
    manifest.models?.length !== 1 ||
    manifest.models[0].name !== 'category-v3.ftz'
  ) {
    throw new Error('Only a unified v3 candidate can be executed.');
  }
  const modelFile = path.join(directory, manifest.models[0].name);
  if (
    !fs.existsSync(modelFile) ||
    fs.statSync(modelFile).size !== manifest.models[0].sizeBytes ||
    sha256(fs.readFileSync(modelFile)) !== manifest.models[0].sha256
  ) {
    throw new Error('Candidate model integrity verification failed.');
  }
  return { directory, manifest, modelFile };
}

function accepted(prediction, manifest) {
  const calibrated = applyTemperature(
    prediction.probabilities,
    manifest.calibrationTemperature,
  ).sort((left, right) => right.probability - left.probability);
  const first = calibrated[0];
  const second = calibrated[1];
  const policy = manifest.categoryPolicies?.[first.label];
  return (
    policy?.enabled === true &&
    first.probability >= policy.confidenceThreshold &&
    first.probability - second.probability >= policy.marginThreshold
  );
}

function runCandidate(options) {
  const root = options.root ?? process.cwd();
  if (!['validation', 'frozen', 'risk'].includes(options.split)) {
    throw new Error('--split must be validation, frozen, or risk.');
  }
  for (const key of ['manifest', 'dataset', 'output']) {
    if (typeof options[key] !== 'string')
      throw new Error(`--${key} is required.`);
  }
  const manifestFile = path.resolve(root, options.manifest);
  const datasetFile = path.resolve(root, options.dataset);
  const outputFile = path.resolve(root, options.output);
  if (fs.existsSync(outputFile)) {
    throw new Error('Output already exists; evaluation results are immutable.');
  }
  const { directory, manifest, modelFile } = verifiedModel(manifestFile);
  const lockFile = path.join(directory, 'frozen-evaluation-lock.json');
  if (options.split === 'frozen' && fs.existsSync(lockFile)) {
    throw new Error(
      'FROZEN_EVALUATION_ALREADY_CONSUMED: train a new model version to evaluate again.',
    );
  }
  const kind = options.split === 'risk' ? 'risk' : 'category';
  const datasetText = fs.readFileSync(datasetFile, 'utf8');
  const rows = validateRows(datasetText, kind);
  if (options.split === 'frozen') {
    let descriptor;
    try {
      descriptor = fs.openSync(lockFile, 'wx');
      fs.writeFileSync(
        descriptor,
        `${JSON.stringify({
          schemaVersion: 1,
          status: 'IN_PROGRESS',
          modelVersion: manifest.modelVersion,
          modelSha256: manifest.models[0].sha256,
          datasetSha256: sha256(datasetText),
          reservedAt: new Date().toISOString(),
        })}\n`,
      );
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new Error('FROZEN_EVALUATION_ALREADY_CONSUMED');
      }
      throw error;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }
  const workRoot = path.join(root, 'build', 'bill-classifier-evaluation');
  fs.mkdirSync(workRoot, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(workRoot, 'run-'));
  try {
    const inputFile = path.join(temporary, 'input.txt');
    fs.writeFileSync(
      inputFile,
      `${rows
        .map(row =>
          (kind === 'category' ? row.normalizedModelText : row.text)
            .replace(/[\r\n]+/gu, ' ')
            .trim(),
        )
        .join('\n')}\n`,
    );
    const tool = path.join(
      root,
      'build',
      'bill-classifier-tools',
      process.platform === 'win32' ? 'fasttext-qingji.exe' : 'fasttext-qingji',
    );
    buildTrainingTool(root, tool);
    const started = process.hrtime.bigint();
    const result = spawnSync(
      tool,
      ['predict-prob', modelFile, inputFile, String(LABELS.length)],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
        windowsHide: true,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`fastText inference failed (${result.status}).`);
    }
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    const predictions = parsePredictions(
      result.stdout,
      kind === 'category'
        ? rows
        : rows.map(row => ({ ...row, label: 'expense.other_expense' })),
      elapsedMs / rows.length,
    );
    const outputRows =
      kind === 'category'
        ? predictions
        : predictions.map((prediction, index) => {
            const prefilter = prefilterBillText(rows[index].text);
            return {
              id: rows[index].id,
              modelAccepted:
                prefilter.eligible && accepted(prediction, manifest),
              committed: false,
              prefilterReason: prefilter.reason,
            };
          });
    const outputText = jsonl(outputRows);
    atomicWrite(outputFile, outputText);
    if (options.split === 'frozen') {
      atomicWrite(
        lockFile,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            status: 'COMPLETE',
            modelVersion: manifest.modelVersion,
            modelSha256: manifest.models[0].sha256,
            datasetSha256: sha256(datasetText),
            outputSha256: sha256(outputText),
            evaluatedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
    }
    return outputRows;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function main(argv) {
  const args = parseArgs(argv);
  runCandidate({
    split: args.split,
    manifest: args.manifest,
    dataset: args.dataset,
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

module.exports = { accepted, runCandidate, verifiedModel };
