import type { TransactionSource, TransactionType } from '../domain/entities';
import type { PaymentNotificationSnapshot } from '../native/PaymentNotificationCapture';
import { sha256 } from '../utils/sha256';

const PAYMENT_CUE =
  /支付成功|成功支付|付款成功|成功付款|已付款|消费成功|扣款成功|扣款通知|微信支付凭证|收款到账|收款成功|收钱到账|二维码收款|到账通知|退款成功|退款到账|退款已到账|转账成功/u;
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
  const preferredPatterns = [
    /(?:实付|付款金额|支付金额|消费金额|扣款金额|收款金额|退款金额|到账金额)\s*[:：]?\s*(?:人民币\s*)?[¥￥]?\s*((?:\d{1,3}(?:,\d{3})+|\d{1,9})(?:\.\d{1,2})?)\s*元?/gu,
    /(?:支付成功|成功支付|付款成功|成功付款|已付款|消费成功|扣款成功|收款到账|收款成功|收钱到账|二维码收款|退款成功|退款到账|退款已到账|转账成功)[^\d¥￥]{0,20}(?:人民币\s*)?[¥￥]?\s*((?:\d{1,3}(?:,\d{3})+|\d{1,9})(?:\.\d{1,2})?)\s*元/gu,
    /(?:人民币\s*)?[¥￥]\s*((?:\d{1,3}(?:,\d{3})+|\d{1,9})(?:\.\d{1,2})?)/gu,
    /((?:\d{1,3}(?:,\d{3})+|\d{1,9})(?:\.\d{1,2})?)\s*元[^\n，。；;]{0,20}(?:支付成功|成功支付|付款成功|成功付款|已付款|消费成功|扣款成功|收款到账|收款成功|收钱到账|二维码收款|退款成功|退款到账|退款已到账|转账成功)/gu,
  ];
  const preferred = preferredPatterns
    .flatMap(pattern => [...text.matchAll(pattern)])
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  const matches =
    preferred.length > 0
      ? preferred
      : [
          ...text.matchAll(
            /(?:[¥￥]\s*|人民币\s*)?((?:\d{1,3}(?:,\d{3})+|\d{1,9})(?:\.\d{1,2})?)\s*元/gu,
          ),
        ];
  if (matches.length === 0) return undefined;
  const cueIndex = text.search(PAYMENT_CUE);
  matches.sort(
    (left, right) =>
      Math.abs((left.index ?? 0) - cueIndex) -
      Math.abs((right.index ?? 0) - cueIndex),
  );
  const [yuan, fraction = ''] = matches[0]![1]!.replaceAll(',', '').split('.');
  const value = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function transactionType(text: string): TransactionType {
  if (/退款成功|退款到账|退款已到账/u.test(text)) return 'REFUND';
  if (/收款到账|收款成功|收钱到账|二维码收款|收到款/u.test(text))
    return 'INCOME';
  if (/转账成功|转账给|向.+转账/u.test(text)) return 'TRANSFER';
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
