const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const serverPath = path.resolve(
  __dirname,
  '..',
  'build',
  'qingji-mcp',
  'scripts',
  'qingji-mcp.js',
);

function createClient() {
  const child = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map();

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdout += chunk;
    for (;;) {
      const newline = stdout.indexOf('\n');
      if (newline === -1) break;
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (line.length === 0) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (waiter !== undefined) {
        pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  });

  function send(method, params) {
    const id = nextId;
    nextId += 1;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} 超时。stderr: ${stderr}`));
      }, 5_000);
      pending.set(id, {
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
      });
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
    );
    return response;
  }

  function notify(method, params = {}) {
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`,
    );
  }

  return {
    child,
    notify,
    send,
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

async function initialize(client) {
  const response = await client.send('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'qingji-mcp-test', version: '1.0.0' },
  });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  client.notify('notifications/initialized');
}

test('MCP advertises bounded preview and Android review tools', async t => {
  const client = createClient();
  t.after(() => client.close());
  await initialize(client);

  const response = await client.send('tools/list', {});
  const tools = response.result.tools;
  assert.deepEqual(
    tools.map(tool => tool.name),
    [
      'preview_bill',
      'open_android_review',
      'open_ios_simulator_review',
      'queue_pending_bill_android',
      'get_operation_status_android',
    ],
  );
  assert.equal(tools[0].annotations.readOnlyHint, true);
  assert.equal(tools[1].annotations.destructiveHint, false);
  assert.equal(
    tools.some(tool => /confirm|write/iu.test(tool.name)),
    false,
  );
  assert.equal(tools[2].annotations.destructiveHint, false);
  assert.equal(tools[3].annotations.idempotentHint, true);
  assert.equal(tools[4].annotations.readOnlyHint, true);
  assert.equal(tools[0].inputSchema.properties.text.maxLength, 500);
  assert.equal(tools[1].inputSchema.properties.text.maxLength, 500);
  assert.equal(tools[2].inputSchema.properties.text.maxLength, 500);
  assert.equal(tools[3].inputSchema.properties.text.maxLength, 500);
});

test('MCP rejects 501-character bill text at the protocol boundary', async t => {
  const client = createClient();
  t.after(() => client.close());
  await initialize(client);

  const response = await client.send('tools/call', {
    name: 'preview_bill',
    arguments: { text: '餐'.repeat(501) },
  });

  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent, undefined);
});

test('MCP iOS Simulator dry-run remains review-only', async t => {
  const client = createClient();
  t.after(() => client.close());
  await initialize(client);

  const response = await client.send('tools/call', {
    name: 'open_ios_simulator_review',
    arguments: { text: '午饭25元，微信', dryRun: true },
  });
  const output = response.result.structuredContent;
  assert.equal(output.status, 'DRY_RUN');
  assert.equal(output.device, 'booted');
  assert.equal(Object.hasOwn(output, 'text'), false);
});

test('MCP status dry-run returns only a minimal receipt shape', async t => {
  const client = createClient();
  t.after(() => client.close());
  await initialize(client);
  const requestKey = 'b'.repeat(64);

  const response = await client.send('tools/call', {
    name: 'get_operation_status_android',
    arguments: { requestKey, dryRun: true },
  });
  const output = response.result.structuredContent;
  assert.equal(output.status, 'DRY_RUN');
  assert.equal(output.requestKey, requestKey);
  assert.equal(Object.hasOwn(output, 'text'), false);
});

test('MCP pending queue dry-run is explicit and omits bill text', async t => {
  const client = createClient();
  t.after(() => client.close());
  await initialize(client);

  const response = await client.send('tools/call', {
    name: 'queue_pending_bill_android',
    arguments: {
      text: '午饭25元，微信',
      callerId: 'codex-local',
      idempotencyKey: 'bill-20260815-001',
      dryRun: true,
    },
  });
  const output = response.result.structuredContent;
  assert.equal(output.status, 'DRY_RUN');
  assert.equal(output.idempotencyKey, 'bill-20260815-001');
  assert.equal(Object.hasOwn(output, 'text'), false);
});

test('MCP preview uses the same parser as the app', async t => {
  const client = createClient();
  t.after(() => client.close());
  await initialize(client);

  const response = await client.send('tools/call', {
    name: 'preview_bill',
    arguments: {
      text: '今天午饭25元，微信支付',
      referenceDate: '2026-08-15T04:00:00.000Z',
      timezoneOffsetMinutes: 480,
    },
  });
  assert.equal(response.result.structuredContent.candidateCount, 1);
  assert.equal(
    response.result.structuredContent.candidates[0].amountMinor,
    2500,
  );
  assert.equal(
    response.result.structuredContent.candidates[0].accountKey,
    'WECHAT',
  );
});

test('MCP Android dry-run exposes the manual-review safety boundary', async t => {
  const client = createClient();
  t.after(() => client.close());
  await initialize(client);

  const response = await client.send('tools/call', {
    name: 'open_android_review',
    arguments: { text: '午饭25元，微信', dryRun: true },
  });
  assert.equal(response.result.structuredContent.status, 'DRY_RUN');
  assert.match(response.result.structuredContent.safety, /不会自动确认入账/u);
  assert.equal(Object.hasOwn(response.result.structuredContent, 'text'), false);
});
