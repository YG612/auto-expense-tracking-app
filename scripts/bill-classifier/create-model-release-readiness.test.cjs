const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { sha256 } = require('../synthetic-data/pipeline-utils.cjs');
const {
  createModelReleaseReadiness,
} = require('./create-model-release-readiness.cjs');
const {
  evaluateShadowObservations,
} = require('./evaluate-shadow-observations.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-release-ready-'));
  const file = name => path.join(root, name);
  const write = (name, value) => {
    fs.writeFileSync(file(name), `${JSON.stringify(value)}\n`);
    return file(name);
  };
  write('prepared-manifest.json', { schemaVersion: 1, files: {} });
  write('human-audit.json', {
    status: 'PASS',
    attestation: 'HUMAN_REVIEWED',
    preparedManifestSha256: sha256(
      fs.readFileSync(file('prepared-manifest.json')),
    ),
    sampleCount: 450,
    auditor: 'release-owner',
  });
  write('runtime-report.json', {
    schemaVersion: 1,
    modelVersion: '3.0.0-test',
    deploymentMode: 'BENCHMARK_ONLY',
    allowAutoCommit: false,
    crossPlatformGoldenVectorsPassed: true,
  });
  const selected = {
    candidateId: 'M2_FASTTEXT',
    modelVersion: '3.0.0-test',
    manifestSha256: 'a'.repeat(64),
  };
  write('selection-report.json', {
    selection: { winner: selected.candidateId, selected },
  });
  write('completion.json', {
    status: 'MODEL_SELECTION_COMPLETE',
    allowAutoCommit: false,
    candidateId: selected.candidateId,
    modelVersion: selected.modelVersion,
    manifestSha256: selected.manifestSha256,
    selectionReportSha256: sha256(
      fs.readFileSync(file('selection-report.json')),
    ),
    runtimeReportSha256: sha256(fs.readFileSync(file('runtime-report.json'))),
    preparedManifestSha256: sha256(
      fs.readFileSync(file('prepared-manifest.json')),
    ),
    humanAuditSha256: sha256(fs.readFileSync(file('human-audit.json'))),
  });
  write('approval.json', {
    schemaVersion: 1,
    status: 'APPROVED_FOR_SHADOW',
    humanAttestation: 'HUMAN_REVIEWED',
    candidateId: selected.candidateId,
    modelVersion: selected.modelVersion,
    manifestSha256: selected.manifestSha256,
    selectionReportSha256: sha256(
      fs.readFileSync(file('selection-report.json')),
    ),
    completionReceiptSha256: sha256(fs.readFileSync(file('completion.json'))),
    approvedBy: 'release-owner',
    approvedAt: '2026-08-17T10:00:00.000Z',
  });
  write('activation.json', {
    status: 'MODEL_SELECTED_FOR_SHADOW',
    allowAutoCommit: false,
    modelVersion: selected.modelVersion,
    manifestSha256: selected.manifestSha256,
    selectionReportSha256: sha256(
      fs.readFileSync(file('selection-report.json')),
    ),
    completionReceiptSha256: sha256(fs.readFileSync(file('completion.json'))),
    approvalSha256: sha256(fs.readFileSync(file('approval.json'))),
  });
  const labels = [
    'income',
    'expense.food',
    'expense.transport',
    'expense.shopping',
    'expense.housing',
    'expense.entertainment',
    'expense.healthcare',
    'expense.education',
  ];
  write('shadow-manifest.json', {
    schemaVersion: 2,
    modelVersion: selected.modelVersion,
    categoryPolicies: Object.fromEntries(
      [...labels, 'expense.other_expense'].map(label => [
        label,
        { enabled: label !== 'expense.other_expense' },
      ]),
    ),
    deployment: {
      mode: 'SHADOW',
      allowAutoCommit: false,
      selectionReportSha256: sha256(
        fs.readFileSync(file('selection-report.json')),
      ),
      completionReceiptSha256: sha256(fs.readFileSync(file('completion.json'))),
      activationSha256: sha256(fs.readFileSync(file('activation.json'))),
    },
  });
  write('stage-receipt.json', {
    status: 'SHADOW_ASSETS_STAGED',
    allowAutoCommit: false,
    manifestSha256: sha256(fs.readFileSync(file('shadow-manifest.json'))),
    activationSha256: sha256(fs.readFileSync(file('activation.json'))),
    completionReceiptSha256: sha256(fs.readFileSync(file('completion.json'))),
  });
  const start = Date.parse('2026-08-01T00:00:00.000Z');
  const observations = Array.from({ length: 500 }, (_, index) => {
    const label = labels[index % labels.length];
    return {
      id: `observation-${index}`,
      transactionId: `transaction-${index}`,
      modelId: 'qingji-bill-category-fasttext',
      modelVersion: selected.modelVersion,
      taxonomyVersion: 3,
      predictedCategoryKey: label,
      finalCategoryKey: label,
      matched: true,
      calibratedConfidence: 0.995,
      latencyMs: 2,
      createdAt: new Date(start + (index % 7) * 86_400_000).toISOString(),
      autoCommitted: false,
    };
  });
  fs.writeFileSync(
    file('observations.jsonl'),
    `${observations.map(row => JSON.stringify(row)).join('\n')}\n`,
  );
  const config = path.resolve(
    __dirname,
    '..',
    '..',
    'ml/category-classifier/config/shadow_observation.json',
  );
  evaluateShadowObservations({
    observations: file('observations.jsonl'),
    selectionReport: file('selection-report.json'),
    activation: file('activation.json'),
    shadowManifest: file('shadow-manifest.json'),
    config,
    output: file('shadow-report.json'),
  });
  return { root, file, config };
}

function options({ root, file, config }, output) {
  return {
    root,
    selectionReport: file('selection-report.json'),
    completionReceipt: file('completion.json'),
    runtimeReport: file('runtime-report.json'),
    humanAudit: file('human-audit.json'),
    preparedManifest: file('prepared-manifest.json'),
    approval: file('approval.json'),
    activation: file('activation.json'),
    shadowManifest: file('shadow-manifest.json'),
    shadowStageReceipt: file('stage-receipt.json'),
    shadowReport: file('shadow-report.json'),
    shadowConfig: config,
    observations: file('observations.jsonl'),
    output: file(output),
  };
}

test('creates a fully hash-bound release readiness proof after shadow observation', () => {
  const current = fixture();
  const report = createModelReleaseReadiness(options(current, 'ready.json'));
  assert.equal(report.status, 'MODEL_RELEASE_READY');
  assert.equal(report.allowAutoCommit, false);
  assert.equal(report.observationCount, 500);
  assert.ok(Object.values(report.checks).every(Boolean));
});

test('rejects a human approval changed after shadow activation', () => {
  const current = fixture();
  const approval = JSON.parse(
    fs.readFileSync(current.file('approval.json'), 'utf8'),
  );
  approval.approvedBy = 'different-person';
  fs.writeFileSync(current.file('approval.json'), JSON.stringify(approval));
  assert.throws(
    () => createModelReleaseReadiness(options(current, 'ready.json')),
    /MODEL_RELEASE_NOT_READY: activation/u,
  );
});
