const ACCOUNT_PATTERN = /微信支付|微信|支付宝|信用卡|银行卡|储蓄卡|花呗|现金/gu;
const DATE_PATTERN =
  /(?:20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|今天|今日|昨天|昨晚|前天|明天|周[一二三四五六日天])/gu;
const AMOUNT_PATTERN =
  /(?:人民币|¥|￥)?\s*\d+(?:[,.]\d{1,2})?\s*(?:元|块钱?|块)?/gu;
const ORDER_PATTERN = /(?:订单|流水|交易|商户)号?[:：]?\s*[A-Za-z0-9-]{6,}/gu;

/**
 * Privacy-minimizing preprocessing shared by every native implementation.
 * It deliberately keeps negation and transaction-risk words intact.
 */
export function preprocessBillClassifierText(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(ORDER_PATTERN, ' <ORDER> ')
    .replace(DATE_PATTERN, ' <DATE> ')
    .replace(ACCOUNT_PATTERN, ' <ACCOUNT> ')
    .replace(AMOUNT_PATTERN, ' <AMOUNT> ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500);
}
