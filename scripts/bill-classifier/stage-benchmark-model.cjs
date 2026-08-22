const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWrite,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

function readJsonBytes(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing (${file}).`);
  const bytes = fs.readFileSync(file);
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}

function stageBenchmarkModel(options) {
  const root = options.root ?? process.cwd();
  for (const key of ['candidateDir', 'outputRoot']) {
    if (typeof options[key] !== 'string')
      throw new Error(`--${key} is required.`);
  }
  const candidateDir = path.resolve(root, options.candidateDir);
  const outputRoot = path.resolve(root, options.outputRoot);
  if (fs.existsSync(outputRoot)) {
    throw new Error(
      'Benchmark output root already exists; staging is immutable.',
    );
  }
  const manifestFile = path.join(candidateDir, 'manifest.json');
  const evaluationFile = path.join(candidateDir, 'evaluation-report.json');
  const errorSlicesFile = path.join(candidateDir, 'error_slices.json');
  const frozenLockFile = path.join(candidateDir, 'frozen-evaluation-lock.json');
  const manifest = readJsonBytes(manifestFile, 'candidate manifest');
  const evaluation = readJsonBytes(evaluationFile, 'evaluation report');
  const errorSlices = readJsonBytes(errorSlicesFile, 'error-slice report');
  const frozenLock = readJsonBytes(frozenLockFile, 'frozen lock');
  const modelSpec = manifest.value.models?.[0];
  const modelFile = path.join(candidateDir, modelSpec?.name ?? '');
  if (
    manifest.value.schemaVersion !== 2 ||
    manifest.value.candidateStatus !== 'FROZEN_EVALUATION_REQUIRED' ||
    modelSpec?.name !== 'category-v3.ftz' ||
    evaluation.value.gate?.passed !== true ||
    errorSlices.value.passed !== true ||
    frozenLock.value.status !== 'COMPLETE' ||
    frozenLock.value.modelSha256 !== modelSpec.sha256 ||
    frozenLock.value.outputSha256 !== evaluation.value.categoryResultsSha256 ||
    !fs.existsSync(modelFile) ||
    fs.statSync(modelFile).size !== modelSpec.sizeBytes ||
    sha256(fs.readFileSync(modelFile)) !== modelSpec.sha256
  ) {
    throw new Error(
      'BENCHMARK_STAGE_INVALID: candidate evidence is incomplete or mismatched.',
    );
  }
  const evidenceHashes = {
    candidateManifestSha256: sha256(manifest.bytes),
    evaluationReportSha256: sha256(evaluation.bytes),
    errorSlicesSha256: sha256(errorSlices.bytes),
    frozenLockSha256: sha256(frozenLock.bytes),
  };
  const stagedManifest = {
    ...manifest.value,
    candidateStatus: undefined,
    deployment: {
      mode: 'BENCHMARK_ONLY',
      allowAutoCommit: false,
      ...evidenceHashes,
    },
  };
  delete stagedManifest.candidateStatus;
  const modelDir = path.join(outputRoot, 'bill-classifier');
  fs.mkdirSync(modelDir, { recursive: true });
  fs.copyFileSync(modelFile, path.join(modelDir, modelSpec.name));
  for (const [source, target] of [
    [manifestFile, 'candidate-manifest.json'],
    [evaluationFile, 'evaluation-report.json'],
    [errorSlicesFile, 'error_slices.json'],
    [frozenLockFile, 'frozen-evaluation-lock.json'],
    [
      path.join(root, 'models', 'bill-classifier', 'THIRD_PARTY_NOTICES.txt'),
      'THIRD_PARTY_NOTICES.txt',
    ],
  ]) {
    fs.copyFileSync(source, path.join(modelDir, target));
  }
  atomicWrite(
    path.join(modelDir, 'manifest.json'),
    `${JSON.stringify(stagedManifest, null, 2)}\n`,
  );
  atomicWrite(
    path.join(modelDir, 'taxonomy.json'),
    `${JSON.stringify({ schemaVersion: 2, taxonomyVersion: 3, labels: manifest.value.labels }, null, 2)}\n`,
  );
  atomicWrite(
    path.join(modelDir, 'sbom.json'),
    `${JSON.stringify(
      {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        version: 1,
        components: [
          {
            type: 'library',
            name: 'fastText',
            version: '0.9.2',
            licenses: [{ license: { id: 'MIT' } }],
          },
          {
            type: 'machine-learning-model',
            name: manifest.value.modelId,
            version: manifest.value.modelVersion,
            hashes: [{ alg: 'SHA-256', content: modelSpec.sha256 }],
            properties: [
              { name: 'deploymentMode', value: 'BENCHMARK_ONLY' },
              { name: 'allowAutoCommit', value: 'false' },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const stagedManifestBytes = fs.readFileSync(
    path.join(modelDir, 'manifest.json'),
  );
  const receipt = {
    schemaVersion: 1,
    status: 'BENCHMARK_ASSETS_STAGED',
    assetsRoot: outputRoot,
    modelVersion: manifest.value.modelVersion,
    modelSha256: modelSpec.sha256,
    manifestSha256: sha256(stagedManifestBytes),
    ...evidenceHashes,
    allowAutoCommit: false,
  };
  atomicWrite(
    path.join(outputRoot, 'benchmark-stage-receipt.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

function main(argv) {
  const args = parseArgs(argv);
  const receipt = stageBenchmarkModel({
    candidateDir: args['candidate-dir'],
    outputRoot: args['output-root'],
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { stageBenchmarkModel };
