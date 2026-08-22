import { spawnSync } from 'node:child_process';

import { MAX_BOOKKEEPING_TEXT_CHARACTERS } from '../domain/policies/bookkeepingInputPolicy';
import { AGENT_COMMAND_SCHEMA_VERSION } from './AgentCommandService';

export const DEFAULT_ANDROID_AGENT_PACKAGE = 'com.qingjiai.internal';
export const MAX_AGENT_BILL_TEXT_LENGTH = MAX_BOOKKEEPING_TEXT_CHARACTERS;

export type AndroidReviewInput = {
  text: string;
  packageName?: string;
  serial?: string;
  adb?: string;
  dryRun?: boolean;
};

export type AndroidReviewResult = {
  schemaVersion: typeof AGENT_COMMAND_SCHEMA_VERSION;
  command: 'bill.open-android';
  status: 'DRY_RUN' | 'OPENED_FOR_REVIEW';
  packageName: string;
  serial?: string;
  textLength: number;
  adbOutput?: string;
  safety: string;
};

export class AndroidReviewBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AndroidReviewBridgeError';
  }
}

function boundedOutput(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized.slice(0, 4_000);
}

function validatedText(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new AndroidReviewBridgeError('EMPTY_TEXT', '请提供账单文字。');
  }
  if ([...normalized].length > MAX_AGENT_BILL_TEXT_LENGTH) {
    throw new AndroidReviewBridgeError(
      'TEXT_TOO_LONG',
      `账单文字不能超过 ${MAX_AGENT_BILL_TEXT_LENGTH} 个 Unicode 字符。`,
    );
  }
  return normalized;
}

function validatedPackage(value: string | undefined): string {
  const packageName = value ?? DEFAULT_ANDROID_AGENT_PACKAGE;
  if (!/^[A-Za-z][A-Za-z0-9_.]{2,127}$/u.test(packageName)) {
    throw new AndroidReviewBridgeError(
      'INVALID_ANDROID_PACKAGE',
      'Android 包名格式无效。',
    );
  }
  return packageName;
}

function validatedSerial(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) {
    throw new AndroidReviewBridgeError(
      'INVALID_ADB_SERIAL',
      'ADB 设备序列号格式无效。',
    );
  }
  return value;
}

/**
 * Opens the existing ACTION_SEND review flow. Arguments are passed directly to
 * adb without a shell, so bill text is never interpreted as a shell command.
 */
export function openAndroidReview(
  input: AndroidReviewInput,
): AndroidReviewResult {
  const text = validatedText(input.text);
  const packageName = validatedPackage(input.packageName);
  const serial = validatedSerial(input.serial);
  const adb = input.adb ?? 'adb';
  const adbArguments = [
    ...(serial === undefined ? [] : ['-s', serial]),
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.SEND',
    '-t',
    'text/plain',
    '--es',
    'android.intent.extra.TEXT',
    text,
    '-p',
    packageName,
  ];

  if (input.dryRun === true) {
    return {
      schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
      command: 'bill.open-android',
      status: 'DRY_RUN',
      packageName,
      ...(serial === undefined ? {} : { serial }),
      textLength: [...text].length,
      safety: '只会打开轻记 AI 核对页，不会自动确认入账。',
    };
  }

  const result = spawnSync(adb, adbArguments, {
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw new AndroidReviewBridgeError(
      'ADB_START_FAILED',
      `无法启动 ADB：${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new AndroidReviewBridgeError(
      'ADB_COMMAND_FAILED',
      boundedOutput(result.stderr) ?? `ADB 退出码为 ${String(result.status)}。`,
    );
  }

  const adbOutput = boundedOutput(result.stdout);
  return {
    schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
    command: 'bill.open-android',
    status: 'OPENED_FOR_REVIEW',
    packageName,
    ...(serial === undefined ? {} : { serial }),
    textLength: [...text].length,
    ...(adbOutput === undefined ? {} : { adbOutput }),
    safety: '账单文字已交给 App；仍需用户在 App 内核对并确认。',
  };
}
