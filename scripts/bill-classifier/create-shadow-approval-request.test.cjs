const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { sha256 } = require('../synthetic-data/pipeline-utils.cjs');
const {
  createShadowApprovalRequest,
} = require('./create-shadow-approval-request.cjs');

test('creates a hash-bound pending request without impersonating approval', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qingji-approval-request-'),
  );
  const selectionFile = path.join(root, 'selection_report.json');
  const selected = {
    candidateId: 'M2_FASTTEXT',
    modelVersion: '3.0.0-test',
    manifestSha256: 'a'.repeat(64),
  };
  fs.writeFileSync(
    selectionFile,
    `${JSON.stringify({ selection: { winner: selected.candidateId, selected } })}\n`,
  );
  const completionFile = path.join(root, 'MODEL_SELECTION_COMPLETE.json');
  fs.writeFileSync(
    completionFile,
    JSON.stringify({
      status: 'MODEL_SELECTION_COMPLETE',
      allowAutoCommit: false,
      candidateId: selected.candidateId,
      modelVersion: selected.modelVersion,
      manifestSha256: selected.manifestSha256,
      selectionReportSha256: sha256(fs.readFileSync(selectionFile)),
      humanAuditSha256: 'b'.repeat(64),
    }),
  );
  const output = path.join(root, 'A3_SELECTION_APPROVAL_REQUEST.json');
  const request = createShadowApprovalRequest({
    selectionReport: selectionFile,
    completionReceipt: completionFile,
    output,
  });
  assert.equal(request.status, 'PENDING_HUMAN_APPROVAL');
  assert.equal(request.approvedBy, '');
  assert.equal(request.approvedAt, null);
  assert.equal(request.humanAttestation, '');
  assert.equal(request.safetyBoundary.allowAutoCommit, false);
  assert.equal(
    request.selectionReportSha256,
    sha256(fs.readFileSync(selectionFile)),
  );
  assert.throws(
    () =>
      createShadowApprovalRequest({
        selectionReport: selectionFile,
        completionReceipt: completionFile,
        output: path.join(root, 'A3_SELECTION_APPROVED.json'),
      }),
    /must not be named/u,
  );
});
