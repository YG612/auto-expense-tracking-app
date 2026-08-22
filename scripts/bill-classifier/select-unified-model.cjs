const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWrite,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

function readJson(file, label) {
  if (!fs.existsSync(file))
    throw new Error(`DATA_NOT_READY: ${label} is missing (${file}).`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function runtimeEvidenceVerified(runtime, runtimeFile) {
  if (runtime.evidence === null || typeof runtime.evidence !== 'object') {
    return false;
  }
  const required = [
    'benchmarkManifest',
    'androidBuildReceipt',
    'candidateApk',
    'baselineApk',
    'benchmark',
    'iosBenchmark',
    'iosDeviceEvidence',
    'androidGolden',
    'iosGolden',
    'hostGolden',
    'frozenLock',
  ];
  return required.every(name => {
    const spec = runtime.evidence[name];
    if (
      typeof spec?.file !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(spec.sha256 ?? '')
    ) {
      return false;
    }
    const file = path.resolve(path.dirname(runtimeFile), spec.file);
    return fs.existsSync(file) && sha256(fs.readFileSync(file)) === spec.sha256;
  });
}

function candidateAssessment(directory, config) {
  const manifestFile = path.join(directory, 'manifest.json');
  const evaluationFile = path.join(directory, 'evaluation-report.json');
  const runtimeFile = path.join(directory, 'runtime-report.json');
  const errorSlicesFile = path.join(directory, 'error_slices.json');
  const frozenLockFile = path.join(directory, 'frozen-evaluation-lock.json');
  const manifest = readJson(manifestFile, 'candidate manifest');
  const evaluation = readJson(evaluationFile, 'candidate evaluation report');
  const runtime = fs.existsSync(runtimeFile)
    ? readJson(runtimeFile, 'candidate runtime report')
    : {};
  const errorSlices = readJson(errorSlicesFile, 'candidate error slice report');
  const frozenLock = readJson(frozenLockFile, 'frozen evaluation lock');
  const modelBytes = manifest.models?.reduce(
    (sum, model) => sum + model.sizeBytes,
    0,
  );
  const hard = config.hardGates;
  const policyLabels = Object.keys(manifest.categoryPolicies ?? {}).sort();
  const expectedPolicyLabels = [...config.task.labels].sort();
  const checks = {
    evaluationGate: evaluation.gate?.passed === true,
    modelSize:
      Number.isSafeInteger(modelBytes) &&
      modelBytes <= hard.modelWeightBytesMax,
    apkDelta:
      Number.isSafeInteger(runtime.apkDeltaBytes) &&
      runtime.apkDeltaBytes <= hard.apkDeltaBytesMax,
    latency:
      runtime.p95LatencyMs <= hard.p95LatencyMsMax &&
      evaluation.metrics?.p95LatencyMs <= hard.p95LatencyMsMax,
    memory: runtime.extraPeakPssMb <= hard.extraPeakPssMbMax,
    precision:
      evaluation.metrics?.acceptedPrecision >= hard.highConfidencePrecisionMin,
    ood: evaluation.gate?.oodFalseAcceptRate <= hard.oodFalseAcceptRateMax,
    autoCommit:
      evaluation.gate?.unsafeRiskCommits <= hard.autoCommitErrorCountMax,
    categoryPolicy:
      JSON.stringify(policyLabels) === JSON.stringify(expectedPolicyLabels) &&
      manifest.categoryPolicies['expense.other_expense']?.enabled === false &&
      Object.entries(manifest.categoryPolicies).some(
        ([label, policy]) =>
          label !== 'expense.other_expense' && policy.enabled === true,
      ),
    frozenOnce:
      runtime.frozenEvaluationCount === 1 &&
      frozenLock.status === 'COMPLETE' &&
      frozenLock.modelSha256 === manifest.models?.[0]?.sha256 &&
      frozenLock.outputSha256 === evaluation.categoryResultsSha256,
    crossPlatformGolden: runtime.crossPlatformGoldenVectorsPassed === true,
    benchmarkOnlyEvidence:
      runtime.deploymentMode === 'BENCHMARK_ONLY' &&
      runtime.allowAutoCommit === false,
    runtimeEvidence:
      runtime.manifestSha256 === sha256(fs.readFileSync(manifestFile)) &&
      runtime.benchmarkManifestSha256 ===
        runtime.evidence?.benchmarkManifest?.sha256 &&
      runtimeEvidenceVerified(runtime, runtimeFile),
    errorSlices:
      errorSlices.split === 'validation' &&
      errorSlices.allRequiredPresent === true &&
      errorSlices.allTreatmentsAssigned === true &&
      errorSlices.passed === true,
  };
  return {
    candidateId: manifest.candidateId ?? manifest.modelVersion,
    modelFamily: manifest.modelFamily ?? 'unknown',
    complexityRank: manifest.complexityRank ?? 999,
    modelVersion: manifest.modelVersion,
    modelWeightBytes: modelBytes,
    directory,
    manifestSha256: sha256(fs.readFileSync(manifestFile)),
    metrics: evaluation.metrics,
    runtime,
    errorSlicesSha256: sha256(fs.readFileSync(errorSlicesFile)),
    frozenLockSha256: sha256(fs.readFileSync(frozenLockFile)),
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

function selectCandidates(candidates, config) {
  const passed = candidates.filter(candidate => candidate.passed);
  if (passed.length === 0) {
    return {
      status: 'NO_MODEL_PASSED',
      winner: 'NONE',
      manualReviewRequired: false,
    };
  }
  passed.sort(
    (left, right) =>
      right.metrics.coverage - left.metrics.coverage ||
      left.complexityRank - right.complexityRank ||
      left.modelWeightBytes - right.modelWeightBytes ||
      left.runtime.p95LatencyMs - right.runtime.p95LatencyMs,
  );
  const top = passed[0];
  const simpler = [...passed].sort(
    (left, right) => left.complexityRank - right.complexityRank,
  )[0];
  const coverageGap = top.metrics.coverage - simpler.metrics.coverage;
  if (
    simpler.candidateId !== top.candidateId &&
    coverageGap <= config.selection.preferSimplerWhenCoverageGapLte
  ) {
    return {
      status: 'MODEL_CANDIDATES_EVALUATED',
      winner: simpler.candidateId,
      selected: simpler,
      coverageGap,
      reason: 'SIMPLER_WITHIN_COVERAGE_TOLERANCE',
      manualReviewRequired: false,
    };
  }
  const reviewRange =
    config.selection.requireManualReviewWhenCoverageGapBetween;
  return {
    status: 'MODEL_CANDIDATES_EVALUATED',
    winner: top.candidateId,
    selected: top,
    coverageGap,
    reason: 'MAXIMUM_HIGH_CONFIDENCE_COVERAGE',
    manualReviewRequired:
      coverageGap >= reviewRange.min && coverageGap <= reviewRange.max,
  };
}

function markdownReport(report) {
  const lines = [
    '# Model selection report',
    '',
    `- Status: ${report.selection.status}`,
    `- Winner: ${report.selection.winner}`,
    `- Manual review required: ${report.selection.manualReviewRequired}`,
    '',
    '## Candidates',
    '',
    '| Candidate | Family | Passed | Coverage | Accepted precision |',
    '|---|---|---:|---:|---:|',
    ...report.candidates.map(
      candidate =>
        `| ${candidate.candidateId} | ${candidate.modelFamily} | ${candidate.passed} | ${candidate.metrics?.coverage ?? 'n/a'} | ${candidate.metrics?.acceptedPrecision ?? 'n/a'} |`,
    ),
    '',
    'A recommendation is not approval. Shadow activation still requires a separately authored A3_SELECTION_APPROVED.json bound to this report and the selected manifest hashes.',
    '',
  ];
  return lines.join('\n');
}

function select(options) {
  const root = options.root ?? process.cwd();
  const configFile = path.resolve(
    root,
    options.config ?? 'ml/category-classifier/config/model_selection.yaml',
  );
  const config = readJson(configFile, 'model selection config');
  const candidatesRoot = path.resolve(root, options.candidatesDir);
  if (!fs.existsSync(candidatesRoot)) {
    throw new Error(
      `DATA_NOT_READY: candidate directory is missing (${candidatesRoot}).`,
    );
  }
  const directories = fs
    .readdirSync(candidatesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(candidatesRoot, entry.name));
  if (directories.length === 0)
    throw new Error('DATA_NOT_READY: no model candidates exist.');
  const candidates = directories.map(directory =>
    candidateAssessment(directory, config),
  );
  const selection = selectCandidates(candidates, config);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    configSha256: sha256(fs.readFileSync(configFile)),
    candidates,
    selection,
    shadowActivation: 'A3_SELECTION_APPROVED_REQUIRED',
  };
  const outputDir = path.resolve(root, options.outputDir);
  atomicWrite(
    path.join(outputDir, 'selection_report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  atomicWrite(
    path.join(outputDir, 'MODEL_SELECTION_REPORT.md'),
    markdownReport(report),
  );
  if (selection.winner === 'NONE') process.exitCode = 2;
  return report;
}

function main(argv) {
  const args = parseArgs(argv);
  if (typeof args['candidates-dir'] !== 'string') {
    throw new Error('--candidates-dir is required.');
  }
  select({
    config: args.config,
    candidatesDir: args['candidates-dir'],
    outputDir: args['output-dir'] ?? 'build/model-selection',
  });
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
  candidateAssessment,
  markdownReport,
  select,
  selectCandidates,
  runtimeEvidenceVerified,
};
