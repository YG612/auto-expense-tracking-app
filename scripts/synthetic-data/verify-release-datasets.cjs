const fs = require('node:fs');
const path = require('node:path');

const { parseArgs, sha256 } = require('./pipeline-utils.cjs');
const { validateRows } = require('./validate-dataset.cjs');

function requireFile(file, label) {
  if (!fs.existsSync(file))
    throw new Error(`DATA_NOT_READY: ${label} is missing (${file}).`);
  return fs.readFileSync(file, 'utf8');
}

function parseJsonLines(text, label) {
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${label}:${index + 1}: ${error.message}`);
      }
    });
}

function verifyIndependentReview(rows, auditText, label) {
  const auditRows = parseJsonLines(auditText, label);
  const decisions = new Map();
  for (const decision of auditRows) {
    if (typeof decision.id !== 'string' || decisions.has(decision.id)) {
      throw new Error(`DATA_NOT_READY: ${label} has duplicate or invalid IDs.`);
    }
    decisions.set(decision.id, decision);
  }
  const reviewerModels = new Set();
  const reviewModes = new Set();
  for (const row of rows) {
    const decision = decisions.get(row.id);
    const independentLlmReview =
      decision?.reviewerPromptVersion === 'independent-review-v1' &&
      decision.reviewerModel !== row.generatorModel;
    const deterministicReview =
      decision?.reviewerPromptVersion === 'deterministic-review-v1' &&
      decision.reviewMode === 'DETERMINISTIC_VALIDATOR' &&
      decision.reviewerModel?.startsWith('deterministic-validator/');
    if (
      decision?.verdict !== 'ACCEPT' ||
      decision.reviewedPromptVersion !== row.promptVersion ||
      typeof decision.reviewerModel !== 'string' ||
      decision.reviewerModel.trim().length === 0 ||
      (!independentLlmReview && !deterministicReview)
    ) {
      throw new Error(
        `DATA_NOT_READY: ${row.id} lacks an isolated independent ACCEPT review.`,
      );
    }
    reviewerModels.add(decision.reviewerModel);
    reviewModes.add(
      deterministicReview ? 'DETERMINISTIC_VALIDATOR' : 'INDEPENDENT_LLM',
    );
  }
  return {
    acceptedRows: rows.length,
    auditRows: auditRows.length,
    reviewerModels: [...reviewerModels].sort(),
    reviewModes: [...reviewModes].sort(),
    sha256: sha256(auditText),
  };
}

function verifyReleaseDatasets(options = {}) {
  const root = options.root ?? process.cwd();
  const matrix = JSON.parse(
    requireFile(
      path.join(root, 'data', 'synthetic', 'generation-matrix.json'),
      'generation matrix',
    ),
  );
  const preparedDir = path.resolve(
    root,
    options.preparedDir ?? 'data/synthetic/prepared/category-v3',
  );
  const manifestText = requireFile(
    path.join(preparedDir, 'manifest.json'),
    'prepared category manifest',
  );
  const manifest = JSON.parse(manifestText);
  const requiredCategoryCounts = {
    train: matrix.targetRows.categoryTrain,
    validation: matrix.targetRows.categoryValidation,
    frozenTest: matrix.targetRows.categoryFrozenTest,
  };
  const report = {
    schemaVersion: 1,
    taxonomyVersion: matrix.taxonomyVersion,
    preparedManifestSha256: sha256(manifestText),
    datasets: {},
    independentReviews: {},
  };
  for (const [key, minimum] of Object.entries(requiredCategoryCounts)) {
    const spec = manifest.files?.[key];
    if (spec?.rows < minimum) {
      throw new Error(
        `DATA_NOT_READY: ${key} has ${spec?.rows ?? 0} rows; ${minimum} accepted rows are required.`,
      );
    }
    const contents = requireFile(
      path.join(preparedDir, spec.file),
      `${key} category split`,
    );
    if (sha256(contents) !== spec.sha256)
      throw new Error(`${key} category split hash mismatch.`);
    validateRows(contents, 'category');
    report.datasets[key] = { rows: spec.rows, sha256: spec.sha256 };
  }

  const categoryReviewSources = {
    train: {
      input: path.resolve(root, manifest.inputs.train),
      audit: path.resolve(
        root,
        options.trainReviewAudit ??
          'data/synthetic/reviewed/category-training.audit.jsonl',
      ),
    },
    frozen: {
      input: path.resolve(root, manifest.inputs.frozen),
      audit: path.resolve(
        root,
        options.frozenReviewAudit ??
          'data/synthetic/reviewed/category-frozen.audit.jsonl',
      ),
    },
  };
  for (const [name, source] of Object.entries(categoryReviewSources)) {
    const reviewedRows = validateRows(
      requireFile(source.input, `${name} reviewed category source`),
      'category',
    );
    const auditText = requireFile(
      source.audit,
      `${name} category review audit`,
    );
    report.independentReviews[name] = verifyIndependentReview(
      reviewedRows,
      auditText,
      `${name} category review audit`,
    );
  }

  const auxiliary = [
    [
      'amount',
      options.amountFile ?? 'data/synthetic/reviewed/amount.jsonl',
      matrix.targetRows.amountParser,
      options.amountReviewAudit ?? 'data/synthetic/reviewed/amount.audit.jsonl',
    ],
    [
      'risk',
      options.riskFile ?? 'data/synthetic/reviewed/risk.jsonl',
      matrix.targetRows.riskOod,
      options.riskReviewAudit ?? 'data/synthetic/reviewed/risk.audit.jsonl',
    ],
    [
      'e2e',
      options.e2eFile ?? 'data/synthetic/reviewed/e2e.jsonl',
      matrix.targetRows.endToEnd,
      options.e2eReviewAudit ?? 'data/synthetic/reviewed/e2e.audit.jsonl',
    ],
  ];
  for (const [kind, relativeFile, minimum, relativeAudit] of auxiliary) {
    const file = path.resolve(root, relativeFile);
    const contents = requireFile(file, `${kind} reviewed dataset`);
    const rows = validateRows(contents, kind);
    if (rows.length < minimum)
      throw new Error(
        `DATA_NOT_READY: ${kind} has ${rows.length} rows; ${minimum} accepted rows are required.`,
      );
    report.datasets[kind] = { rows: rows.length, sha256: sha256(contents) };
    const auditText = requireFile(
      path.resolve(root, relativeAudit),
      `${kind} review audit`,
    );
    report.independentReviews[kind] = verifyIndependentReview(
      rows,
      auditText,
      `${kind} review audit`,
    );
  }

  const auditFile = path.resolve(
    root,
    options.humanAudit ?? 'data/synthetic/reviewed/human-audit.json',
  );
  const audit = JSON.parse(requireFile(auditFile, 'human audit record'));
  if (
    audit.status !== 'PASS' ||
    audit.attestation !== 'HUMAN_REVIEWED' ||
    audit.preparedManifestSha256 !== report.preparedManifestSha256 ||
    !Number.isInteger(audit.sampleCount) ||
    audit.sampleCount < 450 ||
    typeof audit.auditor !== 'string' ||
    audit.auditor.trim().length === 0
  ) {
    throw new Error(
      'DATA_NOT_READY: human audit must PASS with at least 450 sampled rows.',
    );
  }
  report.humanAudit = audit;
  return report;
}

function main(argv) {
  const args = parseArgs(argv);
  const report = verifyReleaseDatasets({
    preparedDir: args['prepared-dir'],
    amountFile: args['amount-file'],
    riskFile: args['risk-file'],
    e2eFile: args['e2e-file'],
    humanAudit: args['human-audit'],
    trainReviewAudit: args['train-review-audit'],
    frozenReviewAudit: args['frozen-review-audit'],
    amountReviewAudit: args['amount-review-audit'],
    riskReviewAudit: args['risk-review-audit'],
    e2eReviewAudit: args['e2e-review-audit'],
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

module.exports = { verifyIndependentReview, verifyReleaseDatasets };
