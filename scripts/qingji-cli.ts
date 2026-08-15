import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AGENT_COMMAND_SCHEMA_VERSION,
  AndroidPendingBridgeError,
  AndroidReviewBridgeError,
  getAndroidPendingBillStatus,
  IosReviewBridgeError,
  MAX_AGENT_BILL_TEXT_LENGTH,
  openAndroidReview,
  openIosSimulatorReview,
  previewAgentBill,
  queueAndroidPendingBill,
} from '../src/agent';

type ParsedArguments = {
  options: Map<string, string | true>;
  positionals: string[];
};

class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode = 2,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

function printJson(value: unknown, stream: NodeJS.WritableStream): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage(): string {
  return [
    '轻记 AI 代理 CLI',
    '',
    '用法：',
    '  pnpm qingji -- doctor',
    '  pnpm qingji -- bill preview [账单文字] [--reference-date ISO] [--timezone-offset 分钟]',
    '  pnpm qingji -- bill open-android [账单文字] [--package 包名] [--serial 序列号] [--dry-run]',
    '  pnpm qingji -- bill open-ios-simulator [账单文字] [--device UDID] [--dry-run]',
    '  pnpm qingji -- bill queue-pending-android [账单文字] --idempotency-key 键 [--caller-id 标识] [--dry-run]',
    '  pnpm qingji -- bill status-android --request-key SHA256 [--serial 序列号] [--dry-run]',
    '',
    '输入：',
    '  可使用位置参数、--text，或从 stdin 传入账单文字。',
    '  stdin 适合避免把完整账单写入终端历史。',
    '',
    '安全边界：',
    '  open-android 只把文字分享给 App 并打开核对页，不会自动确认入账。',
    '  open-ios-simulator 只打开 iOS Simulator 核对页，不会写入账本。',
    '  queue-pending-android 仅向 Internal App 投递幂等命令，App 最多创建待确认记录。',
    '  status-android 只读取最小化结果回执，不访问手机 SQLite。',
  ].join('\n');
}

type DoctorCheck = {
  id: string;
  status: 'PASS' | 'FAIL';
  message: string;
};

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/$/u, '').toLowerCase();
}

function doctor(): {
  schemaVersion: number;
  command: string;
  status: string;
  checks: DoctorCheck[];
} {
  const projectRoot = resolve(process.cwd());
  const mcpEntry = resolve(
    projectRoot,
    'build',
    'qingji-mcp',
    'scripts',
    'qingji-mcp.js',
  );
  const checks: DoctorCheck[] = [];
  const push = (id: string, passed: boolean, message: string): void => {
    checks.push({ id, status: passed ? 'PASS' : 'FAIL', message });
  };

  const [nodeMajor = 0, nodeMinor = 0] = process.versions.node
    .split('.')
    .map(value => Number(value));
  push(
    'node-version',
    nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 11),
    `Node ${process.versions.node}；项目要求 >= 22.11.0。`,
  );

  let packageName = '';
  try {
    packageName = JSON.parse(
      readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
    ).name;
  } catch {
    // The failure is reported without exposing file contents.
  }
  push(
    'project-root',
    packageName === 'QingJiAI',
    packageName === 'QingJiAI'
      ? '当前目录是轻记 AI 项目根目录。'
      : '请在轻记 AI 项目根目录运行 doctor。',
  );
  push(
    'mcp-build',
    existsSync(mcpEntry),
    existsSync(mcpEntry)
      ? 'MCP Server 构建产物已存在。'
      : '缺少 MCP Server 构建产物；请运行 pnpm qingji:mcp:build。',
  );

  let claudeConfig = '';
  try {
    claudeConfig = readFileSync(resolve(projectRoot, '.mcp.json'), 'utf8');
  } catch {
    // Reported below.
  }
  push(
    'claude-config',
    claudeConfig.includes(
      '${CLAUDE_PROJECT_DIR:-.}/build/qingji-mcp/scripts/qingji-mcp.js',
    ),
    claudeConfig.length > 0
      ? 'Claude Code 项目配置已指向共用 MCP Server。'
      : '缺少 Claude Code 项目级 .mcp.json。',
  );

  let codexConfig = '';
  try {
    codexConfig = readFileSync(
      resolve(projectRoot, '.codex', 'config.toml'),
      'utf8',
    );
  } catch {
    // Reported below.
  }
  const configuredCwd = codexConfig.match(/^cwd\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  const codexEntryConfigured =
    codexConfig.includes('[mcp_servers.qingji]') &&
    codexConfig.includes('args = ["build/qingji-mcp/scripts/qingji-mcp.js"]');
  push(
    'codex-config',
    codexEntryConfigured &&
      configuredCwd !== undefined &&
      normalizePath(configuredCwd) === normalizePath(projectRoot),
    !codexEntryConfigured
      ? '缺少或无法识别 Codex 项目级 MCP 配置。'
      : configuredCwd === undefined
        ? 'Codex MCP 配置缺少 cwd。'
        : normalizePath(configuredCwd) === normalizePath(projectRoot)
          ? 'Codex 项目配置已指向当前项目和共用 MCP Server。'
          : '项目路径已变化；请更新 .codex/config.toml 中的 cwd。',
  );

  return {
    schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
    command: 'doctor',
    status: checks.every(check => check.status === 'PASS')
      ? 'READY_FOR_HOST_RESTART'
      : 'ACTION_REQUIRED',
    checks,
  };
}

function parseArguments(values: readonly string[]): ParsedArguments {
  const options = new Map<string, string | true>();
  const positionals: string[] = [];

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }

    const equalIndex = value.indexOf('=');
    const name = value.slice(2, equalIndex === -1 ? undefined : equalIndex);
    if (name.length === 0) {
      throw new CliError('INVALID_ARGUMENT', '参数名不能为空。');
    }
    if (options.has(name)) {
      throw new CliError('DUPLICATE_OPTION', `参数 --${name} 不能重复。`);
    }
    if (equalIndex !== -1) {
      options.set(name, value.slice(equalIndex + 1));
      continue;
    }
    if (name === 'dry-run' || name === 'help') {
      options.set(name, true);
      continue;
    }
    const next = values[index + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new CliError('MISSING_OPTION_VALUE', `参数 --${name} 缺少值。`);
    }
    options.set(name, next);
    index += 1;
  }

  return { options, positionals };
}

function assertOnlyOptions(
  argumentsValue: ParsedArguments,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  for (const option of argumentsValue.options.keys()) {
    if (!allowedSet.has(option)) {
      throw new CliError('UNKNOWN_OPTION', `不支持参数 --${option}。`);
    }
  }
}

function optionString(
  argumentsValue: ParsedArguments,
  name: string,
): string | undefined {
  const value = argumentsValue.options.get(name);
  if (value === true) {
    throw new CliError('MISSING_OPTION_VALUE', `参数 --${name} 缺少值。`);
  }
  return value;
}

function readInputText(argumentsValue: ParsedArguments): string {
  const optionText = optionString(argumentsValue, 'text');
  if (optionText !== undefined && argumentsValue.positionals.length > 0) {
    throw new CliError(
      'MULTIPLE_TEXT_INPUTS',
      '账单文字只能通过位置参数、--text 或 stdin 中的一种方式提供。',
    );
  }

  let value = optionText ?? argumentsValue.positionals.join(' ');
  if (value.length === 0 && process.stdin.isTTY !== true) {
    value = readFileSync(0, 'utf8');
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new CliError('EMPTY_TEXT', '请提供账单文字。');
  }
  if ([...normalized].length > MAX_AGENT_BILL_TEXT_LENGTH) {
    throw new CliError(
      'TEXT_TOO_LONG',
      `账单文字不能超过 ${MAX_AGENT_BILL_TEXT_LENGTH} 个 Unicode 字符。`,
    );
  }
  return normalized;
}

function parseReferenceDate(argumentsValue: ParsedArguments): Date {
  const raw = optionString(argumentsValue, 'reference-date');
  if (raw === undefined) return new Date();
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new CliError(
      'INVALID_REFERENCE_DATE',
      '--reference-date 必须是有效日期。',
    );
  }
  return value;
}

function parseTimezoneOffset(
  argumentsValue: ParsedArguments,
): number | undefined {
  const raw = optionString(argumentsValue, 'timezone-offset');
  if (raw === undefined) return undefined;
  if (!/^-?\d{1,4}$/u.test(raw)) {
    throw new CliError(
      'INVALID_TIMEZONE_OFFSET',
      '--timezone-offset 必须是相对 UTC 的整数分钟数。',
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < -840 || value > 840) {
    throw new CliError(
      'INVALID_TIMEZONE_OFFSET',
      '--timezone-offset 必须位于 -840 到 840 分钟之间。',
    );
  }
  return value;
}

function previewBill(text: string, argumentsValue: ParsedArguments) {
  const referenceDate = parseReferenceDate(argumentsValue);
  const timezoneOffsetMinutes = parseTimezoneOffset(argumentsValue);
  return previewAgentBill({
    text,
    referenceDate: referenceDate.toISOString(),
    ...(timezoneOffsetMinutes === undefined ? {} : { timezoneOffsetMinutes }),
  });
}

function openOnAndroid(text: string, argumentsValue: ParsedArguments) {
  return openAndroidReview({
    text,
    packageName: optionString(argumentsValue, 'package'),
    serial: optionString(argumentsValue, 'serial'),
    adb: optionString(argumentsValue, 'adb'),
    dryRun: argumentsValue.options.get('dry-run') === true,
  });
}

function openOnIosSimulator(text: string, argumentsValue: ParsedArguments) {
  return openIosSimulatorReview({
    text,
    device: optionString(argumentsValue, 'device'),
    xcrun: optionString(argumentsValue, 'xcrun'),
    dryRun: argumentsValue.options.get('dry-run') === true,
  });
}

function queuePendingOnAndroid(text: string, argumentsValue: ParsedArguments) {
  const idempotencyKey = optionString(argumentsValue, 'idempotency-key');
  if (idempotencyKey === undefined) {
    throw new CliError(
      'MISSING_IDEMPOTENCY_KEY',
      'queue-pending-android 必须提供 --idempotency-key。',
    );
  }
  const referenceDate = optionString(argumentsValue, 'reference-date');
  if (
    referenceDate !== undefined &&
    Number.isNaN(new Date(referenceDate).getTime())
  ) {
    throw new CliError(
      'INVALID_REFERENCE_DATE',
      '--reference-date 必须是有效日期。',
    );
  }
  const timezoneOffsetMinutes = parseTimezoneOffset(argumentsValue);
  return queueAndroidPendingBill({
    callerId: optionString(argumentsValue, 'caller-id') ?? 'qingji-cli',
    idempotencyKey,
    text,
    ...(referenceDate === undefined ? {} : { referenceDate }),
    ...(timezoneOffsetMinutes === undefined ? {} : { timezoneOffsetMinutes }),
    packageName: optionString(argumentsValue, 'package'),
    serial: optionString(argumentsValue, 'serial'),
    adb: optionString(argumentsValue, 'adb'),
    dryRun: argumentsValue.options.get('dry-run') === true,
  });
}

function pendingStatusOnAndroid(argumentsValue: ParsedArguments) {
  const requestKey = optionString(argumentsValue, 'request-key');
  if (requestKey === undefined) {
    throw new CliError(
      'MISSING_REQUEST_KEY',
      'status-android 必须提供 --request-key。',
    );
  }
  if (argumentsValue.positionals.length > 0) {
    throw new CliError(
      'UNEXPECTED_POSITIONAL_ARGUMENT',
      'status-android 不接受账单文字。',
    );
  }
  return getAndroidPendingBillStatus({
    requestKey,
    packageName: optionString(argumentsValue, 'package'),
    serial: optionString(argumentsValue, 'serial'),
    adb: optionString(argumentsValue, 'adb'),
    dryRun: argumentsValue.options.get('dry-run') === true,
  });
}

function main(): void {
  const [scope, action, ...rawArguments] = process.argv.slice(2);
  if (scope === undefined || scope === '--help' || scope === 'help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (scope === 'doctor') {
    if (action !== undefined || rawArguments.length > 0) {
      throw new CliError('UNEXPECTED_ARGUMENT', 'doctor 不接受参数。');
    }
    const result = doctor();
    printJson(result, process.stdout);
    if (result.status !== 'READY_FOR_HOST_RESTART') process.exitCode = 4;
    return;
  }
  if (scope !== 'bill' || action === undefined) {
    throw new CliError(
      'UNKNOWN_COMMAND',
      '目前只支持 bill preview 和 bill open-android。',
    );
  }

  const argumentsValue = parseArguments(rawArguments);
  if (argumentsValue.options.get('help') === true) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (action === 'preview') {
    assertOnlyOptions(argumentsValue, [
      'help',
      'reference-date',
      'text',
      'timezone-offset',
    ]);
    const text = readInputText(argumentsValue);
    printJson(previewBill(text, argumentsValue), process.stdout);
    return;
  }

  if (action === 'open-android') {
    assertOnlyOptions(argumentsValue, [
      'adb',
      'dry-run',
      'help',
      'package',
      'serial',
      'text',
    ]);
    const text = readInputText(argumentsValue);
    printJson(openOnAndroid(text, argumentsValue), process.stdout);
    return;
  }

  if (action === 'open-ios-simulator') {
    assertOnlyOptions(argumentsValue, [
      'device',
      'dry-run',
      'help',
      'text',
      'xcrun',
    ]);
    const text = readInputText(argumentsValue);
    printJson(openOnIosSimulator(text, argumentsValue), process.stdout);
    return;
  }

  if (action === 'queue-pending-android') {
    assertOnlyOptions(argumentsValue, [
      'adb',
      'caller-id',
      'dry-run',
      'help',
      'idempotency-key',
      'package',
      'reference-date',
      'serial',
      'text',
      'timezone-offset',
    ]);
    const text = readInputText(argumentsValue);
    printJson(queuePendingOnAndroid(text, argumentsValue), process.stdout);
    return;
  }

  if (action === 'status-android') {
    assertOnlyOptions(argumentsValue, [
      'adb',
      'dry-run',
      'help',
      'package',
      'request-key',
      'serial',
    ]);
    printJson(pendingStatusOnAndroid(argumentsValue), process.stdout);
    return;
  }

  throw new CliError(
    'UNKNOWN_COMMAND',
    '不支持该 bill 子命令；请运行 pnpm qingji -- --help。',
  );
}

try {
  main();
} catch (error) {
  const cliError =
    error instanceof CliError
      ? error
      : error instanceof AndroidReviewBridgeError
        ? new CliError(error.code, error.message, 3)
        : error instanceof AndroidPendingBridgeError
          ? new CliError(error.code, error.message, 3)
          : error instanceof IosReviewBridgeError
            ? new CliError(error.code, error.message, 3)
            : new CliError(
                'UNEXPECTED_ERROR',
                error instanceof Error ? error.message : '发生未知错误。',
                1,
              );
  printJson(
    {
      schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
      error: { code: cliError.code, message: cliError.message },
    },
    process.stderr,
  );
  process.exitCode = cliError.exitCode;
}
