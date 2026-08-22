import { spawnSync } from 'node:child_process';

import { sha256 } from '../utils/sha256';
import {
  AGENT_COMMAND_SCHEMA_VERSION,
  type AgentPendingBillInput,
} from './AgentCommandService';
import {
  DEFAULT_ANDROID_AGENT_PACKAGE,
  MAX_AGENT_BILL_TEXT_LENGTH,
} from './AndroidReviewBridge';

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/u;

export type AndroidPendingQueueInput = AgentPendingBillInput & {
  packageName?: string;
  serial?: string;
  adb?: string;
  dryRun?: boolean;
};

export type AndroidPendingQueueResult = {
  schemaVersion: typeof AGENT_COMMAND_SCHEMA_VERSION;
  command: 'bill.queue-pending-android';
  status: 'DRY_RUN' | 'QUEUED_FOR_APP';
  requestKey: string;
  packageName: string;
  serial?: string;
  idempotencyKey: string;
  safety: string;
};

export type AndroidPendingStatusInput = {
  requestKey: string;
  packageName?: string;
  serial?: string;
  adb?: string;
  dryRun?: boolean;
};

export type AndroidPendingStatusResult = {
  schemaVersion: typeof AGENT_COMMAND_SCHEMA_VERSION;
  command: 'bill.status-android';
  requestKey: string;
  status:
    | 'DRY_RUN'
    | 'QUEUED_OR_UNKNOWN'
    | 'COMMITTED'
    | 'ALREADY_COMMITTED'
    | 'CONSUMED_DELETED'
    | 'REJECTED';
  packageName: string;
  serial?: string;
  transactionIds: readonly string[];
  completedAt?: string;
  errorCode?: string;
  safety: string;
};

export class AndroidPendingBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AndroidPendingBridgeError';
  }
}

function safeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER.test(normalized)) {
    throw new AndroidPendingBridgeError(
      'INVALID_AGENT_IDENTIFIER',
      `${field} 必须是 1 到 128 位安全标识符。`,
    );
  }
  return normalized;
}

function safePackage(value: string | undefined): string {
  const packageName = value ?? DEFAULT_ANDROID_AGENT_PACKAGE;
  if (!/^[A-Za-z][A-Za-z0-9_.]{2,127}$/u.test(packageName)) {
    throw new AndroidPendingBridgeError(
      'INVALID_ANDROID_PACKAGE',
      'Android 包名格式无效。',
    );
  }
  return packageName;
}

function safeSerial(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) {
    throw new AndroidPendingBridgeError(
      'INVALID_ADB_SERIAL',
      'ADB 设备序列号格式无效。',
    );
  }
  return value;
}

function safeText(value: string): string {
  const text = value.trim();
  if (text.length === 0 || [...text].length > MAX_AGENT_BILL_TEXT_LENGTH) {
    throw new AndroidPendingBridgeError(
      'INVALID_BILL_TEXT',
      `账单文字必须是 1 到 ${MAX_AGENT_BILL_TEXT_LENGTH} 个 Unicode 字符。`,
    );
  }
  return text;
}

function runAdb(
  adb: string,
  args: readonly string[],
  input: string | undefined,
  errorCode: string,
): string {
  const result = spawnSync(adb, args, {
    encoding: 'utf8',
    input,
    shell: false,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw new AndroidPendingBridgeError(
      errorCode,
      `无法启动 ADB：${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim().slice(0, 2_000);
    throw new AndroidPendingBridgeError(
      errorCode,
      detail || `ADB 退出码为 ${String(result.status)}。`,
    );
  }
  return result.stdout;
}

function safeRequestKey(value: string): string {
  const normalized = value.trim();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new AndroidPendingBridgeError(
      'INVALID_AGENT_REQUEST_KEY',
      'requestKey 必须是 64 位小写十六进制 SHA-256。',
    );
  }
  return normalized;
}

function parsedStatusResult(
  serialized: string,
  requestKey: string,
  packageName: string,
  serial: string | undefined,
): AndroidPendingStatusResult {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new AndroidPendingBridgeError(
      'ADB_AGENT_RESULT_INVALID',
      'Internal App 返回了无效的代理操作结果。',
    );
  }
  if (typeof value !== 'object' || value === null) {
    throw new AndroidPendingBridgeError(
      'ADB_AGENT_RESULT_INVALID',
      'Internal App 返回了无效的代理操作结果。',
    );
  }
  const result = value as Record<string, unknown>;
  const statuses = new Set([
    'QUEUED_OR_UNKNOWN',
    'COMMITTED',
    'ALREADY_COMMITTED',
    'CONSUMED_DELETED',
    'REJECTED',
  ]);
  const transactionIds = result.transactionIds;
  const terminal = result.status !== 'QUEUED_OR_UNKNOWN';
  if (
    result.schemaVersion !== AGENT_COMMAND_SCHEMA_VERSION ||
    result.command !== 'bill.create-pending' ||
    result.requestKey !== requestKey ||
    typeof result.status !== 'string' ||
    !statuses.has(result.status) ||
    !Array.isArray(transactionIds) ||
    transactionIds.length > 20 ||
    transactionIds.some(
      id => typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(id),
    ) ||
    (result.completedAt !== undefined &&
      (typeof result.completedAt !== 'string' ||
        Number.isNaN(new Date(result.completedAt).getTime()))) ||
    (result.errorCode !== undefined &&
      (typeof result.errorCode !== 'string' ||
        !/^[A-Z0-9._:-]{1,128}$/u.test(result.errorCode))) ||
    terminal !== (typeof result.completedAt === 'string') ||
    (result.status === 'REJECTED') !== (typeof result.errorCode === 'string') ||
    ['COMMITTED', 'ALREADY_COMMITTED'].includes(result.status) !==
      transactionIds.length > 0
  ) {
    throw new AndroidPendingBridgeError(
      'ADB_AGENT_RESULT_INVALID',
      'Internal App 返回了无效的代理操作结果。',
    );
  }
  return {
    schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
    command: 'bill.status-android',
    requestKey,
    status: result.status as AndroidPendingStatusResult['status'],
    packageName,
    ...(serial === undefined ? {} : { serial }),
    transactionIds: transactionIds as string[],
    ...(typeof result.completedAt === 'string'
      ? { completedAt: result.completedAt }
      : {}),
    ...(typeof result.errorCode === 'string'
      ? { errorCode: result.errorCode }
      : {}),
    safety: '只读取该 requestKey 的最小化结果回执，不访问手机 SQLite。',
  };
}

/**
 * Queues a command in the Internal app's no-backup directory using Android's
 * debuggable run-as boundary. Bill JSON is sent over stdin; user text is never
 * interpolated into the fixed remote shell program.
 */
export function queueAndroidPendingBill(
  input: AndroidPendingQueueInput,
): AndroidPendingQueueResult {
  const callerId = safeIdentifier(input.callerId, 'callerId');
  const idempotencyKey = safeIdentifier(input.idempotencyKey, 'idempotencyKey');
  const text = safeText(input.text);
  const packageName = safePackage(input.packageName);
  const serial = safeSerial(input.serial);
  const envelope = {
    schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
    command: 'bill.create-pending' as const,
    callerId,
    idempotencyKey,
    text,
    referenceDate: input.referenceDate ?? null,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes ?? null,
  };
  const serialized = JSON.stringify(envelope);
  const requestKey = sha256(serialized);
  const baseResult: Omit<AndroidPendingQueueResult, 'status' | 'safety'> = {
    schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
    command: 'bill.queue-pending-android' as const,
    requestKey,
    packageName,
    ...(serial === undefined ? {} : { serial }),
    idempotencyKey,
  };

  if (input.dryRun === true) {
    return {
      ...baseResult,
      status: 'DRY_RUN',
      safety: '只验证入队参数；不会连接设备或创建账本记录。',
    };
  }

  const adb = input.adb ?? 'adb';
  const device = serial === undefined ? [] : ['-s', serial];
  const directory = 'no_backup/agent-command-inbox';
  const resultsDirectory = 'no_backup/agent-command-results';
  const temporary = `${directory}/${requestKey}.tmp`;
  const destination = `${directory}/${requestKey}.json`;
  const previousResult = `${resultsDirectory}/${requestKey}.json`;
  const remoteProgram =
    `umask 077; mkdir -p ${directory} ${resultsDirectory} && ` +
    `cat > ${temporary} && mv ${temporary} ${destination} && ` +
    `rm -f ${previousResult}`;
  runAdb(
    adb,
    [
      ...device,
      'shell',
      'run-as',
      packageName,
      'sh',
      '-c',
      `'${remoteProgram}'`,
    ],
    serialized,
    'ADB_AGENT_QUEUE_FAILED',
  );
  runAdb(
    adb,
    [
      ...device,
      'shell',
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
      '-n',
      `${packageName}/com.qingjiai.MainActivity`,
    ],
    undefined,
    'ADB_AGENT_APP_LAUNCH_FAILED',
  );

  return {
    ...baseResult,
    status: 'QUEUED_FOR_APP',
    safety:
      '命令已送入 Internal App；App 只会创建待确认记录，不会自动确认入账。',
  };
}

/** Reads one minimal result receipt through the same Internal-only run-as boundary. */
export function getAndroidPendingBillStatus(
  input: AndroidPendingStatusInput,
): AndroidPendingStatusResult {
  const requestKey = safeRequestKey(input.requestKey);
  const packageName = safePackage(input.packageName);
  const serial = safeSerial(input.serial);
  const baseResult: Omit<
    AndroidPendingStatusResult,
    'status' | 'safety' | 'completedAt' | 'errorCode'
  > = {
    schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
    command: 'bill.status-android' as const,
    requestKey,
    packageName,
    ...(serial === undefined ? {} : { serial }),
    transactionIds: [] as string[],
  };
  if (input.dryRun === true) {
    return {
      ...baseResult,
      status: 'DRY_RUN',
      safety: '只验证状态查询参数；不会连接设备。',
    };
  }

  const fallback = JSON.stringify({
    schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
    command: 'bill.create-pending',
    requestKey,
    status: 'QUEUED_OR_UNKNOWN',
    transactionIds: [],
  });
  const path = `no_backup/agent-command-results/${requestKey}.json`;
  const remoteProgram =
    `if [ -f ${path} ]; then cat ${path}; ` +
    `else printf %s '${fallback}'; fi`;
  const device = serial === undefined ? [] : ['-s', serial];
  const serialized = runAdb(
    input.adb ?? 'adb',
    [...device, 'exec-out', 'run-as', packageName, 'sh', '-c', remoteProgram],
    undefined,
    'ADB_AGENT_STATUS_FAILED',
  );
  return parsedStatusResult(serialized.trim(), requestKey, packageName, serial);
}
