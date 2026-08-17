#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWrite,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');
const {
  verifyReleaseDatasets,
} = require('../synthetic-data/verify-release-datasets.cjs');
const { createRuntimeReport } = require('./create-runtime-report.cjs');
const { select } = require('./select-unified-model.cjs');

function layout(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const candidateName = options.candidateName ?? 'codex-v4';
  const candidateDir = path.resolve(
    root,
    options.candidateDir ?? `build/model-candidates/${candidateName}`,
  );
  const androidDir = path.resolve(
    root,
    options.androidDir ?? `build/benchmark-models/${candidateName}`,
  );
  const benchmarkAssetsDir = path.resolve(
    root,
    options.benchmarkAssetsDir ?? `build/benchmark-assets/${candidateName}`,
  );
  const iosDir = path.resolve(
    root,
    options.iosDir ?? `build/ios-benchmark/${candidateName}`,
  );
  return {
    root,
    candidateName,
    candidateDir,
    candidatesDir: path.dirname(candidateDir),
    selectionOutputDir: path.resolve(
      root,
      options.selectionOutputDir ?? `build/model-selection/${candidateName}`,
    ),
    runtimeOutput: path.join(candidateDir, 'runtime-report.json'),
    humanAudit: path.resolve(
      root,
      options.humanAudit ?? 'data/synthetic/reviewed/codex-v2/human-audit.json',
    ),
    runtime: {
      manifest: path.join(
        benchmarkAssetsDir,
        'bill-classifier',
        'manifest.json',
      ),
      baselineApk: path.join(androidDir, 'baseline-app-internal.apk'),
      candidateApk: path.join(androidDir, 'candidate-app-internal.apk'),
      androidBuildReceipt: path.join(androidDir, 'android-build-receipt.json'),
      benchmark: path.join(androidDir, 'android-benchmark.json'),
      iosBenchmark: path.join(iosDir, 'ios-benchmark.json'),
      iosDeviceEvidence: path.join(iosDir, 'ios-device-evidence.json'),
      androidGolden: path.join(androidDir, 'android-golden.jsonl'),
      iosGolden: path.join(iosDir, 'ios-golden.jsonl'),
      hostGolden: path.join(androidDir, 'host-golden.jsonl'),
      frozenLock: path.join(candidateDir, 'frozen-evaluation-lock.json'),
    },
  };
}

function missingEvidence(current) {
  const required = {
    humanAudit: current.humanAudit,
    ...current.runtime,
  };
  return Object.entries(required)
    .filter(([, file]) => !fs.existsSync(file))
    .map(([name, file]) => ({ code: `MISSING_${name.toUpperCase()}`, file }));
}

function dataGate(current) {
  return verifyReleaseDatasets({
    root: current.root,
    preparedDir: 'data/synthetic/prepared/category-v4',
    amountFile: 'data/synthetic/reviewed/codex-v2/amount.jsonl',
    riskFile: 'data/synthetic/reviewed/codex-v2/risk.jsonl',
    e2eFile: 'data/synthetic/reviewed/codex-v2/e2e.jsonl',
    humanAudit: current.humanAudit,
    trainReviewAudit:
      'data/synthetic/reviewed/codex-v2/category-training.audit.jsonl',
    frozenReviewAudit:
      'data/synthetic/reviewed/codex-v2/category-frozen.audit.jsonl',
    amountReviewAudit: 'data/synthetic/reviewed/codex-v2/amount.audit.jsonl',
    riskReviewAudit: 'data/synthetic/reviewed/codex-v2/risk.audit.jsonl',
    e2eReviewAudit: 'data/synthetic/reviewed/codex-v2/e2e.audit.jsonl',
  });
}

function readiness(options = {}) {
  const current = layout(options);
  const blockers = missingEvidence(current);
  let releaseData;
  try {
    releaseData = dataGate(current);
  } catch (error) {
    if (!blockers.some(blocker => blocker.code === 'MISSING_HUMANAUDIT')) {
      blockers.push({ code: 'DATA_GATE_FAILED', message: error.message });
    }
  }
  return {
    schemaVersion: 1,
    status:
      blockers.length === 0
        ? 'MODEL_SELECTION_READY'
        : 'MODEL_SELECTION_BLOCKED',
    candidateName: current.candidateName,
    blockers,
    releaseData: releaseData
      ? {
          preparedManifestSha256: releaseData.preparedManifestSha256,
          humanAudit: releaseData.humanAudit,
        }
      : null,
    current,
  };
}

function execute(options = {}) {
  const report = readiness(options);
  if (report.blockers.length > 0) {
    const error = new Error('MODEL_SELECTION_BLOCKED');
    error.report = report;
    throw error;
  }
  if (fs.existsSync(report.current.runtimeOutput)) {
    throw new Error(
      'Runtime report already exists; immutable evidence will not be overwritten.',
    );
  }
  if (
    fs.existsSync(
      path.join(report.current.selectionOutputDir, 'selection_report.json'),
    )
  ) {
    throw new Error(
      'Model selection report already exists; it will not be overwritten.',
    );
  }
  const runtime = createRuntimeReport({
    root: report.current.root,
    ...report.current.runtime,
    output: report.current.runtimeOutput,
  });
  const selection = select({
    root: report.current.root,
    candidatesDir: report.current.candidatesDir,
    outputDir: report.current.selectionOutputDir,
  });
  if (selection.selection.selected === undefined) {
    throw new Error('MODEL_SELECTION_COMPLETE_WITHOUT_WINNER');
  }
  const selectionReportFile = path.join(
    report.current.selectionOutputDir,
    'selection_report.json',
  );
  const completionFile = path.join(
    report.current.selectionOutputDir,
    'MODEL_SELECTION_COMPLETE.json',
  );
  const completion = {
    schemaVersion: 1,
    status: 'MODEL_SELECTION_COMPLETE',
    candidateId: selection.selection.selected.candidateId,
    modelVersion: selection.selection.selected.modelVersion,
    manifestSha256: selection.selection.selected.manifestSha256,
    selectionReportSha256: sha256(fs.readFileSync(selectionReportFile)),
    runtimeReportSha256: sha256(fs.readFileSync(report.current.runtimeOutput)),
    preparedManifestSha256: report.releaseData.preparedManifestSha256,
    humanAuditSha256: sha256(fs.readFileSync(report.current.humanAudit)),
    completedAt: new Date().toISOString(),
    allowAutoCommit: false,
  };
  atomicWrite(completionFile, `${JSON.stringify(completion, null, 2)}\n`);
  return {
    ...completion,
    completionFile,
    runtime,
    selection: selection.selection,
  };
}

function main(argv) {
  const args = parseArgs(argv);
  const options = {
    candidateName: args['candidate-name'],
    candidateDir: args['candidate-dir'],
    androidDir: args['android-dir'],
    benchmarkAssetsDir: args['benchmark-assets-dir'],
    iosDir: args['ios-dir'],
    humanAudit: args['human-audit'],
    selectionOutputDir: args['selection-output-dir'],
  };
  if (args.execute === true) {
    try {
      process.stdout.write(`${JSON.stringify(execute(options), null, 2)}\n`);
    } catch (error) {
      if (error.report) {
        process.stderr.write(`${JSON.stringify(error.report, null, 2)}\n`);
      } else {
        process.stderr.write(`${error.message}\n`);
      }
      process.exitCode = 1;
    }
    return;
  }
  const report = readiness(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.blockers.length > 0) process.exitCode = 2;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { dataGate, execute, layout, missingEvidence, readiness };
