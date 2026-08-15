const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const cliPath = path.resolve(
  __dirname,
  '..',
  'build',
  'qingji-cli',
  'scripts',
  'qingji-cli.js',
);

function run(args, input, cwd) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    input,
    windowsHide: true,
  });
}

test('doctor validates MCP build and both host configs without reading bills', t => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-doctor-'));
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectDir, '.codex'));
  fs.mkdirSync(path.join(projectDir, 'build', 'qingji-mcp', 'scripts'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'QingJiAI' }),
  );
  fs.writeFileSync(
    path.join(projectDir, 'build', 'qingji-mcp', 'scripts', 'qingji-mcp.js'),
    '',
  );
  fs.writeFileSync(
    path.join(projectDir, '.mcp.json'),
    '${CLAUDE_PROJECT_DIR:-.}/build/qingji-mcp/scripts/qingji-mcp.js',
  );
  fs.writeFileSync(
    path.join(projectDir, '.codex', 'config.toml'),
    `[mcp_servers.qingji]\nargs = ["build/qingji-mcp/scripts/qingji-mcp.js"]\ncwd = "${projectDir.replaceAll('\\', '/')}"\n`,
  );

  const result = run(['doctor'], undefined, projectDir);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, 'doctor');
  assert.equal(payload.status, 'READY_FOR_HOST_RESTART');
  assert.equal(
    payload.checks.every(check => check.status === 'PASS'),
    true,
  );
  assert.equal(Object.hasOwn(payload, 'text'), false);
});

test('bill preview reuses the local parser and emits stable JSON', () => {
  const result = run([
    'bill',
    'preview',
    '今天午饭25元，微信支付',
    '--reference-date',
    '2026-08-15T04:00:00.000Z',
    '--timezone-offset',
    '480',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.command, 'bill.preview');
  assert.equal(payload.candidateCount, 1);
  assert.equal(payload.candidates[0].amountMinor, 2500);
  assert.equal(payload.candidates[0].type, 'EXPENSE');
  assert.equal(payload.candidates[0].categoryKey, 'expense.food');
  assert.equal(payload.candidates[0].accountKey, 'WECHAT');
});

test('bill preview accepts stdin so bill text need not be in shell history', () => {
  const result = run(
    [
      'bill',
      'preview',
      '--reference-date',
      '2026-08-15T04:00:00.000Z',
      '--timezone-offset',
      '480',
    ],
    '昨天打车18元，支付宝',
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.candidates[0].amountMinor, 1800);
  assert.equal(payload.candidates[0].accountKey, 'ALIPAY');
});

test('open-android dry-run never invokes adb and documents the review boundary', () => {
  const result = run(['bill', 'open-android', '午饭25元，微信', '--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'DRY_RUN');
  assert.equal(payload.packageName, 'com.qingjiai.internal');
  assert.match(payload.safety, /不会自动确认入账/u);
  assert.equal(Object.hasOwn(payload, 'text'), false);
});

test('open-ios-simulator dry-run documents the review-only boundary', () => {
  const result = run([
    'bill',
    'open-ios-simulator',
    '午饭25元，微信',
    '--dry-run',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'DRY_RUN');
  assert.equal(payload.device, 'booted');
  assert.match(payload.safety, /不会启动 Simulator 或写入账本/u);
  assert.equal(Object.hasOwn(payload, 'text'), false);
});

test('queue-pending-android dry-run requires and returns an idempotency key', () => {
  const result = run([
    'bill',
    'queue-pending-android',
    '午饭25元，微信',
    '--idempotency-key',
    'bill-20260815-001',
    '--dry-run',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'DRY_RUN');
  assert.equal(payload.idempotencyKey, 'bill-20260815-001');
  assert.match(payload.safety, /不会连接设备/u);
  assert.equal(Object.hasOwn(payload, 'text'), false);
});

test('status-android dry-run validates a request key without invoking adb', () => {
  const requestKey = 'a'.repeat(64);
  const result = run([
    'bill',
    'status-android',
    '--request-key',
    requestKey,
    '--dry-run',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'DRY_RUN');
  assert.equal(payload.requestKey, requestKey);
  assert.deepEqual(payload.transactionIds, []);
});

test('unknown options fail with a machine-readable error', () => {
  const result = run([
    'bill',
    'preview',
    '午饭25元',
    '--write-database',
    'yes',
  ]);

  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.error.code, 'UNKNOWN_OPTION');
});
