const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { sha256 } = require('../synthetic-data/pipeline-utils.cjs');
const { stageShadowModel } = require('./stage-shadow-model.cjs');

test('stages only an approval-bound winner with auto-commit disabled', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-stage-'));
  const candidateDirectory = path.join(root, 'candidate');
  const metadataDirectory = path.join(root, 'models', 'bill-classifier');
  fs.mkdirSync(candidateDirectory, { recursive: true });
  fs.mkdirSync(metadataDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(metadataDirectory, 'THIRD_PARTY_NOTICES.txt'),
    'fastText MIT\n',
  );
  const modelBytes = Buffer.from('test-model');
  fs.writeFileSync(
    path.join(candidateDirectory, 'category-v3.ftz'),
    modelBytes,
  );
  const labels = [
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
  const candidateManifest = {
    schemaVersion: 2,
    modelId: 'qingji-bill-category-fasttext',
    modelVersion: '3.0.0-test',
    taxonomyVersion: 3,
    labels,
    fastText: { version: '0.9.2', commit: 'a'.repeat(40), license: 'MIT' },
    candidateStatus: 'FROZEN_EVALUATION_REQUIRED',
    models: [
      {
        name: 'category-v3.ftz',
        sizeBytes: modelBytes.length,
        sha256: sha256(modelBytes),
      },
    ],
  };
  const candidateManifestFile = path.join(candidateDirectory, 'manifest.json');
  fs.writeFileSync(
    candidateManifestFile,
    `${JSON.stringify(candidateManifest)}\n`,
  );
  const selectionFile = path.join(root, 'selection.json');
  const selected = {
    candidateId: 'M2_FASTTEXT',
    modelVersion: candidateManifest.modelVersion,
    directory: candidateDirectory,
    manifestSha256: sha256(fs.readFileSync(candidateManifestFile)),
  };
  fs.writeFileSync(
    selectionFile,
    `${JSON.stringify({
      selection: { winner: selected.candidateId, selected },
    })}\n`,
  );
  const activationFile = path.join(root, 'activation.json');
  const completionFile = path.join(root, 'MODEL_SELECTION_COMPLETE.json');
  fs.writeFileSync(
    completionFile,
    JSON.stringify({
      status: 'MODEL_SELECTION_COMPLETE',
      allowAutoCommit: false,
      candidateId: selected.candidateId,
      modelVersion: selected.modelVersion,
      manifestSha256: selected.manifestSha256,
      selectionReportSha256: sha256(fs.readFileSync(selectionFile)),
      humanAuditSha256: 'c'.repeat(64),
    }),
  );
  fs.writeFileSync(
    activationFile,
    `${JSON.stringify({
      status: 'MODEL_SELECTED_FOR_SHADOW',
      allowAutoCommit: false,
      candidateId: selected.candidateId,
      modelVersion: selected.modelVersion,
      manifestSha256: selected.manifestSha256,
      selectionReportSha256: sha256(fs.readFileSync(selectionFile)),
      completionReceiptSha256: sha256(fs.readFileSync(completionFile)),
      approvedBy: 'human-reviewer',
      approvedAt: '2026-08-17T10:00:00.000Z',
    })}\n`,
  );
  const outputRoot = path.join(root, 'shadow-models');
  const receipt = stageShadowModel({
    root,
    selectionReport: selectionFile,
    completionReceipt: completionFile,
    activation: activationFile,
    outputRoot,
  });
  const stagedManifest = JSON.parse(
    fs.readFileSync(
      path.join(outputRoot, 'bill-classifier', 'manifest.json'),
      'utf8',
    ),
  );
  assert.equal(receipt.allowAutoCommit, false);
  assert.equal(stagedManifest.candidateStatus, undefined);
  assert.equal(stagedManifest.deployment.mode, 'SHADOW');
  assert.equal(stagedManifest.deployment.allowAutoCommit, false);
  assert.equal(
    stagedManifest.deployment.selectionReportSha256,
    sha256(fs.readFileSync(selectionFile)),
  );
  assert.equal(
    sha256(
      fs.readFileSync(
        path.join(outputRoot, 'bill-classifier', 'shadow-activation.json'),
      ),
    ),
    stagedManifest.deployment.activationSha256,
  );
});
