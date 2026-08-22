import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

import {
  getAndroidPendingBillStatus,
  MAX_AGENT_BILL_TEXT_LENGTH,
  openIosSimulatorReview,
  openAndroidReview,
  previewAgentBillAsync,
  queueAndroidPendingBill,
} from '../src/agent';
import { hostBillClassifier } from './HostOnDeviceBillClassifier';

const billInputSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(MAX_AGENT_BILL_TEXT_LENGTH)
    .describe('需要解析的中文账单文字。'),
  referenceDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('解析相对日期所依据的 ISO 8601 时间。'),
  timezoneOffsetMinutes: z
    .number()
    .int()
    .min(-840)
    .max(840)
    .optional()
    .describe('相对 UTC 的时区偏移分钟数，例如中国标准时间为 480。'),
});

export function buildQingjiMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'qingji-local-agent', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions:
        '先用 preview_bill 解析。只有用户要求创建待确认账单时才调用 queue_pending_bill_android，并始终提供稳定 callerId 和新的幂等键。投递后用 get_operation_status_android 查询 requestKey；QUEUED_OR_UNKNOWN 不能表述为成功。任何工具都不会确认交易，不能向用户声称已经正式入账。open_android_review 只打开人工核对页。',
    },
  );

  server.registerTool(
    'preview_bill',
    {
      title: '预览轻记账单',
      description:
        '使用轻记 AI 与 App 相同的本地规则解析账单，只返回候选，不读取或写入账本。',
      inputSchema: billInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async input => {
      const output = await previewAgentBillAsync(input, {}, hostBillClassifier);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    'open_android_review',
    {
      title: '在 Android 打开账单核对页',
      description:
        '通过 ADB ACTION_SEND 把账单文字交给轻记 AI Internal App。此工具只打开核对页，不会确认或写入账本。',
      inputSchema: z.object({
        text: z.string().trim().min(1).max(MAX_AGENT_BILL_TEXT_LENGTH),
        packageName: z.string().optional(),
        serial: z.string().optional(),
        dryRun: z.boolean().default(false),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async input => {
      const output = openAndroidReview(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    'open_ios_simulator_review',
    {
      title: '在 iOS Simulator 打开账单核对页',
      description:
        '通过 xcrun simctl 打开轻记 AI 的核对页，只填入账单文字，不会创建或确认交易。',
      inputSchema: z.object({
        text: z.string().trim().min(1).max(MAX_AGENT_BILL_TEXT_LENGTH),
        device: z.string().optional(),
        dryRun: z.boolean().default(false),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async input => {
      const output = openIosSimulatorReview(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    'queue_pending_bill_android',
    {
      title: '向 Android Internal 创建待确认账单',
      description:
        '通过已授权的 ADB run-as 通道向轻记 AI Internal App 投递幂等命令。App 最多创建 PENDING 记录，绝不自动确认入账。',
      inputSchema: billInputSchema.extend({
        callerId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u),
        idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u),
        packageName: z.string().optional(),
        serial: z.string().optional(),
        dryRun: z.boolean().default(false),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async input => {
      const output = queueAndroidPendingBill(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    'get_operation_status_android',
    {
      title: '查询 Android 待确认账单结果',
      description:
        '按 queue_pending_bill_android 返回的 requestKey 读取最小化结果回执；不访问 SQLite，也不返回账单原文。',
      inputSchema: z.object({
        requestKey: z.string().regex(/^[a-f0-9]{64}$/u),
        packageName: z.string().optional(),
        serial: z.string().optional(),
        dryRun: z.boolean().default(false),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async input => {
      const output = getAndroidPendingBillStatus(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );

  return server;
}

serveStdio(() => buildQingjiMcpServer());
