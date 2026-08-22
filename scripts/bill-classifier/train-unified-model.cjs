const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { parseArgs, sha256 } = require('../synthetic-data/pipeline-utils.cjs');
const { validateRows } = require('../synthetic-data/validate-dataset.cjs');
const {
  LABELS,
  selectCategoryPolicies,
  selectOperatingPoint,
  selectTemperature,
} = require('./unified-model-metrics.cjs');

const CONFIGS = [
  { name: 'compact-char', dim: 24, epoch: 35, lr: 0.5, bucket: 20000 },
  { name: 'balanced-char', dim: 32, epoch: 45, lr: 0.35, bucket: 30000 },
  { name: 'wide-char', dim: 48, epoch: 35, lr: 0.25, bucket: 40000 },
];

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} failed (${result.status}): ${result.stderr ?? ''}`,
    );
  return result.stdout ?? '';
}

function buildTrainingTool(projectRoot, executable) {
  if (fs.existsSync(executable)) return;
  const fastTextRoot = path.join(projectRoot, 'third_party', 'fasttext');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  const sources = [
    'args.cc',
    'matrix.cc',
    'dictionary.cc',
    'loss.cc',
    'productquantizer.cc',
    'densematrix.cc',
    'quantmatrix.cc',
    'vector.cc',
    'model.cc',
    'utils.cc',
    'meter.cc',
    'fasttext.cc',
    'main.cc',
  ].map(file => path.join('src', file));
  run(
    process.env.CXX || 'g++',
    [
      '-std=c++11',
      '-O2',
      '-DNDEBUG',
      '-DQINGJI_FASTTEXT_SINGLE_THREAD',
      ...sources,
      '-o',
      executable,
    ],
    fastTextRoot,
  );
}

function checkedPreparedRows(preparedDir, allowSmall) {
  const manifestFile = path.join(preparedDir, 'manifest.json');
  if (!fs.existsSync(manifestFile))
    throw new Error('DATA_NOT_READY: prepared category manifest is missing.');
  const manifestText = fs.readFileSync(manifestFile, 'utf8');
  const manifest = JSON.parse(manifestText);
  const result = { manifest, manifestSha256: sha256(manifestText), rows: {} };
  for (const key of ['train', 'validation', 'frozenTest']) {
    const spec = manifest.files?.[key];
    const file =
      spec === undefined ? undefined : path.join(preparedDir, spec.file);
    if (file === undefined || !fs.existsSync(file))
      throw new Error(`DATA_NOT_READY: ${key} split is missing.`);
    const contents = fs.readFileSync(file, 'utf8');
    if (sha256(contents) !== spec.sha256)
      throw new Error(`DATA_NOT_READY: ${key} split hash mismatch.`);
    result.rows[key] = validateRows(contents, 'category');
  }
  if (
    !allowSmall &&
    (result.rows.train.length < 27000 ||
      result.rows.validation.length < 4500 ||
      result.rows.frozenTest.length < 9000)
  ) {
    throw new Error(
      'DATA_NOT_READY: production training requires 27000 train, 4500 validation, and 9000 frozen rows.',
    );
  }
  return result;
}

function trainingLine(row) {
  const text = row.normalizedModelText.replace(/[\r\n]+/gu, ' ').trim();
  return `__label__${row.label} ${text}`;
}

function parsePredictions(stdout, expectedRows, latencyMs) {
  const lines = stdout.split(/\r?\n/u).filter(Boolean);
  if (lines.length !== expectedRows.length)
    throw new Error(
      `fastText emitted ${lines.length} predictions for ${expectedRows.length} rows.`,
    );
  return lines.map((line, index) => {
    const fields = line.trim().split(/\s+/u);
    const probabilities = [];
    for (let field = 0; field < fields.length; field += 2) {
      probabilities.push({
        label: fields[field].replace(/^__label__/u, ''),
        probability: Number(fields[field + 1]),
      });
    }
    const byLabel = new Map(
      probabilities.map(item => [item.label, item.probability]),
    );
    const total = LABELS.reduce(
      (sum, label) => sum + (byLabel.get(label) ?? 0),
      0,
    );
    return {
      id: expectedRows[index].id,
      expectedLabel: expectedRows[index].label,
      probabilities: LABELS.map(label => ({
        label,
        probability:
          total === 0 ? 1 / LABELS.length : (byLabel.get(label) ?? 0) / total,
      })),
      latencyMs,
    };
  });
}

function train(options) {
  const projectRoot = options.root ?? process.cwd();
  const preparedDir = path.resolve(
    projectRoot,
    options.preparedDir ?? 'data/synthetic/prepared/category-v3',
  );
  const candidateDir = path.resolve(
    projectRoot,
    options.candidateDir ??
      path.join('build', 'model-candidates', `category-v3-${Date.now()}`),
  );
  if (fs.existsSync(candidateDir))
    throw new Error(`Candidate directory already exists: ${candidateDir}`);
  const prepared = checkedPreparedRows(
    preparedDir,
    options.allowSmall === true,
  );
  fs.mkdirSync(candidateDir, { recursive: true });
  const tool = path.join(
    projectRoot,
    'build',
    'bill-classifier-tools',
    process.platform === 'win32' ? 'fasttext-qingji.exe' : 'fasttext-qingji',
  );
  buildTrainingTool(projectRoot, tool);
  const trainFile = path.join(candidateDir, 'train.txt');
  const validationFile = path.join(candidateDir, 'validation.txt');
  fs.writeFileSync(
    trainFile,
    `${prepared.rows.train.map(trainingLine).join('\n')}\n`,
  );
  fs.writeFileSync(
    validationFile,
    `${prepared.rows.validation.map(row => row.normalizedModelText.replace(/[\r\n]+/gu, ' ')).join('\n')}\n`,
  );

  const competition = [];
  for (const config of CONFIGS) {
    const output = path.join(candidateDir, config.name);
    run(
      tool,
      [
        'supervised',
        '-input',
        trainFile,
        '-output',
        output,
        '-dim',
        String(config.dim),
        '-epoch',
        String(config.epoch),
        '-lr',
        String(config.lr),
        '-minn',
        '2',
        '-maxn',
        '5',
        '-wordNgrams',
        '2',
        '-bucket',
        String(config.bucket),
        '-minCount',
        '1',
        '-loss',
        'softmax',
        '-thread',
        '1',
        '-verbose',
        '0',
      ],
      projectRoot,
    );
    run(
      tool,
      [
        'quantize',
        '-input',
        trainFile,
        '-output',
        output,
        '-qnorm',
        '-retrain',
        '-cutoff',
        '12000',
        '-dsub',
        '2',
        '-thread',
        '1',
        '-verbose',
        '0',
      ],
      projectRoot,
    );
    const started = process.hrtime.bigint();
    const predictionText = run(
      tool,
      ['predict-prob', `${output}.ftz`, validationFile, String(LABELS.length)],
      projectRoot,
      true,
    );
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    const predictions = parsePredictions(
      predictionText,
      prepared.rows.validation,
      elapsedMs / prepared.rows.validation.length,
    );
    const calibration = selectTemperature(predictions);
    const operatingPoint = selectOperatingPoint(
      predictions,
      calibration.temperature,
    );
    if (operatingPoint === undefined)
      throw new Error(
        `${config.name} cannot reach 99% validation accepted precision.`,
      );
    competition.push({
      config,
      modelFile: `${output}.ftz`,
      calibration,
      operatingPoint,
      predictions,
    });
  }
  competition.sort(
    (left, right) =>
      right.operatingPoint.metrics.macroF1 -
        left.operatingPoint.metrics.macroF1 ||
      right.operatingPoint.metrics.coverage -
        left.operatingPoint.metrics.coverage,
  );
  const winner = competition[0];
  const categoryPolicies = selectCategoryPolicies(
    winner.predictions,
    winner.calibration.temperature,
    { alwaysDisabled: ['expense.other_expense'] },
  );
  const enabledPolicies = Object.values(categoryPolicies).filter(
    policy => policy.enabled,
  );
  if (enabledPolicies.length === 0) {
    throw new Error('No category policy passed the 99% precision gate.');
  }
  const finalModel = path.join(candidateDir, 'category-v3.ftz');
  fs.copyFileSync(winner.modelFile, finalModel);
  const modelBytes = fs.readFileSync(finalModel);
  const manifest = {
    schemaVersion: 2,
    modelId: 'qingji-bill-category-fasttext',
    candidateId: 'M2_FASTTEXT',
    modelFamily: 'quantized_fasttext',
    complexityRank: 2,
    modelVersion: options.modelVersion ?? `3.0.0-candidate.${Date.now()}`,
    taxonomyVersion: 3,
    labels: LABELS,
    fastText: {
      version: '0.9.2',
      commit: '5b5943c118b0ec5fb9cd8d20587de2b2d3966dfe',
      license: 'MIT',
    },
    thresholds: {
      // The native core applies this permissive floor first. Platform adapters
      // then enforce the stricter winning-label policy from categoryPolicies.
      unifiedConfidence: Math.min(
        ...enabledPolicies.map(policy => policy.confidenceThreshold),
      ),
      unifiedMargin: Math.min(
        ...enabledPolicies.map(policy => policy.marginThreshold),
      ),
    },
    calibrationTemperature: winner.calibration.temperature,
    categoryPolicies,
    trainingData: {
      preparedManifestSha256: prepared.manifestSha256,
      trainRows: prepared.rows.train.length,
      validationRows: prepared.rows.validation.length,
      frozenRowsHeldOut: prepared.rows.frozenTest.length,
    },
    candidateStatus: 'FROZEN_EVALUATION_REQUIRED',
    models: [
      {
        name: 'category-v3.ftz',
        sizeBytes: modelBytes.length,
        sha256: crypto.createHash('sha256').update(modelBytes).digest('hex'),
      },
    ],
    competition: competition.map(entry => ({
      config: entry.config,
      calibration: entry.calibration,
      validationMetrics: entry.operatingPoint.metrics,
      operatingPoint: entry.operatingPoint.options,
    })),
  };
  fs.writeFileSync(
    path.join(candidateDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(
    `Unified candidate written to ${candidateDir}; frozen evaluation is still required.\n`,
  );
  return manifest;
}

function main(argv) {
  const args = parseArgs(argv);
  train({
    preparedDir: args['prepared-dir'],
    candidateDir: args['candidate-dir'],
    modelVersion: args['model-version'],
    allowSmall: args['allow-small-dev-dataset'] === true,
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

module.exports = {
  buildTrainingTool,
  checkedPreparedRows,
  parsePredictions,
  train,
  trainingLine,
};
