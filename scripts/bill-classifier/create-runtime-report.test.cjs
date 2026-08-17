const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { sha256 } = require('../synthetic-data/pipeline-utils.cjs');
const {
  createRuntimeReport,
  finiteSamples,
  goldenVectorsMatch,
  percentile,
} = require('./create-runtime-report.cjs');

test('runtime report primitives reject weak samples and compare exact outcomes', () => {
  assert.equal(percentile([1, 4, 2, 3], 0.75), 3);
  assert.throws(() => finiteSamples([1, 2], 3, 'PSS'), /at least 3/u);
  const first = new Map([
    ['a', '{"abstained":false}'],
    ['b', '{"abstained":true}'],
  ]);
  assert.equal(
    goldenVectorsMatch([first, new Map(first), new Map(first)]),
    true,
  );
  const mismatch = new Map(first);
  mismatch.set('b', '{"abstained":false}');
  assert.equal(goldenVectorsMatch([first, mismatch, new Map(first)]), false);
});

test('runtime report derives metrics from hash-bound build and device evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-runtime-'));
  const file = name => path.join(root, name);
  const modelBytes = Buffer.from('model');
  const manifest = {
    schemaVersion: 2,
    modelVersion: '3.0.0-test',
    models: [{ sha256: sha256(modelBytes) }],
    deployment: {
      mode: 'BENCHMARK_ONLY',
      allowAutoCommit: false,
      candidateManifestSha256: 'c'.repeat(64),
    },
  };
  fs.writeFileSync(file('manifest.json'), JSON.stringify(manifest));
  const manifestHash = sha256(fs.readFileSync(file('manifest.json')));
  fs.writeFileSync(file('baseline.apk'), Buffer.alloc(100));
  fs.writeFileSync(file('candidate.apk'), Buffer.alloc(125));
  fs.writeFileSync(
    file('build.json'),
    JSON.stringify({
      status: 'ANDROID_BENCHMARK_BUILD_COMPLETE',
      deploymentMode: 'BENCHMARK_ONLY',
      variant: 'Internal',
      allowAutoCommit: false,
      apkPath: file('candidate.apk'),
      apkSha256: sha256(fs.readFileSync(file('candidate.apk'))),
      billClassifierManifestSha256: manifestHash,
    }),
  );
  fs.writeFileSync(
    file('benchmark.json'),
    JSON.stringify({
      schemaVersion: 1,
      modelManifestSha256: manifestHash,
      modelVersion: manifest.modelVersion,
      device: { platform: 'android', model: 'test-device' },
      latencyMs: Array.from({ length: 100 }, (_, index) => index + 1),
      baselinePssMb: [100, 101, 102],
      candidatePssMb: [110, 111, 112],
      source: 'ANDROID_ARM64_BENCHMARK_ONLY_EXECUTABLE',
      allowAutoCommit: false,
    }),
  );
  fs.writeFileSync(
    file('frozen.json'),
    JSON.stringify({ status: 'COMPLETE', modelSha256: sha256(modelBytes) }),
  );
  const golden = `${Array.from({ length: 50 }, (_, index) =>
    JSON.stringify({
      id: `golden-${index}`,
      parentCategoryKey: 'expense.food',
      abstained: false,
      reason: null,
    }),
  ).join('\n')}\n`;
  for (const name of ['android.jsonl', 'ios.jsonl', 'host.jsonl']) {
    fs.writeFileSync(file(name), golden);
  }
  fs.writeFileSync(
    file('ios-benchmark.json'),
    JSON.stringify({
      schemaVersion: 1,
      modelManifestSha256: manifestHash,
      modelVersion: manifest.modelVersion,
      source: 'IOS_ARM64_BENCHMARK_ONLY_APP',
      deploymentMode: 'BENCHMARK_ONLY',
      allowAutoCommit: false,
      device: { platform: 'ios', physicalDevice: true, model: 'test-iphone' },
      latencyMs: Array.from({ length: 100 }, (_, index) => (index + 1) / 2),
      baselineMemoryMb: [40, 41, 42],
      candidateMemoryMb: [45, 46, 47],
      goldenSha256: sha256(fs.readFileSync(file('ios.jsonl'))),
      deviceEvidenceSha256: sha256(Buffer.from('device-evidence')),
    }),
  );
  fs.writeFileSync(file('ios-device-evidence.json'), 'device-evidence');
  const report = createRuntimeReport({
    root,
    manifest: file('manifest.json'),
    baselineApk: file('baseline.apk'),
    candidateApk: file('candidate.apk'),
    androidBuildReceipt: file('build.json'),
    benchmark: file('benchmark.json'),
    iosBenchmark: file('ios-benchmark.json'),
    iosDeviceEvidence: file('ios-device-evidence.json'),
    androidGolden: file('android.jsonl'),
    iosGolden: file('ios.jsonl'),
    hostGolden: file('host.jsonl'),
    frozenLock: file('frozen.json'),
    output: file('runtime-report.json'),
  });
  assert.equal(report.apkDeltaBytes, 25);
  assert.equal(report.p95LatencyMs, 95);
  assert.equal(report.extraPeakPssMb, 10);
  assert.equal(report.goldenVectorCount, 50);
  assert.equal(report.platformMetrics.android.p95LatencyMs, 95);
  assert.equal(report.platformMetrics.ios.p95LatencyMs, 47.5);
  assert.equal(report.deploymentMode, 'BENCHMARK_ONLY');
  assert.equal(report.allowAutoCommit, false);
  assert.equal(report.manifestSha256, 'c'.repeat(64));
  assert.equal(report.benchmarkManifestSha256, manifestHash);
  assert.match(report.evidence.candidateApk.sha256, /^[a-f0-9]{64}$/u);
});

test('runtime report rejects a shadow receipt before model selection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-runtime-shadow-'));
  const file = name => path.join(root, name);
  const modelBytes = Buffer.from('model');
  const manifest = {
    schemaVersion: 2,
    modelVersion: '3.0.0-test',
    models: [{ sha256: sha256(modelBytes) }],
    deployment: {
      mode: 'BENCHMARK_ONLY',
      allowAutoCommit: false,
      candidateManifestSha256: 'c'.repeat(64),
    },
  };
  fs.writeFileSync(file('manifest.json'), JSON.stringify(manifest));
  const manifestHash = sha256(fs.readFileSync(file('manifest.json')));
  fs.writeFileSync(file('baseline.apk'), Buffer.alloc(100));
  fs.writeFileSync(file('candidate.apk'), Buffer.alloc(125));
  fs.writeFileSync(
    file('build.json'),
    JSON.stringify({
      status: 'ANDROID_SHADOW_BUILD_COMPLETE',
      deploymentMode: 'SHADOW',
      variant: 'Internal',
      allowAutoCommit: false,
      apkPath: file('candidate.apk'),
      apkSha256: sha256(fs.readFileSync(file('candidate.apk'))),
      billClassifierManifestSha256: manifestHash,
    }),
  );
  fs.writeFileSync(
    file('benchmark.json'),
    JSON.stringify({
      schemaVersion: 1,
      modelManifestSha256: manifestHash,
      modelVersion: manifest.modelVersion,
      device: { platform: 'android', model: 'test-device' },
      latencyMs: Array.from({ length: 100 }, () => 1),
      baselinePssMb: [1, 1, 1],
      candidatePssMb: [2, 2, 2],
      source: 'ANDROID_ARM64_BENCHMARK_ONLY_EXECUTABLE',
      allowAutoCommit: false,
    }),
  );
  fs.writeFileSync(
    file('frozen.json'),
    JSON.stringify({ status: 'COMPLETE', modelSha256: sha256(modelBytes) }),
  );
  const golden = `${Array.from({ length: 50 }, (_, index) =>
    JSON.stringify({
      id: `golden-${index}`,
      parentCategoryKey: 'expense.food',
      abstained: false,
      reason: null,
    }),
  ).join('\n')}\n`;
  for (const name of ['android.jsonl', 'ios.jsonl', 'host.jsonl']) {
    fs.writeFileSync(file(name), golden);
  }
  fs.writeFileSync(
    file('ios-benchmark.json'),
    JSON.stringify({
      schemaVersion: 1,
      modelManifestSha256: manifestHash,
      modelVersion: manifest.modelVersion,
      source: 'IOS_ARM64_BENCHMARK_ONLY_APP',
      deploymentMode: 'BENCHMARK_ONLY',
      allowAutoCommit: false,
      device: { platform: 'ios', physicalDevice: true, model: 'test-iphone' },
      latencyMs: Array.from({ length: 100 }, () => 1),
      baselineMemoryMb: [1, 1, 1],
      candidateMemoryMb: [2, 2, 2],
      goldenSha256: sha256(fs.readFileSync(file('ios.jsonl'))),
      deviceEvidenceSha256: sha256(Buffer.from('device-evidence')),
    }),
  );
  fs.writeFileSync(file('ios-device-evidence.json'), 'device-evidence');

  assert.throws(
    () =>
      createRuntimeReport({
        root,
        manifest: file('manifest.json'),
        baselineApk: file('baseline.apk'),
        candidateApk: file('candidate.apk'),
        androidBuildReceipt: file('build.json'),
        benchmark: file('benchmark.json'),
        iosBenchmark: file('ios-benchmark.json'),
        iosDeviceEvidence: file('ios-device-evidence.json'),
        androidGolden: file('android.jsonl'),
        iosGolden: file('ios.jsonl'),
        hostGolden: file('host.jsonl'),
        frozenLock: file('frozen.json'),
        output: file('runtime-report.json'),
      }),
    /does not bind the staged model version/u,
  );
});
