const fs = require('node:fs');

const {
  atomicWrite,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

function numbers(value, label) {
  const parsed = String(value).split(',').map(Number);
  if (
    parsed.length < 3 ||
    parsed.some(item => !Number.isFinite(item) || item < 0)
  ) {
    throw new Error(
      `${label} requires at least three comma-separated numbers.`,
    );
  }
  return parsed;
}

function main(argv) {
  const args = parseArgs(argv);
  for (const key of [
    'manifest',
    'golden',
    'device-evidence',
    'baseline-pss',
    'candidate-pss',
    'output',
  ]) {
    if (typeof args[key] !== 'string') throw new Error(`--${key} is required.`);
  }
  const manifestBytes = fs.readFileSync(args.manifest);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const deviceEvidence = JSON.parse(
    fs.readFileSync(args['device-evidence'], 'utf8').replace(/^\uFEFF/u, ''),
  );
  const golden = fs
    .readFileSync(args.golden, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  if (golden.length < 100)
    throw new Error('Android golden output requires at least 100 rows.');
  const report = {
    schemaVersion: 1,
    modelManifestSha256: sha256(manifestBytes),
    modelVersion: manifest.modelVersion,
    device: deviceEvidence.device,
    latencyMs: golden.map(row => row.latencyMs),
    baselinePssMb: numbers(args['baseline-pss'], 'baseline PSS'),
    candidatePssMb: numbers(args['candidate-pss'], 'candidate PSS'),
    source: 'ANDROID_ARM64_BENCHMARK_ONLY_EXECUTABLE',
    allowAutoCommit: false,
  };
  atomicWrite(args.output, `${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
