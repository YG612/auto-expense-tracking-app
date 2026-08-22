import type { TransactionType } from '../domain/entities';
import { sha256 } from '../utils/sha256';
import {
  IMPORTER_SCHEMA_VERSION,
  type NormalizedImportCandidateV1,
  type StatementColumnMapping,
  type StatementField,
  type StatementImportPreview,
  type StatementImportExclusion,
  type StatementImportSource,
  type StatementFundSemantics,
  type StatementSettlementState,
  type StatementTransactionSource,
} from './types';

export const MAX_STATEMENT_TEXT_CHARACTERS = 5_000_000;
export const MAX_STATEMENT_ROWS = 20_000;

const HEADER_ALIASES: Record<StatementField, readonly string[]> = {
  occurredAt: [
    '交易时间',
    '交易创建时间',
    '创建时间',
    '付款时间',
    '支付时间',
    '时间',
    '日期',
    'date',
  ],
  type: ['收/支', '收支', '交易类型', '类型', 'direction', 'type'],
  status: ['当前状态', '交易状态', '订单状态', '状态', 'status'],
  amount: [
    '金额(元)',
    '金额（元）',
    '金额',
    '交易金额',
    '订单金额',
    '实付金额',
    'amount',
  ],
  merchant: [
    '交易对方',
    '对方名称',
    '收款方',
    '商户',
    '商家',
    '商品',
    '商品名称',
    'merchant',
  ],
  account: ['支付方式', '收/付款方式', '付款方式', '账户', 'account'],
  sourceReferenceId: [
    '交易单号',
    '交易号',
    '订单号',
    '商户单号',
    '商家订单号',
    '支付宝交易号',
    '微信支付订单号',
    'id',
  ],
  note: ['备注', '商品', '商品名称', '说明', 'note'],
};

function normalizeHeader(value: string): string {
  return value.trim().replaceAll(/\s+/gu, '').toLocaleLowerCase('zh-CN');
}

function validateStatementContent(content: string): void {
  if (content.length === 0) throw new Error('账单文件为空。');
  if (content.length > MAX_STATEMENT_TEXT_CHARACTERS) {
    throw new Error('账单文件过大，请拆分后导入。');
  }
}

function parseRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ',' || character === '\t') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some(value => value.trim().length > 0)) rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_STATEMENT_ROWS + 200) {
        throw new Error(`账单超过 ${MAX_STATEMENT_ROWS} 行，请拆分后导入。`);
      }
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('CSV 存在未闭合的引号。');
  row.push(field);
  if (row.some(value => value.trim().length > 0)) rows.push(row);
  return rows;
}

function inferSource(
  rows: readonly string[][],
  fileName: string,
): StatementImportSource {
  const sample = rows.slice(0, 30).flat().join('|');
  if (
    /微信支付账单|微信支付明细|微信账单/u.test(sample) ||
    /微信.*账单/iu.test(fileName)
  ) {
    return 'WECHAT';
  }
  if (
    /支付宝交易记录|支付宝账单|支付宝交易明细/u.test(sample) ||
    /支付宝|alipay/iu.test(fileName)
  ) {
    return 'ALIPAY';
  }
  return 'CSV';
}

function findHeaderIndex(
  rows: readonly string[][],
  requestedMapping?: StatementColumnMapping,
): number {
  if (
    requestedMapping?.occurredAt !== undefined &&
    requestedMapping.amount !== undefined
  ) {
    const requestedDate = normalizeHeader(requestedMapping.occurredAt);
    const requestedAmount = normalizeHeader(requestedMapping.amount);
    const mappedIndex = rows.findIndex(row => {
      const normalized = row.map(normalizeHeader);
      return (
        normalized.includes(requestedDate) &&
        normalized.includes(requestedAmount)
      );
    });
    if (mappedIndex >= 0) return mappedIndex;
  }
  const amountAliases = new Set(HEADER_ALIASES.amount.map(normalizeHeader));
  const dateAliases = new Set(HEADER_ALIASES.occurredAt.map(normalizeHeader));
  const index = rows.findIndex(row => {
    const normalized = row.map(normalizeHeader);
    return (
      normalized.some(value => amountAliases.has(value)) &&
      normalized.some(value => dateAliases.has(value))
    );
  });
  if (index < 0) throw new Error('找不到同时包含日期和金额的表头。');
  return index;
}

function inferMapping(headers: readonly string[]): StatementColumnMapping {
  const normalizedHeaders = headers.map(normalizeHeader);
  const mapping: StatementColumnMapping = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [StatementField, readonly string[]]
  >) {
    const headerIndex = aliases
      .map(normalizeHeader)
      .map(alias => normalizedHeaders.indexOf(alias))
      .find(index => index >= 0);
    if (headerIndex !== undefined) mapping[field] = headers[headerIndex];
  }
  return mapping;
}

export function inspectStatementHeaders(content: string): readonly string[] {
  const normalizedContent = content.replace(/^\uFEFF/u, '');
  validateStatementContent(normalizedContent);
  const rows = parseRows(normalizedContent);
  try {
    return rows[findHeaderIndex(rows)]!.map(value => value.trim());
  } catch {
    const candidate = rows
      .slice(0, 200)
      .map(row => row.map(value => value.trim()))
      .filter(row => row.filter(Boolean).length >= 2)
      .sort(
        (left, right) =>
          right.filter(Boolean).length - left.filter(Boolean).length,
      )[0];
    if (candidate === undefined) throw new Error('找不到可映射的表头。');
    return candidate;
  }
}

function valueFor(
  row: readonly string[],
  headers: readonly string[],
  mapping: StatementColumnMapping,
  field: StatementField,
): string | undefined {
  const header = mapping[field];
  if (header === undefined) return undefined;
  const index = headers.indexOf(header);
  const value = index < 0 ? undefined : row[index]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function parseAmountMinor(raw: string | undefined): number {
  if (raw === undefined) throw new Error('缺少金额');
  const normalized = raw
    .replaceAll(/[¥￥,，\s]/gu, '')
    .replace(/^\((.*)\)$/u, '-$1');
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/u.test(normalized)) {
    throw new Error('金额格式无效');
  }
  const negative = normalized.startsWith('-');
  const unsigned = normalized.replace(/^[+-]/u, '');
  const [yuan, fraction = ''] = unsigned.split('.');
  const amount = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('金额必须大于 0');
  }
  return negative ? -amount : amount;
}

function parseOccurredAt(raw: string | undefined): string {
  if (raw === undefined) throw new Error('缺少交易时间');
  if (/^\d+(?:\.\d+)?$/u.test(raw)) {
    const serial = Number(raw);
    if (serial >= 1 && serial <= 2_958_465) {
      const timestamp = Date.UTC(1899, 11, 30) + serial * 86_400_000;
      return new Date(timestamp).toISOString();
    }
  }
  const normalized = raw
    .replaceAll('/', '-')
    .replace(/年|月/gu, '-')
    .replace(/日/gu, '')
    .trim();
  const timestamp = Date.parse(normalized);
  if (Number.isNaN(timestamp)) throw new Error('交易时间格式无效');
  return new Date(timestamp).toISOString();
}

function parseType(
  raw: string | undefined,
  signedAmount: number,
  context: string,
): TransactionType {
  const normalized = raw?.trim() ?? '';
  if (/手续费|服务费/u.test(context)) return 'EXPENSE';
  if (/退款|退回/u.test(normalized)) return 'REFUND';
  if (/转账|转入|转出|账户划转|资金划转/u.test(normalized)) {
    return 'TRANSFER';
  }
  if (/收入|收款|入账/u.test(normalized)) return 'INCOME';
  if (/支出|付款|消费/u.test(normalized)) return 'EXPENSE';
  return signedAmount < 0 ? 'EXPENSE' : 'INCOME';
}

function settlementFor(
  raw: string | undefined,
  type: TransactionType,
  sourceRow: number,
):
  | { state: StatementSettlementState; warning?: string }
  | { exclusion: StatementImportExclusion } {
  const status = raw?.trim();
  if (status === undefined || status.length === 0) {
    return {
      state: 'UNKNOWN',
      warning: '账单未提供交易状态，必须人工确认是否已经完成',
    };
  }
  if (/失败|未成功|被拒|未支付|支付异常/u.test(status)) {
    return {
      exclusion: {
        sourceRow,
        code: 'SETTLEMENT_FAILED',
        message: '交易失败或未支付，不导入账本',
        rawStatus: status,
      },
    };
  }
  if (/已取消|已撤销|已关闭|交易关闭|订单关闭|已作废/u.test(status)) {
    return {
      exclusion: {
        sourceRow,
        code: 'SETTLEMENT_CANCELLED',
        message: '交易已经取消、关闭或撤销，不导入账本',
        rawStatus: status,
      },
    };
  }
  if (/处理中|进行中|等待|待支付|待确认|退款中/u.test(status)) {
    return {
      exclusion: {
        sourceRow,
        code: 'SETTLEMENT_PENDING',
        message: '交易尚未结算，暂不导入账本',
        rawStatus: status,
      },
    };
  }
  if (
    type !== 'REFUND' &&
    /已全额退款|全额退款成功|已退款|退款完成/u.test(status)
  ) {
    return {
      exclusion: {
        sourceRow,
        code: 'ORIGINAL_TRANSACTION_REFUNDED',
        message: '原交易已经退款，需导入独立退款流水而不是重复计入支出',
        rawStatus: status,
      },
    };
  }
  if (/成功|已完成|交易完成|已到账|已入账|退款完成|退款成功/u.test(status)) {
    return { state: 'COMPLETED' };
  }
  return {
    state: 'UNKNOWN',
    warning: `未识别交易状态“${status.slice(0, 40)}”，必须人工确认`,
  };
}

function fundSemanticsFor(
  type: TransactionType,
  context: string,
): StatementFundSemantics {
  if (/手续费|服务费/u.test(context)) return 'FEE';
  if (type === 'REFUND') return 'REFUND';
  if (type === 'TRANSFER') return 'TRANSFER';
  if (type === 'INCOME') return 'INCOME';
  if (type === 'EXPENSE') return 'PURCHASE';
  return 'UNKNOWN';
}

function transactionSourceFor(
  source: StatementImportSource,
): StatementTransactionSource {
  if (source === 'WECHAT') return 'WECHAT_IMPORT';
  if (source === 'ALIPAY') return 'ALIPAY_IMPORT';
  return 'CSV_IMPORT';
}

function trimmed(value: string | undefined, max: number): string | undefined {
  const result = value?.trim();
  return result === undefined || result.length === 0
    ? undefined
    : result.slice(0, max);
}

export function statementFingerprint(input: {
  occurredAt: string;
  type: TransactionType;
  amountMinor: number;
  merchantRawName?: string;
  accountHint?: string;
}): string {
  const minute = input.occurredAt.slice(0, 16);
  const merchant = (input.merchantRawName ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replaceAll(/[\s\p{P}\p{S}]/gu, '');
  const account = (input.accountHint ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replaceAll(/\s+/gu, '');
  return sha256(
    [minute, input.type, input.amountMinor, merchant, account].join('|'),
  );
}

export function parseStatementCsv(input: {
  content: string;
  fileName: string;
  mapping?: StatementColumnMapping;
}): StatementImportPreview {
  const content = input.content.replace(/^\uFEFF/u, '');
  validateStatementContent(content);
  const rows = parseRows(content);
  const source = inferSource(rows, input.fileName);
  const headerIndex = findHeaderIndex(rows, input.mapping);
  const headers = rows[headerIndex]!.map(value => value.trim());
  const mapping = { ...inferMapping(headers), ...input.mapping };
  if (mapping.occurredAt === undefined || mapping.amount === undefined) {
    throw new Error('请至少映射交易时间和金额。');
  }

  const candidates: NormalizedImportCandidateV1[] = [];
  const exclusions: StatementImportExclusion[] = [];
  const failures: { sourceRow: number; message: string }[] = [];
  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    const sourceRow = headerIndex + offset + 2;
    try {
      const signedAmount = parseAmountMinor(
        valueFor(row, headers, mapping, 'amount'),
      );
      const occurredAt = parseOccurredAt(
        valueFor(row, headers, mapping, 'occurredAt'),
      );
      const merchantRawName = trimmed(
        valueFor(row, headers, mapping, 'merchant'),
        256,
      );
      const accountHint = trimmed(
        valueFor(row, headers, mapping, 'account'),
        128,
      );
      const note = trimmed(valueFor(row, headers, mapping, 'note'), 2_000);
      const typeRaw = valueFor(row, headers, mapping, 'type');
      const semanticContext = [typeRaw, merchantRawName, note]
        .filter((value): value is string => value !== undefined)
        .join(' ');
      const type = parseType(typeRaw, signedAmount, semanticContext);
      const settlement = settlementFor(
        valueFor(row, headers, mapping, 'status'),
        type,
        sourceRow,
      );
      if ('exclusion' in settlement) {
        exclusions.push(settlement.exclusion);
        continue;
      }
      const semanticWarnings = [
        ...(settlement.warning === undefined ? [] : [settlement.warning]),
        ...(type === 'TRANSFER'
          ? ['转账的来源、去向和账户关系必须人工确认']
          : []),
        ...(type === 'REFUND' ? ['退款应关联原支出后再确认'] : []),
      ];
      const candidate = {
        schemaVersion: IMPORTER_SCHEMA_VERSION,
        source,
        transactionSource: transactionSourceFor(source),
        sourceRow,
        sourceReferenceId: trimmed(
          valueFor(row, headers, mapping, 'sourceReferenceId'),
          512,
        ),
        occurredAt,
        type,
        settlementState: settlement.state,
        fundSemantics: fundSemanticsFor(type, semanticContext),
        semanticWarnings,
        amountMinor: Math.abs(signedAmount),
        currency: 'CNY' as const,
        merchantRawName,
        accountHint,
        note,
      };
      candidates.push({
        ...candidate,
        fingerprint: statementFingerprint(candidate),
      });
    } catch (error) {
      failures.push({
        sourceRow,
        message: error instanceof Error ? error.message : '无法解析此行',
      });
    }
  }
  if (
    candidates.length === 0 &&
    exclusions.length === 0 &&
    failures.length === 0
  ) {
    throw new Error('表头之后没有可导入的交易。');
  }
  return {
    schemaVersion: IMPORTER_SCHEMA_VERSION,
    source,
    fileName: input.fileName.slice(0, 255),
    rawContentHash: sha256(content),
    headers,
    mapping,
    candidates,
    exclusions,
    failures,
  };
}
