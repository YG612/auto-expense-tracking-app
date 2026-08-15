import { spawnSync } from 'node:child_process';

import { AGENT_COMMAND_SCHEMA_VERSION } from './AgentCommandService';
import { MAX_AGENT_BILL_TEXT_LENGTH } from './AndroidReviewBridge';

export type IosReviewInput = {
  text: string;
  device?: string;
  xcrun?: string;
  dryRun?: boolean;
};

export type IosReviewResult = {
  schemaVersion: typeof AGENT_COMMAND_SCHEMA_VERSION;
  command: 'bill.open-ios-simulator';
  status: 'DRY_RUN' | 'OPENED_FOR_REVIEW';
  device: string;
  textLength: number;
  safety: string;
};

export class IosReviewBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IosReviewBridgeError';
  }
}

function safeText(value: string): string {
  const text = value.trim();
  if (text.length === 0 || [...text].length > MAX_AGENT_BILL_TEXT_LENGTH) {
    throw new IosReviewBridgeError(
      'INVALID_BILL_TEXT',
      `账单文字必须是 1 到 ${MAX_AGENT_BILL_TEXT_LENGTH} 个 Unicode 字符。`,
    );
  }
  return text;
}

function safeDevice(value: string | undefined): string {
  const device = value?.trim() || 'booted';
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(device)) {
    throw new IosReviewBridgeError(
      'INVALID_IOS_SIMULATOR_DEVICE',
      'iOS Simulator 设备标识格式无效。',
    );
  }
  return device;
}

/** Opens the existing qingjiai URL in an iOS Simulator without invoking a shell. */
export function openIosSimulatorReview(input: IosReviewInput): IosReviewResult {
  const text = safeText(input.text);
  const device = safeDevice(input.device);
  const baseResult: Omit<IosReviewResult, 'status' | 'safety'> = {
    schemaVersion: AGENT_COMMAND_SCHEMA_VERSION,
    command: 'bill.open-ios-simulator' as const,
    device,
    textLength: [...text].length,
  };
  if (input.dryRun === true) {
    return {
      ...baseResult,
      status: 'DRY_RUN',
      safety: '只验证参数；不会启动 Simulator 或写入账本。',
    };
  }

  const url = new URL('qingjiai://entry/smart');
  url.searchParams.set('text', text);
  url.searchParams.set('source', 'agent');
  const result = spawnSync(
    input.xcrun ?? 'xcrun',
    ['simctl', 'openurl', device, url.toString()],
    {
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (result.error !== undefined) {
    throw new IosReviewBridgeError(
      'IOS_SIMULATOR_OPEN_FAILED',
      `无法启动 xcrun：${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new IosReviewBridgeError(
      'IOS_SIMULATOR_OPEN_FAILED',
      result.stderr.trim().slice(0, 2_000) ||
        `xcrun 退出码为 ${String(result.status)}。`,
    );
  }
  return {
    ...baseResult,
    status: 'OPENED_FOR_REVIEW',
    safety: '账单文字已打开到 iOS Simulator 核对页；仍需用户确认。',
  };
}
