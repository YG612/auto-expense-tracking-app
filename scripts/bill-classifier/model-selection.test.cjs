const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { sha256 } = require('../synthetic-data/pipeline-utils.cjs');
const { createRuntimeReport } = require('./create-runtime-report.cjs');
const {
  candidateAssessment,
  selectCandidates,
} = require('./select-unified-model.cjs');
const { verifyApproval } = require('./verify-shadow-approval.cjs');

const config = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '..',
      '..',
      'ml',
      'category-classifier',
      'config',
      'model_selection.yaml',
    ),
    'utf8',
  ),
);

function candidate(candidateId, coverage, complexityRank, passed = true) {
  return {
    candidateId,
    modelFamily: candidateId,
    modelVersion: `3.0.0-${candidateId}`,
    manifestSha256: 'a'.repeat(64),
    complexityRank,
    modelWeightBytes: complexityRank * 1000,
    metrics: { coverage, acceptedPrecision: 0.995 },
    runtime: { p95LatencyMs: complexityRank, extraPeakPssMb: complexityRank },
    passed,
  };
}

test('allows NONE and prefers a simpler model inside the coverage tolerance', () => {
  assert.equal(
    selectCandidates([candidate('M1', 0.6, 1, false)], config).winner,
    'NONE',
  );
  const selected = selectCandidates(
    [candidate('M1', 0.72, 1), candidate('M2', 0.74, 2)],
    config,
  );
  assert.equal(selected.winner, 'M1');
  assert.equal(selected.reason, 'SIMPLER_WITHIN_COVERAGE_TOLERANCE');
});

test('keeps an algorithmically failed candidate in the report without runtime evidence', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qingji-failed-candidate-'),
  );
  fs.writeFileSync(
    path.join(directory, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 2,
      candidateId: 'FAILED',
      modelVersion: '3.0.0-failed',
      modelFamily: 'test',
      complexityRank: 1,
      models: [{ sizeBytes: 100, sha256: 'a'.repeat(64) }],
      categoryPolicies: Object.fromEntries(
        config.task.labels.map(label => [
          label,
          { enabled: label !== 'expense.other_expense' },
        ]),
      ),
    }),
  );
  fs.writeFileSync(
    path.join(directory, 'evaluation-report.json'),
    JSON.stringify({
      gate: { passed: false, oodFalseAcceptRate: 0, unsafeRiskCommits: 0 },
      metrics: { acceptedPrecision: 0.9, coverage: 0.9, p95LatencyMs: 1 },
      categoryResultsSha256: 'b'.repeat(64),
    }),
  );
  fs.writeFileSync(
    path.join(directory, 'error_slices.json'),
    JSON.stringify({
      split: 'validation',
      allRequiredPresent: true,
      allTreatmentsAssigned: true,
      passed: true,
    }),
  );
  fs.writeFileSync(
    path.join(directory, 'frozen-evaluation-lock.json'),
    JSON.stringify({
      status: 'COMPLETE',
      modelSha256: 'a'.repeat(64),
      outputSha256: 'b'.repeat(64),
    }),
  );

  const assessment = candidateAssessment(directory, config);

  assert.equal(assessment.passed, false);
  assert.equal(assessment.checks.evaluationGate, false);
  assert.equal(assessment.checks.runtimeEvidence, false);
});

test('accepts a candidate bound through a distinct BENCHMARK_ONLY manifest', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qingji-passing-candidate-'),
  );
  const candidateDirectory = path.join(root, 'candidate');
  const evidenceDirectory = path.join(root, 'evidence');
  fs.mkdirSync(candidateDirectory);
  fs.mkdirSync(evidenceDirectory);
  const candidateFile = path.join(candidateDirectory, 'manifest.json');
  const modelBytes = Buffer.from('model');
  const modelSha256 = sha256(modelBytes);
  const categoryPolicies = Object.fromEntries(
    config.task.labels.map(label => [
      label,
      {
        enabled: label !== 'expense.other_expense',
        confidenceThreshold: 0.55,
        marginThreshold: 0.05,
      },
    ]),
  );
  fs.writeFileSync(
    candidateFile,
    JSON.stringify({
      schemaVersion: 2,
      candidateId: 'PASSING',
      modelVersion: '3.0.0-passing',
      modelFamily: 'test',
      complexityRank: 1,
      models: [{ sizeBytes: modelBytes.length, sha256: modelSha256 }],
      categoryPolicies,
    }),
  );
  const candidateManifestSha256 = sha256(fs.readFileSync(candidateFile));
  const benchmarkManifest = path.join(evidenceDirectory, 'manifest.json');
  fs.writeFileSync(
    benchmarkManifest,
    JSON.stringify({
      schemaVersion: 2,
      modelVersion: '3.0.0-passing',
      models: [{ sizeBytes: modelBytes.length, sha256: modelSha256 }],
      deployment: {
        mode: 'BENCHMARK_ONLY',
        allowAutoCommit: false,
        candidateManifestSha256,
      },
    }),
  );
  const benchmarkManifestSha256 = sha256(fs.readFileSync(benchmarkManifest));
  const baselineApk = path.join(evidenceDirectory, 'baseline.apk');
  const candidateApk = path.join(evidenceDirectory, 'candidate.apk');
  fs.writeFileSync(baselineApk, Buffer.alloc(100));
  fs.writeFileSync(candidateApk, Buffer.alloc(125));
  const receipt = path.join(evidenceDirectory, 'android-receipt.json');
  fs.writeFileSync(
    receipt,
    JSON.stringify({
      status: 'ANDROID_BENCHMARK_BUILD_COMPLETE',
      deploymentMode: 'BENCHMARK_ONLY',
      variant: 'Internal',
      allowAutoCommit: false,
      apkSha256: sha256(fs.readFileSync(candidateApk)),
      billClassifierManifestSha256: benchmarkManifestSha256,
    }),
  );
  const androidBenchmark = path.join(
    evidenceDirectory,
    'android-benchmark.json',
  );
  fs.writeFileSync(
    androidBenchmark,
    JSON.stringify({
      schemaVersion: 1,
      modelManifestSha256: benchmarkManifestSha256,
      modelVersion: '3.0.0-passing',
      device: { platform: 'android', model: 'test' },
      latencyMs: Array.from({ length: 100 }, () => 1),
      baselinePssMb: [10, 10, 10],
      candidatePssMb: [11, 11, 11],
      source: 'ANDROID_ARM64_BENCHMARK_ONLY_EXECUTABLE',
      allowAutoCommit: false,
    }),
  );
  const golden = `${Array.from({ length: 100 }, (_, index) =>
    JSON.stringify({
      id: `golden-${index}`,
      parentCategoryKey: 'expense.food',
      abstained: false,
      reason: null,
    }),
  ).join('\n')}\n`;
  const androidGolden = path.join(evidenceDirectory, 'android.jsonl');
  const iosGolden = path.join(evidenceDirectory, 'ios.jsonl');
  const hostGolden = path.join(evidenceDirectory, 'host.jsonl');
  for (const file of [androidGolden, iosGolden, hostGolden]) {
    fs.writeFileSync(file, golden);
  }
  const iosDeviceEvidence = path.join(evidenceDirectory, 'ios-device.json');
  fs.writeFileSync(iosDeviceEvidence, 'device-evidence');
  const iosBenchmark = path.join(evidenceDirectory, 'ios-benchmark.json');
  fs.writeFileSync(
    iosBenchmark,
    JSON.stringify({
      schemaVersion: 1,
      modelManifestSha256: benchmarkManifestSha256,
      modelVersion: '3.0.0-passing',
      source: 'IOS_ARM64_BENCHMARK_ONLY_APP',
      deploymentMode: 'BENCHMARK_ONLY',
      allowAutoCommit: false,
      device: { platform: 'ios', physicalDevice: true, model: 'test' },
      latencyMs: Array.from({ length: 100 }, () => 1),
      baselineMemoryMb: [20, 20, 20],
      candidateMemoryMb: [21, 21, 21],
      goldenSha256: sha256(fs.readFileSync(iosGolden)),
      deviceEvidenceSha256: sha256(fs.readFileSync(iosDeviceEvidence)),
    }),
  );
  const frozenLock = path.join(
    candidateDirectory,
    'frozen-evaluation-lock.json',
  );
  const categoryResultsSha256 = 'b'.repeat(64);
  fs.writeFileSync(
    frozenLock,
    JSON.stringify({
      status: 'COMPLETE',
      modelSha256,
      outputSha256: categoryResultsSha256,
    }),
  );
  fs.writeFileSync(
    path.join(candidateDirectory, 'evaluation-report.json'),
    JSON.stringify({
      gate: { passed: true, oodFalseAcceptRate: 0, unsafeRiskCommits: 0 },
      metrics: { acceptedPrecision: 0.995, coverage: 0.8, p95LatencyMs: 1 },
      categoryResultsSha256,
    }),
  );
  fs.writeFileSync(
    path.join(candidateDirectory, 'error_slices.json'),
    JSON.stringify({
      split: 'validation',
      allRequiredPresent: true,
      allTreatmentsAssigned: true,
      passed: true,
    }),
  );
  createRuntimeReport({
    manifest: benchmarkManifest,
    baselineApk,
    candidateApk,
    androidBuildReceipt: receipt,
    benchmark: androidBenchmark,
    iosBenchmark,
    iosDeviceEvidence,
    androidGolden,
    iosGolden,
    hostGolden,
    frozenLock,
    output: path.join(candidateDirectory, 'runtime-report.json'),
  });

  const assessment = candidateAssessment(candidateDirectory, config);

  assert.equal(assessment.passed, true, JSON.stringify(assessment.checks));
  assert.equal(assessment.checks.benchmarkOnlyEvidence, true);
  assert.equal(assessment.checks.runtimeEvidence, true);
});

test('shadow approval must bind both selection report and model manifest hashes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-approval-'));
  const selectionFile = path.join(directory, 'selection_report.json');
  const approvalFile = path.join(directory, 'A3_SELECTION_APPROVED.json');
  const completionFile = path.join(directory, 'MODEL_SELECTION_COMPLETE.json');
  const output = path.join(directory, 'shadow-activation.json');
  const selected = candidate('M2', 0.8, 2);
  const report = {
    selection: { winner: 'M2', selected },
  };
  fs.writeFileSync(selectionFile, `${JSON.stringify(report)}\n`);
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
    approvalFile,
    JSON.stringify({
      status: 'APPROVED_FOR_SHADOW',
      schemaVersion: 1,
      humanAttestation: 'HUMAN_REVIEWED',
      candidateId: selected.candidateId,
      modelVersion: selected.modelVersion,
      selectionReportSha256: sha256(fs.readFileSync(selectionFile)),
      completionReceiptSha256: sha256(fs.readFileSync(completionFile)),
      manifestSha256: selected.manifestSha256,
      approvedBy: 'human-reviewer',
      approvedAt: '2026-08-17T10:00:00.000Z',
    }),
  );
  const activation = verifyApproval({
    root: directory,
    selectionReport: selectionFile,
    completionReceipt: completionFile,
    approval: approvalFile,
    output,
  });
  assert.equal(activation.status, 'MODEL_SELECTED_FOR_SHADOW');
  assert.equal(activation.allowAutoCommit, false);

  const approval = JSON.parse(fs.readFileSync(approvalFile, 'utf8'));
  approval.manifestSha256 = 'b'.repeat(64);
  fs.writeFileSync(approvalFile, JSON.stringify(approval));
  assert.throws(
    () =>
      verifyApproval({
        root: directory,
        selectionReport: selectionFile,
        completionReceipt: completionFile,
        approval: approvalFile,
        output: path.join(directory, 'invalid.json'),
      }),
    /APPROVAL_INVALID/u,
  );
});
