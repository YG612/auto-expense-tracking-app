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

function stageShadowModel(options) {
  const root = options.root ?? process.cwd();
  for (const key of [
    'selectionReport',
    'completionReceipt',
    'activation',
    'outputRoot',
  ]) {
    if (typeof options[key] !== 'string')
      throw new Error(`--${key} is required.`);
  }
  const selectionFile = path.resolve(root, options.selectionReport);
  const completionFile = path.resolve(root, options.completionReceipt);
  const activationFile = path.resolve(root, options.activation);
  const outputRoot = path.resolve(root, options.outputRoot);
  if (fs.existsSync(outputRoot)) {
    throw new Error('Shadow output root already exists; staging is immutable.');
  }
  const selection = readJsonBytes(selectionFile, 'selection report');
  const completion = readJsonBytes(completionFile, 'selection completion');
  const activation = readJsonBytes(activationFile, 'shadow activation');
  const selected = selection.value.selection?.selected;
  if (
    selected === undefined ||
    selection.value.selection?.winner !== selected.candidateId ||
    activation.value.status !== 'MODEL_SELECTED_FOR_SHADOW' ||
    activation.value.allowAutoCommit !== false ||
    activation.value.candidateId !== selected.candidateId ||
    activation.value.modelVersion !== selected.modelVersion ||
    activation.value.manifestSha256 !== selected.manifestSha256 ||
    activation.value.selectionReportSha256 !== sha256(selection.bytes) ||
    activation.value.completionReceiptSha256 !== sha256(completion.bytes) ||
    completion.value.status !== 'MODEL_SELECTION_COMPLETE' ||
    completion.value.allowAutoCommit !== false ||
    completion.value.candidateId !== selected.candidateId ||
    completion.value.modelVersion !== selected.modelVersion ||
    completion.value.manifestSha256 !== selected.manifestSha256 ||
    completion.value.selectionReportSha256 !== sha256(selection.bytes) ||
    !/^[a-f0-9]{64}$/u.test(completion.value.humanAuditSha256 ?? '') ||
    Number.isNaN(Date.parse(activation.value.approvedAt))
  ) {
    throw new Error(
      'SHADOW_STAGE_INVALID: activation does not bind the winner.',
    );
  }
  const candidateDirectory = path.resolve(root, selected.directory);
  const candidateManifestFile = path.join(candidateDirectory, 'manifest.json');
  const candidate = readJsonBytes(candidateManifestFile, 'candidate manifest');
  if (
    sha256(candidate.bytes) !== selected.manifestSha256 ||
    candidate.value.schemaVersion !== 2 ||
    candidate.value.candidateStatus !== 'FROZEN_EVALUATION_REQUIRED' ||
    candidate.value.models?.length !== 1 ||
    candidate.value.models[0].name !== 'category-v3.ftz'
  ) {
    throw new Error(
      'SHADOW_STAGE_INVALID: selected candidate is not immutable.',
    );
  }
  const modelSpec = candidate.value.models[0];
  const modelSource = path.join(candidateDirectory, modelSpec.name);
  const modelBytes = fs.readFileSync(modelSource);
  if (
    modelBytes.length !== modelSpec.sizeBytes ||
    sha256(modelBytes) !== modelSpec.sha256
  ) {
    throw new Error('SHADOW_STAGE_INVALID: candidate model integrity failed.');
  }
  const activationSha256 = sha256(activation.bytes);
  const stagedManifest = {
    ...candidate.value,
    candidateStatus: undefined,
    deployment: {
      mode: 'SHADOW',
      allowAutoCommit: false,
      candidateId: selected.candidateId,
      selectionReportSha256: sha256(selection.bytes),
      completionReceiptSha256: sha256(completion.bytes),
      activationSha256,
      approvedBy: activation.value.approvedBy,
      approvedAt: activation.value.approvedAt,
    },
  };
  delete stagedManifest.candidateStatus;
  const modelDirectory = path.join(outputRoot, 'bill-classifier');
  fs.mkdirSync(modelDirectory, { recursive: true });
  fs.copyFileSync(modelSource, path.join(modelDirectory, modelSpec.name));
  const noticesSource = path.join(
    root,
    'models',
    'bill-classifier',
    'THIRD_PARTY_NOTICES.txt',
  );
  fs.copyFileSync(
    noticesSource,
    path.join(modelDirectory, 'THIRD_PARTY_NOTICES.txt'),
  );
  atomicWrite(
    path.join(modelDirectory, 'manifest.json'),
    `${JSON.stringify(stagedManifest, null, 2)}\n`,
  );
  atomicWrite(
    path.join(modelDirectory, 'taxonomy.json'),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        taxonomyVersion: 3,
        labels: candidate.value.labels,
      },
      null,
      2,
    )}\n`,
  );
  atomicWrite(
    path.join(modelDirectory, 'sbom.json'),
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
            purl: `pkg:github/facebookresearch/fastText@${candidate.value.fastText.commit}`,
          },
          {
            type: 'machine-learning-model',
            name: candidate.value.modelId,
            version: candidate.value.modelVersion,
            hashes: [{ alg: 'SHA-256', content: modelSpec.sha256 }],
            properties: [
              { name: 'deploymentMode', value: 'SHADOW' },
              { name: 'allowAutoCommit', value: 'false' },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  fs.copyFileSync(
    selectionFile,
    path.join(modelDirectory, 'selection_report.json'),
  );
  fs.copyFileSync(
    activationFile,
    path.join(modelDirectory, 'shadow-activation.json'),
  );
  fs.copyFileSync(
    completionFile,
    path.join(modelDirectory, 'MODEL_SELECTION_COMPLETE.json'),
  );
  const stagedManifestBytes = fs.readFileSync(
    path.join(modelDirectory, 'manifest.json'),
  );
  const receipt = {
    schemaVersion: 1,
    status: 'SHADOW_ASSETS_STAGED',
    assetsRoot: outputRoot,
    modelDirectory,
    modelVersion: selected.modelVersion,
    modelSha256: modelSpec.sha256,
    manifestSha256: sha256(stagedManifestBytes),
    selectionReportSha256: sha256(selection.bytes),
    completionReceiptSha256: sha256(completion.bytes),
    activationSha256,
    allowAutoCommit: false,
  };
  atomicWrite(
    path.join(outputRoot, 'shadow-stage-receipt.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

function main(argv) {
  const args = parseArgs(argv);
  const receipt = stageShadowModel({
    selectionReport: args['selection-report'],
    completionReceipt: args['completion-receipt'],
    activation: args.activation,
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

module.exports = { stageShadowModel };
