const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWrite,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

function verifyApproval(options) {
  const root = options.root ?? process.cwd();
  const selectionFile = path.resolve(root, options.selectionReport);
  const completionFile = path.resolve(root, options.completionReceipt);
  const approvalFile = path.resolve(root, options.approval);
  if (
    !fs.existsSync(selectionFile) ||
    !fs.existsSync(completionFile) ||
    !fs.existsSync(approvalFile)
  ) {
    throw new Error(
      'APPROVAL_REQUIRED: selection report and separately authored approval are required.',
    );
  }
  const selectionBytes = fs.readFileSync(selectionFile);
  const completionBytes = fs.readFileSync(completionFile);
  const selection = JSON.parse(selectionBytes.toString('utf8'));
  const completion = JSON.parse(completionBytes.toString('utf8'));
  const approvalBytes = fs.readFileSync(approvalFile);
  const approval = JSON.parse(approvalBytes.toString('utf8'));
  const selected = selection.selection?.selected;
  if (
    selection.selection?.winner === 'NONE' ||
    selected === undefined ||
    approval.status !== 'APPROVED_FOR_SHADOW' ||
    approval.schemaVersion !== 1 ||
    approval.humanAttestation !== 'HUMAN_REVIEWED' ||
    approval.candidateId !== selected.candidateId ||
    approval.modelVersion !== selected.modelVersion ||
    approval.selectionReportSha256 !== sha256(selectionBytes) ||
    approval.completionReceiptSha256 !== sha256(completionBytes) ||
    approval.manifestSha256 !== selected.manifestSha256 ||
    typeof approval.approvedBy !== 'string' ||
    approval.approvedBy.trim().length === 0 ||
    Number.isNaN(Date.parse(approval.approvedAt)) ||
    completion.status !== 'MODEL_SELECTION_COMPLETE' ||
    completion.allowAutoCommit !== false ||
    completion.candidateId !== selected.candidateId ||
    completion.modelVersion !== selected.modelVersion ||
    completion.manifestSha256 !== selected.manifestSha256 ||
    completion.selectionReportSha256 !== sha256(selectionBytes) ||
    !/^[a-f0-9]{64}$/u.test(completion.humanAuditSha256 ?? '')
  ) {
    throw new Error(
      'APPROVAL_INVALID: approval is missing, stale, or does not bind the selected candidate.',
    );
  }
  const activation = {
    schemaVersion: 1,
    status: 'MODEL_SELECTED_FOR_SHADOW',
    candidateId: selected.candidateId,
    modelVersion: selected.modelVersion,
    manifestSha256: selected.manifestSha256,
    selectionReportSha256: approval.selectionReportSha256,
    completionReceiptSha256: approval.completionReceiptSha256,
    approvalSha256: sha256(approvalBytes),
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    allowAutoCommit: false,
  };
  atomicWrite(options.output, `${JSON.stringify(activation, null, 2)}\n`);
  return activation;
}

function main(argv) {
  const args = parseArgs(argv);
  for (const key of [
    'selection-report',
    'completion-receipt',
    'approval',
    'output',
  ]) {
    if (typeof args[key] !== 'string') throw new Error(`--${key} is required.`);
  }
  verifyApproval({
    selectionReport: args['selection-report'],
    completionReceipt: args['completion-receipt'],
    approval: args.approval,
    output: args.output,
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

module.exports = { verifyApproval };
