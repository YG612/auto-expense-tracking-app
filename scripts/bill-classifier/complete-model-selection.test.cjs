const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { layout, missingEvidence } = require('./complete-model-selection.cjs');

test('release readiness names every missing external evidence file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-readiness-'));
  const current = layout({ root, candidateName: 'candidate' });
  const blockers = missingEvidence(current);
  const codes = blockers.map(blocker => blocker.code);
  assert.ok(codes.includes('MISSING_HUMANAUDIT'));
  assert.ok(codes.includes('MISSING_IOSBENCHMARK'));
  assert.ok(codes.includes('MISSING_IOSDEVICEEVIDENCE'));
  assert.ok(codes.includes('MISSING_IOSGOLDEN'));
});

test('release readiness accepts a complete evidence layout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-readiness-'));
  const current = layout({ root, candidateName: 'candidate' });
  for (const file of [current.humanAudit, ...Object.values(current.runtime)]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'fixture');
  }
  assert.deepEqual(missingEvidence(current), []);
});
