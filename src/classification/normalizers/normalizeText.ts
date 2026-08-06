const PUNCTUATION_TO_COMMA = /[，、；;！？!?]+/gu;

/**
 * Normalizes only surface variations. Semantic interpretation stays in later
 * pipeline stages so that the original wording remains available for review.
 */
export function normalizeChineseTransactionText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/(?:v\s*信|vx|weixin)/giu, '微信')
    .replace(/(?:zfb|alipay)/giu, '支付宝')
    .replace(/人民币/gu, '元')
    .replace(/圆/gu, '元')
    .replace(PUNCTUATION_TO_COMMA, ',')
    .replace(/[。]+/gu, '.')
    .replace(/\s*,\s*/gu, ',')
    .replace(/[ \t\r\n]+/gu, ' ')
    .replace(/,+/gu, ',')
    .replace(/^\s+|\s+$/gu, '')
    .replace(/^[,.]+|[,.]+$/gu, '');
}
