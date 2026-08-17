const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWrite,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
  ];
}

function finiteSamples(values, minimum, label) {
  if (
    !Array.isArray(values) ||
    values.length < minimum ||
    values.some(
      value =>
        typeof value !== 'number' || !Number.isFinite(value) || value < 0,
    )
  ) {
    throw new Error(
      `${label} requires at least ${minimum} finite non-negative samples.`,
    );
  }
  return values;
}

function readJson(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing (${file}).`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readGolden(file, label) {
  const rows = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  if (rows.length < 50)
    throw new Error(`${label} requires at least 50 vectors.`);
  const byId = new Map();
  for (const row of rows) {
    if (
      typeof row.id !== 'string' ||
      byId.has(row.id) ||
      typeof row.abstained !== 'boolean' ||
      (row.parentCategoryKey !== undefined &&
        row.parentCategoryKey !== null &&
        typeof row.parentCategoryKey !== 'string') ||
      (row.reason !== undefined &&
        row.reason !== null &&
        typeof row.reason !== 'string')
    ) {
      throw new Error(`${label} contains a malformed or duplicate vector.`);
    }
    byId.set(
      row.id,
      JSON.stringify({
        parentCategoryKey: row.parentCategoryKey ?? null,
        abstained: row.abstained,
        reason: row.reason ?? null,
      }),
    );
  }
  return byId;
}

function goldenVectorsMatch(vectors) {
  const [first, ...rest] = vectors;
  return rest.every(candidate => {
    if (candidate.size !== first.size) return false;
    for (const [id, value] of first) {
      if (candidate.get(id) !== value) return false;
    }
    return true;
  });
}

function evidenceSpec(file, outputFile) {
  return {
    file: path.relative(path.dirname(outputFile), file),
    sha256: sha256(fs.readFileSync(file)),
  };
}

function createRuntimeReport(options) {
  const root = options.root ?? process.cwd();
  const required = [
    'manifest',
    'baselineApk',
    'candidateApk',
    'androidBuildReceipt',
    'benchmark',
    'iosBenchmark',
    'iosDeviceEvidence',
    'androidGolden',
    'iosGolden',
    'hostGolden',
    'frozenLock',
    'output',
  ];
  for (const key of required) {
    if (typeof options[key] !== 'string')
      throw new Error(`--${key} is required.`);
  }
  const files = Object.fromEntries(
    required.map(key => [key, path.resolve(root, options[key])]),
  );
  if (fs.existsSync(files.output))
    throw new Error('Runtime report already exists.');
  const manifestBytes = fs.readFileSync(files.manifest);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const benchmarkManifestSha256 = sha256(manifestBytes);
  const receipt = readJson(files.androidBuildReceipt, 'Android build receipt');
  const candidateApk = files.candidateApk;
  const benchmark = readJson(files.benchmark, 'runtime benchmark');
  const iosBenchmark = readJson(files.iosBenchmark, 'iOS runtime benchmark');
  const frozenLock = readJson(files.frozenLock, 'frozen evaluation lock');
  if (
    manifest.schemaVersion !== 2 ||
    receipt.status !== 'ANDROID_BENCHMARK_BUILD_COMPLETE' ||
    receipt.deploymentMode !== 'BENCHMARK_ONLY' ||
    receipt.variant !== 'Internal' ||
    receipt.allowAutoCommit !== false ||
    receipt.billClassifierManifestSha256 !== benchmarkManifestSha256 ||
    !fs.existsSync(candidateApk) ||
    sha256(fs.readFileSync(candidateApk)) !== receipt.apkSha256 ||
    benchmark.schemaVersion !== 1 ||
    benchmark.modelManifestSha256 !== benchmarkManifestSha256 ||
    benchmark.modelVersion !== manifest.modelVersion ||
    benchmark.source !== 'ANDROID_ARM64_BENCHMARK_ONLY_EXECUTABLE' ||
    benchmark.allowAutoCommit !== false ||
    iosBenchmark.schemaVersion !== 1 ||
    iosBenchmark.modelManifestSha256 !== benchmarkManifestSha256 ||
    iosBenchmark.modelVersion !== manifest.modelVersion ||
    iosBenchmark.source !== 'IOS_ARM64_BENCHMARK_ONLY_APP' ||
    iosBenchmark.deploymentMode !== 'BENCHMARK_ONLY' ||
    iosBenchmark.allowAutoCommit !== false ||
    iosBenchmark.device?.platform !== 'ios' ||
    iosBenchmark.device?.physicalDevice !== true ||
    iosBenchmark.goldenSha256 !== sha256(fs.readFileSync(files.iosGolden)) ||
    iosBenchmark.deviceEvidenceSha256 !==
      sha256(fs.readFileSync(files.iosDeviceEvidence)) ||
    !/^[a-f0-9]{64}$/u.test(
      manifest.deployment?.candidateManifestSha256 ?? '',
    ) ||
    frozenLock.status !== 'COMPLETE' ||
    frozenLock.modelSha256 !== manifest.models?.[0]?.sha256
  ) {
    throw new Error('Runtime evidence does not bind the staged model version.');
  }
  const latencyMs = finiteSamples(benchmark.latencyMs, 100, 'latencyMs');
  const baselinePssMb = finiteSamples(
    benchmark.baselinePssMb,
    3,
    'baselinePssMb',
  );
  const candidatePssMb = finiteSamples(
    benchmark.candidatePssMb,
    3,
    'candidatePssMb',
  );
  const iosLatencyMs = finiteSamples(
    iosBenchmark.latencyMs,
    100,
    'iOS latencyMs',
  );
  const iosBaselineMemoryMb = finiteSamples(
    iosBenchmark.baselineMemoryMb,
    3,
    'iOS baselineMemoryMb',
  );
  const iosCandidateMemoryMb = finiteSamples(
    iosBenchmark.candidateMemoryMb,
    3,
    'iOS candidateMemoryMb',
  );
  const goldenFiles = [files.androidGolden, files.iosGolden, files.hostGolden];
  const golden = [
    readGolden(files.androidGolden, 'Android golden vectors'),
    readGolden(files.iosGolden, 'iOS golden vectors'),
    readGolden(files.hostGolden, 'host golden vectors'),
  ];
  if (!goldenVectorsMatch(golden)) {
    throw new Error('Cross-platform golden vectors do not match.');
  }
  const evidenceFiles = {
    benchmarkManifest: files.manifest,
    androidBuildReceipt: files.androidBuildReceipt,
    candidateApk,
    baselineApk: files.baselineApk,
    benchmark: files.benchmark,
    iosBenchmark: files.iosBenchmark,
    iosDeviceEvidence: files.iosDeviceEvidence,
    androidGolden: goldenFiles[0],
    iosGolden: goldenFiles[1],
    hostGolden: goldenFiles[2],
    frozenLock: files.frozenLock,
  };
  for (const [name, file] of Object.entries(evidenceFiles)) {
    if (!fs.existsSync(file))
      throw new Error(`${name} evidence is missing (${file}).`);
  }
  const report = {
    schemaVersion: 1,
    modelVersion: manifest.modelVersion,
    manifestSha256: manifest.deployment.candidateManifestSha256,
    benchmarkManifestSha256,
    deploymentMode: 'BENCHMARK_ONLY',
    allowAutoCommit: false,
    generatedAt: new Date().toISOString(),
    device: benchmark.device,
    devices: {
      android: benchmark.device,
      ios: iosBenchmark.device,
    },
    apkDeltaBytes: Math.max(
      0,
      fs.statSync(candidateApk).size - fs.statSync(files.baselineApk).size,
    ),
    p95LatencyMs: Math.max(
      percentile(latencyMs, 0.95),
      percentile(iosLatencyMs, 0.95),
    ),
    extraPeakPssMb: Math.max(
      0,
      Math.max(...candidatePssMb) - Math.max(...baselinePssMb),
      Math.max(...iosCandidateMemoryMb) - Math.max(...iosBaselineMemoryMb),
    ),
    platformMetrics: {
      android: {
        p95LatencyMs: percentile(latencyMs, 0.95),
        extraPeakMemoryMb: Math.max(
          0,
          Math.max(...candidatePssMb) - Math.max(...baselinePssMb),
        ),
      },
      ios: {
        p95LatencyMs: percentile(iosLatencyMs, 0.95),
        extraPeakMemoryMb: Math.max(
          0,
          Math.max(...iosCandidateMemoryMb) - Math.max(...iosBaselineMemoryMb),
        ),
      },
    },
    frozenEvaluationCount: 1,
    crossPlatformGoldenVectorsPassed: true,
    goldenVectorCount: golden[0].size,
    evidence: Object.fromEntries(
      Object.entries(evidenceFiles).map(([name, file]) => [
        name,
        evidenceSpec(file, files.output),
      ]),
    ),
  };
  atomicWrite(files.output, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function main(argv) {
  const args = parseArgs(argv);
  const report = createRuntimeReport({
    manifest: args.manifest,
    baselineApk: args['baseline-apk'],
    candidateApk: args['candidate-apk'],
    androidBuildReceipt: args['android-build-receipt'],
    benchmark: args.benchmark,
    iosBenchmark: args['ios-benchmark'],
    iosDeviceEvidence: args['ios-device-evidence'],
    androidGolden: args['android-golden'],
    iosGolden: args['ios-golden'],
    hostGolden: args['host-golden'],
    frozenLock: args['frozen-lock'],
    output: args.output,
  });
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

module.exports = {
  createRuntimeReport,
  finiteSamples,
  goldenVectorsMatch,
  percentile,
  readGolden,
};
