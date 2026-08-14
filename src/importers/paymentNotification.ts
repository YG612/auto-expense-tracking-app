import type { TransactionSource, TransactionType } from '../domain/entities';
import type { PaymentNotificationSnapshot } from '../native/PaymentNotificationCapture';
import { sha256 } from '../utils/sha256';

const PAYMENT_CUE =
  /支付成功|付款成功|已付款|消费成功|扣款成功|收款到账|收款成功|退款成功/u;
const GENERIC_TITLES = /^(微信|微信支付|支付宝|支付通知|服务通知|交易提醒)$/u;

export type ParsedPaymentNotification = {
  notificationKey: string;
  sourceReferenceId: string;
  transactionSource: Extract<
    TransactionSource,
    'WECHAT_IMPORT' | 'ALIPAY_IMPORT'
  >;
  occurredAt: string;
  type: TransactionType;
  amountMinor: number;
  merchantRawName?: string;
  originalText: string;
};

function amountMinor(text: string): number | undefined {
  const matches = [
    ...text.matchAll(/(?:[¥￥]\s*|人民币\s*)?(\d{1,9}(?:\.\d{1,2})?)\s*元?/gu),
  ].filter(match => /[¥￥元]/u.test(match[0] ?? ''));
  if (matches.length === 0) return undefined;
  const cueIndex = text.search(PAYMENT_CUE);
  matches.sort(
    (left, right) =>
      Math.abs((left.index ?? 0) - cueIndex) -
      Math.abs((right.index ?? 0) - cueIndex),
  );
  const [yuan, fraction = ''] = matches[0]![1]!.split('.');
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

export function parsePaymentNotifications(
  notifications: readonly PaymentNotificationSnapshot[],
): ParsedPaymentNotification[] {
  return notifications.flatMap(notification => {
    const originalText = `${notification.title}\n${notification.text}`.trim();
    if (!PAYMENT_CUE.test(originalText)) return [];
    const amount = amountMinor(originalText);
    if (amount === undefined) return [];
    const transactionSource =
      notification.packageName === 'com.tencent.mm'
        ? 'WECHAT_IMPORT'
        : 'ALIPAY_IMPORT';
    return [
      {
        notificationKey: notification.key,
        sourceReferenceId: `notification:${sha256(
          `${notification.packageName}|${notification.key}|${notification.postedAt}`,
        ).slice(0, 48)}`,
        transactionSource,
        occurredAt: new Date(notification.postedAt).toISOString(),
        type: transactionType(originalText),
        amountMinor: amount,
        merchantRawName: merchantName(notification.title, notification.text),
        originalText,
      },
    ];
  });
}
