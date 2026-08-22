const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function claudeCommand() {
  if (process.env.CLAUDE_CLI_PATH) return process.env.CLAUDE_CLI_PATH;
  if (process.platform !== 'win32') return 'claude';

  const lookup = spawnSync('where.exe', ['claude.cmd'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const wrapper = lookup.stdout?.split(/\r?\n/u).find(Boolean);
  if (wrapper !== undefined) {
    const executable = path.join(
      path.dirname(wrapper),
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude.exe',
    );
    if (fs.existsSync(executable)) return executable;
  }
  return 'claude.exe';
}

function parseClaudeEnvelope(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Claude CLI returned invalid JSON: ${error.message}`);
  }

  let structured = envelope.structured_output;
  if (structured === undefined && envelope.result !== undefined) {
    structured = envelope.result;
  }
  if (typeof structured === 'string') {
    try {
      structured = JSON.parse(structured);
    } catch (error) {
      throw new Error(
        `Claude structured result is invalid JSON: ${error.message}`,
      );
    }
  }
  if (typeof structured !== 'object' || structured === null) {
    throw new Error('Claude CLI response did not contain structured_output.');
  }

  return {
    value: structured,
    costUsd:
      typeof envelope.total_cost_usd === 'number'
        ? envelope.total_cost_usd
        : undefined,
    model: typeof envelope.model === 'string' ? envelope.model : undefined,
  };
}

function runClaudeStructured({
  prompt,
  schema,
  model,
  maxBudgetUsd,
  cwd,
  spawn = spawnSync,
}) {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(schema),
    '--model',
    model,
    '--max-budget-usd',
    String(maxBudgetUsd),
    '--tools',
    '',
    '--disable-slash-commands',
    '--no-session-persistence',
    prompt,
  ];
  const result = spawn(claudeCommand(), args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw new Error(`Unable to start Claude CLI: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`Claude CLI exited with ${result.status}: ${detail}`);
  }
  return parseClaudeEnvelope(result.stdout);
}

module.exports = { parseClaudeEnvelope, runClaudeStructured };
