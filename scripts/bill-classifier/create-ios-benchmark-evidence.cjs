const fs = require('node:fs');

const {
  atomicWrite,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

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

function createIosBenchmarkEvidence(options) {
  for (const key of ['manifest', 'golden', 'deviceEvidence', 'output']) {
    if (typeof options[key] !== 'string')
      throw new Error(
        `--${key.replace(/[A-Z]/gu, value => `-${value.toLowerCase()}`)} is required.`,
      );
  }
  const manifestBytes = fs.readFileSync(options.manifest);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const manifestSha256 = sha256(manifestBytes);
  const evidenceBytes = fs.readFileSync(options.deviceEvidence);
  const deviceEvidence = JSON.parse(
    evidenceBytes.toString('utf8').replace(/^\uFEFF/u, ''),
  );
  const goldenBytes = fs.readFileSync(options.golden);
  const golden = goldenBytes
    .toString('utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  if (
    manifest.schemaVersion !== 2 ||
    manifest.deployment?.mode !== 'BENCHMARK_ONLY' ||
    manifest.deployment?.allowAutoCommit !== false ||
    deviceEvidence.schemaVersion !== 1 ||
    deviceEvidence.source !== 'IOS_ARM64_BENCHMARK_ONLY_APP' ||
    deviceEvidence.deploymentMode !== 'BENCHMARK_ONLY' ||
    deviceEvidence.allowAutoCommit !== false ||
    deviceEvidence.modelManifestSha256 !== manifestSha256 ||
    deviceEvidence.modelVersion !== manifest.modelVersion ||
    deviceEvidence.goldenSha256 !== sha256(goldenBytes) ||
    deviceEvidence.goldenVectorCount !== golden.length ||
    deviceEvidence.device?.platform !== 'ios' ||
    deviceEvidence.device?.physicalDevice !== true
  ) {
    throw new Error(
      'iOS benchmark evidence is not bound to a physical-device BENCHMARK_ONLY run.',
    );
  }
  if (golden.length < 100)
    throw new Error('iOS golden output requires at least 100 rows.');
  const ids = new Set();
  const latencyMs = [];
  for (const row of golden) {
    if (
      typeof row.id !== 'string' ||
      ids.has(row.id) ||
      typeof row.abstained !== 'boolean' ||
      (row.parentCategoryKey !== undefined &&
        row.parentCategoryKey !== null &&
        typeof row.parentCategoryKey !== 'string') ||
      (row.reason !== undefined &&
        row.reason !== null &&
        typeof row.reason !== 'string') ||
      typeof row.latencyMs !== 'number' ||
      !Number.isFinite(row.latencyMs) ||
      row.latencyMs < 0
    ) {
      throw new Error(
        'iOS golden output contains a malformed or duplicate row.',
      );
    }
    ids.add(row.id);
    latencyMs.push(row.latencyMs);
  }
  const report = {
    schemaVersion: 1,
    modelManifestSha256: manifestSha256,
    modelVersion: manifest.modelVersion,
    device: deviceEvidence.device,
    latencyMs,
    baselineMemoryMb: finiteSamples(
      deviceEvidence.baselineMemoryMb,
      3,
      'iOS baselineMemoryMb',
    ),
    candidateMemoryMb: finiteSamples(
      deviceEvidence.candidateMemoryMb,
      3,
      'iOS candidateMemoryMb',
    ),
    goldenSha256: sha256(goldenBytes),
    deviceEvidenceSha256: sha256(evidenceBytes),
    source: 'IOS_ARM64_BENCHMARK_ONLY_APP',
    deploymentMode: 'BENCHMARK_ONLY',
    allowAutoCommit: false,
  };
  atomicWrite(options.output, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function main(argv) {
  const args = parseArgs(argv);
  const report = createIosBenchmarkEvidence({
    manifest: args.manifest,
    golden: args.golden,
    deviceEvidence: args['device-evidence'],
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

module.exports = { createIosBenchmarkEvidence, finiteSamples };
