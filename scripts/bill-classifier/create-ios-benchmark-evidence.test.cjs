const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { sha256 } = require('../synthetic-data/pipeline-utils.cjs');
const {
  createIosBenchmarkEvidence,
} = require('./create-ios-benchmark-evidence.cjs');

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-ios-evidence-'));
  const file = name => path.join(root, name);
  const manifest = {
    schemaVersion: 2,
    modelVersion: '3.0.0-test',
    deployment: { mode: 'BENCHMARK_ONLY', allowAutoCommit: false },
  };
  fs.writeFileSync(file('manifest.json'), JSON.stringify(manifest));
  const manifestHash = sha256(fs.readFileSync(file('manifest.json')));
  const golden = `${Array.from({ length: 100 }, (_, index) =>
    JSON.stringify({
      id: `golden-${index}`,
      parentCategoryKey: 'expense.food',
      abstained: false,
      reason: null,
      latencyMs: index / 100,
    }),
  ).join('\n')}\n`;
  fs.writeFileSync(file('golden.jsonl'), golden);
  const evidence = {
    schemaVersion: 1,
    source: 'IOS_ARM64_BENCHMARK_ONLY_APP',
    deploymentMode: 'BENCHMARK_ONLY',
    allowAutoCommit: false,
    modelManifestSha256: manifestHash,
    modelVersion: manifest.modelVersion,
    goldenSha256: sha256(Buffer.from(golden)),
    goldenVectorCount: 100,
    device: {
      platform: 'ios',
      physicalDevice: true,
      hardwareModel: 'iPhone14,3',
      systemVersion: '18.0',
    },
    baselineMemoryMb: [40, 41, 42],
    candidateMemoryMb: [45, 46, 47],
    ...overrides,
  };
  fs.writeFileSync(file('device.json'), JSON.stringify(evidence));
  return { file, root };
}

test('creates hash-bound physical iOS benchmark evidence', () => {
  const { file } = fixture();
  const report = createIosBenchmarkEvidence({
    manifest: file('manifest.json'),
    golden: file('golden.jsonl'),
    deviceEvidence: file('device.json'),
    output: file('output.json'),
  });
  assert.equal(report.latencyMs.length, 100);
  assert.equal(report.device.physicalDevice, true);
  assert.equal(report.deploymentMode, 'BENCHMARK_ONLY');
  assert.equal(report.allowAutoCommit, false);
  assert.match(report.goldenSha256, /^[a-f0-9]{64}$/u);
  assert.match(report.deviceEvidenceSha256, /^[a-f0-9]{64}$/u);
});

test('rejects simulator or automatic-commit evidence', () => {
  for (const overrides of [
    { device: { platform: 'ios', physicalDevice: false } },
    { allowAutoCommit: true },
  ]) {
    const { file } = fixture(overrides);
    assert.throws(
      () =>
        createIosBenchmarkEvidence({
          manifest: file('manifest.json'),
          golden: file('golden.jsonl'),
          deviceEvidence: file('device.json'),
          output: file('output.json'),
        }),
      /physical-device BENCHMARK_ONLY/u,
    );
  }
});
