import { NativeModules } from 'react-native';

import type { AgentPendingBillInput } from '../agent/AgentCommandService';
import { MAX_BOOKKEEPING_TEXT_CHARACTERS } from '../domain/policies/bookkeepingInputPolicy';

export type AgentCommandSnapshot = AgentPendingBillInput & { key: string };

type NativeAgentCommandInbox = {
  listPending(): Promise<unknown>;
  clear(): Promise<void>;
  complete(
    key: string,
    status: AgentCommandCompletionStatus,
    transactionIds: string[],
    completedAt: string,
    errorCode: string | null,
  ): Promise<void>;
};

export type AgentCommandCompletionStatus =
  'COMMITTED' | 'ALREADY_COMMITTED' | 'CONSUMED_DELETED' | 'REJECTED';

export type AgentCommandCompletion = {
  key: string;
  status: AgentCommandCompletionStatus;
  transactionIds: readonly string[];
  completedAt: string;
  errorCode?: string;
};

function nativeModule(): NativeAgentCommandInbox | undefined {
  return NativeModules.AgentCommandInbox as NativeAgentCommandInbox | undefined;
}

function snapshot(value: unknown): AgentCommandSnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const item = value as Partial<AgentCommandSnapshot>;
  if (
    typeof item.key !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(item.key) ||
    typeof item.callerId !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(item.callerId) ||
    typeof item.idempotencyKey !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(item.idempotencyKey) ||
    typeof item.text !== 'string' ||
    item.text.length === 0 ||
    [...item.text].length > MAX_BOOKKEEPING_TEXT_CHARACTERS ||
    (item.referenceDate !== undefined &&
      (typeof item.referenceDate !== 'string' ||
        Number.isNaN(new Date(item.referenceDate).getTime()))) ||
    (item.timezoneOffsetMinutes !== undefined &&
      (!Number.isSafeInteger(item.timezoneOffsetMinutes) ||
        item.timezoneOffsetMinutes < -840 ||
        item.timezoneOffsetMinutes > 840))
  ) {
    return undefined;
  }
  return item as AgentCommandSnapshot;
}

export async function listPendingAgentCommands(): Promise<
  AgentCommandSnapshot[]
> {
  const module = nativeModule();
  if (module === undefined) return [];
  const values = await module.listPending();
  if (!Array.isArray(values)) throw new Error('代理命令数据格式无效。');
  return values
    .map(snapshot)
    .filter((item): item is AgentCommandSnapshot => item !== undefined);
}

export async function completeAgentCommand(
  completion: AgentCommandCompletion,
): Promise<void> {
  const module = nativeModule();
  if (module === undefined) return;
  if (
    !/^[a-f0-9]{64}$/u.test(completion.key) ||
    completion.transactionIds.length > 20 ||
    completion.transactionIds.some(id => id.length === 0 || id.length > 128) ||
    Number.isNaN(new Date(completion.completedAt).getTime()) ||
    (completion.errorCode !== undefined &&
      !/^[A-Z0-9._:-]{1,128}$/u.test(completion.errorCode))
  ) {
    throw new Error('代理命令完成回执无效。');
  }
  await module.complete(
    completion.key,
    completion.status,
    [...new Set(completion.transactionIds)],
    completion.completedAt,
    completion.errorCode ?? null,
  );
}

export async function clearAgentCommandInbox(): Promise<void> {
  await nativeModule()?.clear();
}
