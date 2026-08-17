const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWrite,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');
const {
  percentile,
  wilsonLowerBound,
} = require('./evaluate-shadow-observations.cjs');

function readEvidence(root, value, label) {
  if (typeof value !== 'string') throw new Error(`--${label} is required.`);
  const file = path.resolve(root, value);
  if (!fs.existsSync(file)) throw new Error(`${label} is missing (${file}).`);
  const bytes = fs.readFileSync(file);
  return { file, bytes, value: JSON.parse(bytes.toString('utf8')) };
}

function readObservations(root, value) {
  if (typeof value !== 'string') throw new Error('--observations is required.');
  const file = path.resolve(root, value);
  const bytes = fs.readFileSync(file);
  const rows = bytes
    .toString('utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  return { file, bytes, rows };
}

function createModelReleaseReadiness(options) {
  const root = options.root ?? process.cwd();
  if (typeof options.output !== 'string')
    throw new Error('--output is required.');
  const output = path.resolve(root, options.output);
  if (fs.existsSync(output)) {
    throw new Error(
      'Model release readiness report already exists; it is immutable.',
    );
  }
  const selection = readEvidence(
    root,
    options.selectionReport,
    'selection-report',
  );
  const completion = readEvidence(
    root,
    options.completionReceipt,
    'completion-receipt',
  );
  const runtime = readEvidence(root, options.runtimeReport, 'runtime-report');
  const humanAudit = readEvidence(root, options.humanAudit, 'human-audit');
  const preparedManifest = readEvidence(
    root,
    options.preparedManifest,
    'prepared-manifest',
  );
  const approval = readEvidence(root, options.approval, 'approval');
  const activation = readEvidence(root, options.activation, 'activation');
  const shadowManifest = readEvidence(
    root,
    options.shadowManifest,
    'shadow-manifest',
  );
  const shadowStage = readEvidence(
    root,
    options.shadowStageReceipt,
    'shadow-stage-receipt',
  );
  const shadowReport = readEvidence(
    root,
    options.shadowReport,
    'shadow-report',
  );
  const shadowConfig = readEvidence(
    root,
    options.shadowConfig ??
      'ml/category-classifier/config/shadow_observation.json',
    'shadow-config',
  );
  const observations = readObservations(root, options.observations);
  const selected = selection.value.selection?.selected;
  const enabledLabels = Object.entries(
    shadowManifest.value.categoryPolicies ?? {},
  )
    .filter(([, policy]) => policy.enabled === true)
    .map(([label]) => label);
  const labelCounts = new Map();
  const timestamps = [];
  let matchedCount = 0;
  for (const row of observations.rows) {
    if (
      row.modelVersion !== selected?.modelVersion ||
      row.autoCommitted !== false ||
      row.matched !== (row.predictedCategoryKey === row.finalCategoryKey) ||
      !Number.isFinite(row.latencyMs) ||
      Number.isNaN(Date.parse(row.createdAt))
    ) {
      throw new Error('Release observations contain invalid or unsafe rows.');
    }
    matchedCount += row.matched ? 1 : 0;
    labelCounts.set(
      row.predictedCategoryKey,
      (labelCounts.get(row.predictedCategoryKey) ?? 0) + 1,
    );
    timestamps.push(Date.parse(row.createdAt));
  }
  const calendarDays = new Set(
    timestamps.map(timestamp => new Date(timestamp).toISOString().slice(0, 10)),
  ).size;
  const firstObservedAt = timestamps.length === 0 ? 0 : Math.min(...timestamps);
  const lastObservedAt = timestamps.length === 0 ? 0 : Math.max(...timestamps);
  const matchedRate =
    observations.rows.length === 0
      ? 0
      : matchedCount / observations.rows.length;
  const p95LatencyMs =
    observations.rows.length === 0
      ? null
      : percentile(
          observations.rows.map(row => row.latencyMs),
          0.95,
        );
  const checks = {
    selectedWinner:
      selected !== undefined &&
      selection.value.selection?.winner === selected.candidateId,
    completion:
      completion.value.status === 'MODEL_SELECTION_COMPLETE' &&
      completion.value.allowAutoCommit === false &&
      completion.value.candidateId === selected?.candidateId &&
      completion.value.modelVersion === selected?.modelVersion &&
      completion.value.manifestSha256 === selected?.manifestSha256 &&
      completion.value.selectionReportSha256 === sha256(selection.bytes) &&
      completion.value.runtimeReportSha256 === sha256(runtime.bytes) &&
      completion.value.humanAuditSha256 === sha256(humanAudit.bytes) &&
      completion.value.preparedManifestSha256 ===
        sha256(preparedManifest.bytes),
    runtime:
      runtime.value.modelVersion === selected?.modelVersion &&
      runtime.value.deploymentMode === 'BENCHMARK_ONLY' &&
      runtime.value.allowAutoCommit === false &&
      runtime.value.crossPlatformGoldenVectorsPassed === true,
    dataAudit:
      humanAudit.value.status === 'PASS' &&
      humanAudit.value.attestation === 'HUMAN_REVIEWED' &&
      humanAudit.value.preparedManifestSha256 ===
        sha256(preparedManifest.bytes) &&
      humanAudit.value.sampleCount >= 450,
    approval:
      approval.value.status === 'APPROVED_FOR_SHADOW' &&
      approval.value.schemaVersion === 1 &&
      approval.value.humanAttestation === 'HUMAN_REVIEWED' &&
      approval.value.selectionReportSha256 === sha256(selection.bytes) &&
      approval.value.completionReceiptSha256 === sha256(completion.bytes) &&
      approval.value.manifestSha256 === selected?.manifestSha256 &&
      typeof approval.value.approvedBy === 'string' &&
      approval.value.approvedBy.trim().length > 0 &&
      !Number.isNaN(Date.parse(approval.value.approvedAt)),
    activation:
      activation.value.status === 'MODEL_SELECTED_FOR_SHADOW' &&
      activation.value.allowAutoCommit === false &&
      activation.value.approvalSha256 === sha256(approval.bytes) &&
      activation.value.completionReceiptSha256 === sha256(completion.bytes) &&
      activation.value.selectionReportSha256 === sha256(selection.bytes),
    stagedShadow:
      shadowManifest.value.deployment?.mode === 'SHADOW' &&
      shadowManifest.value.deployment?.allowAutoCommit === false &&
      shadowManifest.value.deployment?.selectionReportSha256 ===
        sha256(selection.bytes) &&
      shadowManifest.value.deployment?.completionReceiptSha256 ===
        sha256(completion.bytes) &&
      shadowManifest.value.deployment?.activationSha256 ===
        sha256(activation.bytes) &&
      shadowStage.value.status === 'SHADOW_ASSETS_STAGED' &&
      shadowStage.value.allowAutoCommit === false &&
      shadowStage.value.manifestSha256 === sha256(shadowManifest.bytes) &&
      shadowStage.value.activationSha256 === sha256(activation.bytes) &&
      shadowStage.value.completionReceiptSha256 === sha256(completion.bytes),
    observationReport:
      shadowReport.value.status === 'SHADOW_OBSERVATION_PASSED' &&
      Object.values(shadowReport.value.checks ?? {}).every(Boolean) &&
      shadowReport.value.evidence?.observationsSha256 ===
        sha256(observations.bytes) &&
      shadowReport.value.evidence?.selectionReportSha256 ===
        sha256(selection.bytes) &&
      shadowReport.value.evidence?.activationSha256 ===
        sha256(activation.bytes) &&
      shadowReport.value.evidence?.shadowManifestSha256 ===
        sha256(shadowManifest.bytes) &&
      shadowReport.value.evidence?.configSha256 === sha256(shadowConfig.bytes),
    observationMetrics:
      observations.rows.length >= shadowConfig.value.minimumObservations &&
      calendarDays >= shadowConfig.value.minimumCalendarDays &&
      lastObservedAt - firstObservedAt >=
        (shadowConfig.value.minimumCalendarDays - 1) * 86_400_000 &&
      enabledLabels.every(
        label =>
          (labelCounts.get(label) ?? 0) >=
          shadowConfig.value.minimumPerEnabledLabel,
      ) &&
      shadowConfig.value.disabledLabels.every(
        label => (labelCounts.get(label) ?? 0) === 0,
      ) &&
      matchedRate >= shadowConfig.value.minimumMatchedRate &&
      wilsonLowerBound(matchedCount, observations.rows.length) >=
        shadowConfig.value.minimumWilsonLowerBound95 &&
      p95LatencyMs !== null &&
      p95LatencyMs <= shadowConfig.value.maximumP95LatencyMs &&
      shadowReport.value.observationCount === observations.rows.length &&
      shadowReport.value.matchedCount === matchedCount,
  };
  if (!Object.values(checks).every(Boolean)) {
    const failed = Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    throw new Error(`MODEL_RELEASE_NOT_READY: ${failed.join(', ')}`);
  }
  const report = {
    schemaVersion: 1,
    status: 'MODEL_RELEASE_READY',
    candidateId: selected.candidateId,
    modelVersion: selected.modelVersion,
    generatedAt: new Date().toISOString(),
    allowAutoCommit: false,
    observationCount: observations.rows.length,
    matchedRate,
    p95LatencyMs,
    checks,
    evidence: Object.fromEntries(
      Object.entries({
        selection,
        completion,
        runtime,
        humanAudit,
        preparedManifest,
        approval,
        activation,
        shadowManifest,
        shadowStage,
        shadowReport,
        shadowConfig,
        observations,
      }).map(([name, evidence]) => [name, sha256(evidence.bytes)]),
    ),
  };
  atomicWrite(output, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function main(argv) {
  const args = parseArgs(argv);
  const report = createModelReleaseReadiness({
    selectionReport: args['selection-report'],
    completionReceipt: args['completion-receipt'],
    runtimeReport: args['runtime-report'],
    humanAudit: args['human-audit'],
    preparedManifest: args['prepared-manifest'],
    approval: args.approval,
    activation: args.activation,
    shadowManifest: args['shadow-manifest'],
    shadowStageReceipt: args['shadow-stage-receipt'],
    shadowReport: args['shadow-report'],
    shadowConfig: args['shadow-config'],
    observations: args.observations,
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

module.exports = { createModelReleaseReadiness };
