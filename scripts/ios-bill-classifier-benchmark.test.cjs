const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createPlan,
  displayCommand,
  execute,
} = require('./ios-bill-classifier-benchmark.cjs');

test('iOS benchmark plan binds a candidate and physical device build', () => {
  const root = path.resolve(__dirname, '..');
  const plan = createPlan({
    root,
    device: '00008110-TEST',
    developmentTeam: 'TEAM123456',
    candidateDir: 'build/model-candidates/codex-v4',
    outputDir: 'build/ios-benchmark/codex-v4',
    runRoot: path.join(os.tmpdir(), 'qingji-ios-plan'),
  });
  assert.match(
    displayCommand(plan.commands.build),
    /BILL_CLASSIFIER_ASSETS_ROOT/u,
  );
  assert.match(displayCommand(plan.commands.build), /id=00008110-TEST/u);
  assert.match(
    displayCommand(plan.commands.stage),
    /stage-benchmark-model\.cjs/u,
  );
  assert.match(
    displayCommand(plan.commands.golden),
    /create-device-golden-input\.cjs/u,
  );
});

test('iOS benchmark cannot execute on a non-macOS host', () => {
  if (process.platform === 'darwin') return;
  assert.throws(
    () =>
      execute({
        acknowledgeReplacesInstalledApp: true,
        root: process.cwd(),
        device: 'test',
        developmentTeam: 'test',
        candidateDir: 'candidate',
        outputDir: 'output',
        runRoot: path.join(os.tmpdir(), 'qingji-ios-plan'),
      }),
    /must run on macOS/u,
  );
});
