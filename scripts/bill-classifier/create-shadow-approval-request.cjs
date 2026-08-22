const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWrite,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

function createShadowApprovalRequest(options) {
  const root = options.root ?? process.cwd();
  if (typeof options.selectionReport !== 'string') {
    throw new Error('--selection-report is required.');
  }
  if (typeof options.completionReceipt !== 'string') {
    throw new Error('--completion-receipt is required.');
  }
  if (typeof options.output !== 'string')
    throw new Error('--output is required.');
  const output = path.resolve(root, options.output);
  if (path.basename(output) === 'A3_SELECTION_APPROVED.json') {
    throw new Error(
      'Approval request must not be named A3_SELECTION_APPROVED.json.',
    );
  }
  if (fs.existsSync(output)) {
    throw new Error('Approval request already exists; it is immutable.');
  }
  const selectionFile = path.resolve(root, options.selectionReport);
  const completionFile = path.resolve(root, options.completionReceipt);
  const selectionBytes = fs.readFileSync(selectionFile);
  const completionBytes = fs.readFileSync(completionFile);
  const selection = JSON.parse(selectionBytes.toString('utf8'));
  const completion = JSON.parse(completionBytes.toString('utf8'));
  const selected = selection.selection?.selected;
  if (
    selected === undefined ||
    selection.selection?.winner !== selected.candidateId ||
    !/^[a-f0-9]{64}$/u.test(selected.manifestSha256 ?? '') ||
    completion.status !== 'MODEL_SELECTION_COMPLETE' ||
    completion.allowAutoCommit !== false ||
    completion.candidateId !== selected.candidateId ||
    completion.modelVersion !== selected.modelVersion ||
    completion.manifestSha256 !== selected.manifestSha256 ||
    completion.selectionReportSha256 !== sha256(selectionBytes) ||
    !/^[a-f0-9]{64}$/u.test(completion.humanAuditSha256 ?? '')
  ) {
    throw new Error('Selection report does not contain a valid winner.');
  }
  const request = {
    schemaVersion: 1,
    status: 'PENDING_HUMAN_APPROVAL',
    candidateId: selected.candidateId,
    modelVersion: selected.modelVersion,
    selectionReportSha256: sha256(selectionBytes),
    completionReceiptSha256: sha256(completionBytes),
    manifestSha256: selected.manifestSha256,
    requestedAt: new Date().toISOString(),
    requestedDecision: 'APPROVED_FOR_SHADOW_OR_REJECTED',
    safetyBoundary: {
      deploymentMode: 'SHADOW',
      allowAutoCommit: false,
    },
    approvedBy: '',
    approvedAt: null,
    humanAttestation: '',
    instructions: [
      'A responsible human must review the bound selection report and model manifest.',
      'To approve, copy this file to A3_SELECTION_APPROVED.json, set status to APPROVED_FOR_SHADOW, fill approvedBy and approvedAt, and set humanAttestation to HUMAN_REVIEWED.',
      'Do not alter candidateId, modelVersion, selectionReportSha256, completionReceiptSha256, or manifestSha256.',
    ],
  };
  atomicWrite(output, `${JSON.stringify(request, null, 2)}\n`);
  return request;
}

function main(argv) {
  const args = parseArgs(argv);
  const request = createShadowApprovalRequest({
    selectionReport: args['selection-report'],
    completionReceipt: args['completion-receipt'],
    output: args.output,
  });
  process.stdout.write(`${JSON.stringify(request, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createShadowApprovalRequest };
