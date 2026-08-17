const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const modelRoot = path.join(root, 'models', 'bill-classifier');
const manifest = JSON.parse(
  fs.readFileSync(path.join(modelRoot, 'manifest.json'), 'utf8'),
);
const taxonomy = JSON.parse(
  fs.readFileSync(path.join(modelRoot, 'taxonomy.json'), 'utf8'),
);

function fail(message) {
  throw new Error(`Bill classifier verification failed: ${message}`);
}

if (
  ![1, 2].includes(manifest.schemaVersion) ||
  manifest.modelId !== 'qingji-bill-category-fasttext' ||
  manifest.fastText?.commit !== '5b5943c118b0ec5fb9cd8d20587de2b2d3966dfe' ||
  manifest.fastText?.license !== 'MIT'
) {
  fail('manifest identity or provenance is invalid');
}
const simplifiedLabels = [
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
let expectedNames;
if (manifest.schemaVersion === 1) {
  if (
    manifest.taxonomyVersion !== taxonomy.taxonomyVersion ||
    taxonomy.expense?.length !== 13 ||
    taxonomy.income?.length !== 13
  ) {
    fail('legacy taxonomy does not match the seeded 13/13 structure');
  }
  expectedNames = new Set([
    'parent-expense.ftz',
    'parent-income.ftz',
    ...taxonomy.expense.map(parent => `child-${parent.key}.ftz`),
  ]);
} else {
  const policies = manifest.categoryPolicies;
  const policyLabels =
    policies === null || typeof policies !== 'object'
      ? []
      : Object.keys(policies).sort();
  const expectedPolicyLabels = [...simplifiedLabels].sort();
  const deployment = manifest.deployment;
  const shadowEvidenceValid =
    deployment?.mode === 'SHADOW' &&
    /^[a-f0-9]{64}$/u.test(deployment.selectionReportSha256 ?? '') &&
    /^[a-f0-9]{64}$/u.test(deployment.activationSha256 ?? '');
  const benchmarkEvidenceValid =
    deployment?.mode === 'BENCHMARK_ONLY' &&
    [
      'candidateManifestSha256',
      'evaluationReportSha256',
      'errorSlicesSha256',
      'frozenLockSha256',
    ].every(key => /^[a-f0-9]{64}$/u.test(deployment[key] ?? ''));
  if (
    manifest.taxonomyVersion !== 3 ||
    JSON.stringify(manifest.labels) !== JSON.stringify(simplifiedLabels) ||
    manifest.candidateStatus !== undefined ||
    deployment?.allowAutoCommit !== false ||
    (!shadowEvidenceValid && !benchmarkEvidenceValid) ||
    !(manifest.thresholds?.unifiedConfidence > 0) ||
    !(manifest.thresholds?.unifiedMargin > 0) ||
    !(manifest.calibrationTemperature > 0) ||
    JSON.stringify(policyLabels) !== JSON.stringify(expectedPolicyLabels) ||
    policies['expense.other_expense']?.enabled !== false ||
    simplifiedLabels
      .filter(label => label !== 'expense.other_expense')
      .some(label => {
        const policy = policies[label];
        return (
          typeof policy?.enabled !== 'boolean' ||
          (policy.enabled &&
            (!(policy.confidenceThreshold > 0) ||
              !(policy.marginThreshold > 0)))
        );
      })
  ) {
    fail('unified production manifest is not release-ready');
  }
  expectedNames = new Set(['category-v3.ftz']);
}
let total = 0;
for (const spec of manifest.models) {
  if (!expectedNames.delete(spec.name)) fail(`unexpected model ${spec.name}`);
  const file = path.join(modelRoot, spec.name);
  if (!fs.existsSync(file) || fs.statSync(file).size !== spec.sizeBytes) {
    fail(`size mismatch for ${spec.name}`);
  }
  const hash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
  if (hash !== spec.sha256) fail(`hash mismatch for ${spec.name}`);
  total += spec.sizeBytes;
}
if (expectedNames.size !== 0)
  fail(`missing models: ${[...expectedNames].join(', ')}`);
if (total > 3 * 1024 * 1024) fail(`model payload ${total} exceeds 3 MiB`);
for (const required of ['THIRD_PARTY_NOTICES.txt', 'sbom.json']) {
  if (!fs.existsSync(path.join(modelRoot, required)))
    fail(`missing ${required}`);
}
if (manifest.schemaVersion === 2) {
  const approvalEvidence =
    manifest.deployment.mode === 'SHADOW'
      ? {
          'selection_report.json': manifest.deployment.selectionReportSha256,
          'MODEL_SELECTION_COMPLETE.json':
            manifest.deployment.completionReceiptSha256,
          'shadow-activation.json': manifest.deployment.activationSha256,
        }
      : {
          'candidate-manifest.json':
            manifest.deployment.candidateManifestSha256,
          'evaluation-report.json': manifest.deployment.evaluationReportSha256,
          'error_slices.json': manifest.deployment.errorSlicesSha256,
          'frozen-evaluation-lock.json': manifest.deployment.frozenLockSha256,
        };
  for (const [name, expectedHash] of Object.entries(approvalEvidence)) {
    const file = path.join(modelRoot, name);
    if (!fs.existsSync(file)) fail(`missing ${name}`);
    const actualHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(file))
      .digest('hex');
    if (actualHash !== expectedHash) fail(`${name} approval hash mismatch`);
  }
}
process.stdout.write(
  `Verified ${manifest.models.length} locked models (${total} bytes).\n`,
);
