import type { TransactionType } from '../domain/entities';
import type { PaymentNotificationSnapshot } from '../native/PaymentNotificationCapture';
import { sha256 } from '../utils/sha256';
import { statementFingerprint } from './statementCsv';
import {
  IMPORTER_SCHEMA_VERSION,
  type NormalizedImportCandidateV1,
  type StatementImportPreview,
  type StatementImportSource,
  type StatementTransactionSource,
} from './types';

const PAYMENT_CUE =
  /支付成功|付款成功|已付款|消费成功|扣款成功|收款到账|收款成功|退款成功/u;
const GENERIC_TITLES = /^(微信|微信支付|支付宝|支付通知|服务通知|交易提醒)$/u;

function sourceForPackage(
  packageName: PaymentNotificationSnapshot['packageName'],
): {
  source: StatementImportSource;
  transactionSource: StatementTransactionSource;
} {
  return packageName === 'com.tencent.mm'
    ? { source: 'WECHAT', transactionSource: 'WECHAT_IMPORT' }
    : { source: 'ALIPAY', transactionSource: 'ALIPAY_IMPORT' };
}

function amountMinor(text: string): number | undefined {
  const matches = [
    ...text.matchAll(/(?:[¥￥]\s*|人民币\s*)?(\d{1,9}(?:\.\d{1,2})?)\s*元?/gu),
  ].filter(match => /[¥￥元]/u.test(match[0] ?? ''));
  if (matches.length === 0) return undefined;
  const cueIndex = text.search(PAYMENT_CUE);
  const ranked = matches.sort(
    (left, right) =>
      Math.abs((left.index ?? 0) - cueIndex) -
      Math.abs((right.index ?? 0) - cueIndex),
  );
  const [yuan, fraction = ''] = ranked[0]![1]!.split('.');
  const value = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function transactionType(text: string): TransactionType {
  if (/退款成功|退款到账/u.test(text)) return 'REFUND';
  if (/收款到账|收款成功|收到款/u.test(text)) return 'INCOME';
  return 'EXPENSE';
}

function merchantName(title: string, text: string): string | undefined {
  const patterns = [
    /(?:在|向|付款给|收款方[:：]?|商户[:：]?)([^\n，。；;]{2,64}?)(?:支付|付款|消费|收款|成功|[¥￥]|\d+(?:\.\d{1,2})?\s*元)/u,
    /([^\n，。；;]{2,64}?)(?:收款成功|已收款)/u,
  ];
  for (const pattern of patterns) {
    const value = pattern.exec(text)?.[1]?.trim();
    if (value !== undefined && !GENERIC_TITLES.test(value)) return value;
  }
  const normalizedTitle = title.trim();
  return normalizedTitle.length >= 2 &&
    normalizedTitle.length <= 64 &&
    !GENERIC_TITLES.test(normalizedTitle)
    ? normalizedTitle
    : undefined;
}

function candidateFor(
  notification: PaymentNotificationSnapshot,
  sourceRow: number,
): NormalizedImportCandidateV1 | undefined {
  const combined = `${notification.title}\n${notification.text}`.trim();
  if (!PAYMENT_CUE.test(combined)) return undefined;
  const amount = amountMinor(combined);
  if (amount === undefined) return undefined;
  const source = sourceForPackage(notification.packageName);
  const occurredAt = new Date(notification.postedAt).toISOString();
  const type = transactionType(combined);
  const merchantRawName = merchantName(notification.title, notification.text);
  const normalized = {
    schemaVersion: IMPORTER_SCHEMA_VERSION,
    ...source,
    sourceRow,
    sourceReferenceId: `notification:${sha256(
      `${notification.packageName}|${notification.key}|${notification.postedAt}`,
    ).slice(0, 48)}`,
    occurredAt,
    type,
    amountMinor: amount,
    currency: 'CNY' as const,
    merchantRawName,
    note: '来自 Android 支付通知，请核对商户、金额和分类',
  };
  return { ...normalized, fingerprint: statementFingerprint(normalized) };
}

export function parsePaymentNotifications(
  notifications: readonly PaymentNotificationSnapshot[],
): StatementImportPreview[] {
  const grouped = new Map<
    StatementImportSource,
    NormalizedImportCandidateV1[]
  >();
  notifications.forEach((notification, index) => {
    const candidate = candidateFor(notification, index + 1);
    if (candidate === undefined) return;
    const current = grouped.get(candidate.source) ?? [];
    current.push(candidate);
    grouped.set(candidate.source, current);
  });

  return [...grouped.entries()].map(([source, candidates]) => ({
    schemaVersion: IMPORTER_SCHEMA_VERSION,
    source,
    fileName: `${source === 'WECHAT' ? '微信' : '支付宝'}支付通知`,
    rawContentHash: sha256(
      candidates.map(candidate => candidate.sourceReferenceId).join('|'),
    ),
    headers: [],
    mapping: {},
    candidates,
    failures: [],
  }));
}
