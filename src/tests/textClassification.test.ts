import {
  confidenceLevelFor,
  normalizeChineseTransactionText,
  parseAmount,
  parseDateTime,
  parseTextTransactions,
} from '../classification/parseTextTransactions';

const referenceDate = new Date('2026-08-04T07:20:00.000Z');
const context = {
  referenceDate,
  timezoneOffsetMinutes: 480,
} as const;

function parseOne(text: string) {
  const result = parseTextTransactions(text, context);
  expect(result.candidates).toHaveLength(1);
  const candidate = result.candidates[0];
  if (candidate === undefined) {
    throw new Error('Expected one candidate.');
  }
  return candidate;
}

function localParts(iso: string | undefined) {
  if (iso === undefined) {
    return undefined;
  }
  const shifted = new Date(new Date(iso).getTime() + 480 * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

describe('stage 5 local text classification', () => {
  it('normalizes full-width input, punctuation and payment aliases', () => {
    expect(normalizeChineseTransactionText('午饭２５元；v信付的！')).toBe(
      '午饭25元,微信付的',
    );
    expect(normalizeChineseTransactionText('酒店４２０，ZFB')).toBe(
      '酒店420,支付宝',
    );
  });

  it('parses Arabic, colloquial and Chinese amounts into integer cents', () => {
    expect(parseAmount('早餐12块5').amountMinor).toBe(1250);
    expect(parseAmount('咖啡12.05元').amountMinor).toBe(1205);
    expect(parseAmount('二十八块五').amountMinor).toBe(2850);
    expect(parseAmount('十二块零五').amountMinor).toBe(1205);
    const colloquial = parseAmount('两百三');
    expect(colloquial.amountMinor).toBe(23000);
    expect(colloquial.ambiguityReasons).toContainEqual(
      expect.stringContaining('口语金额'),
    );
    expect(parseAmount('2026年8月4日 12:30').amountMinor).toBeUndefined();
  });

  it('parses relative dates deterministically in an injected time zone', () => {
    expect(
      localParts(parseDateTime('今天早上', referenceDate, 480).occurredAt),
    ).toEqual({
      year: 2026,
      month: 8,
      day: 4,
      hour: 8,
      minute: 0,
    });
    expect(
      localParts(parseDateTime('昨天晚上', referenceDate, 480).occurredAt),
    ).toEqual({
      year: 2026,
      month: 8,
      day: 3,
      hour: 19,
      minute: 0,
    });
    expect(
      localParts(parseDateTime('上周五', referenceDate, 480).occurredAt),
    ).toMatchObject({
      year: 2026,
      month: 7,
      day: 31,
    });
  });

  it('passes acceptance test 1: lunch paid by WeChat', () => {
    const candidate = parseOne('午饭花了25元，微信付的。');
    expect(candidate).toMatchObject({
      type: 'EXPENSE',
      amountMinor: 2500,
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.lunch',
      accountKey: 'WECHAT',
      confidenceLevel: 'HIGH',
    });
    expect(candidate.confidence).toBeGreaterThanOrEqual(0.9);
    expect(localParts(candidate.occurredAt)).toMatchObject({
      year: 2026,
      month: 8,
      day: 4,
    });
  });

  it('passes acceptance test 2: breakfast with shorthand decimal', () => {
    const candidate = parseOne('今天早上买早餐12块5。');
    expect(candidate).toMatchObject({
      type: 'EXPENSE',
      amountMinor: 1250,
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.breakfast',
    });
    expect(localParts(candidate.occurredAt)).toMatchObject({ day: 4, hour: 8 });
  });

  it('passes acceptance test 3: hotel yesterday evening on Alipay', () => {
    const candidate = parseOne('昨天晚上住酒店花了420，支付宝。');
    expect(candidate).toMatchObject({
      type: 'EXPENSE',
      amountMinor: 42000,
      categoryKey: 'expense.travel',
      subcategoryKey: 'expense.travel.hotel',
      accountKey: 'ALIPAY',
    });
    expect(localParts(candidate.occurredAt)).toMatchObject({
      day: 3,
      hour: 19,
    });
  });

  it('keeps travel as project context instead of overriding the real category', () => {
    const train = parseOne('上海旅行坐高铁553元。');
    expect(train).toMatchObject({
      type: 'EXPENSE',
      amountMinor: 55300,
      categoryKey: 'expense.transport',
      subcategoryKey: 'expense.transport.train',
      projectName: '上海旅行',
    });
    expect(train.subcategoryKey).not.toBe('expense.travel.hotel');

    const lunch = parseOne('上海旅游中午吃饭80元。');
    expect(lunch).toMatchObject({
      amountMinor: 8000,
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.lunch',
      projectName: '上海旅游',
      tags: ['旅行'],
    });
  });

  it('prioritizes transfer, repayment, refund and reimbursement types', () => {
    expect(parseOne('从微信转500到银行卡。')).toMatchObject({
      type: 'TRANSFER',
      amountMinor: 50000,
      accountKey: 'WECHAT',
      targetAccountKey: 'BANK_CARD',
    });
    expect(parseOne('信用卡还款2000元。')).toMatchObject({
      type: 'REPAYMENT_OUT',
      amountMinor: 200000,
      accountKey: 'CREDIT_CARD',
    });
    expect(parseOne('淘宝退款89元到账。')).toMatchObject({
      type: 'REFUND',
      amountMinor: 8900,
      categoryKey: 'income.refund',
    });
    expect(parseOne('公司报销到账360元。')).toMatchObject({
      type: 'REIMBURSEMENT',
      amountMinor: 36000,
      categoryKey: 'income.reimbursement',
    });
    expect(parseOne('朋友还我500元。').type).toBe('REPAYMENT_IN');
  });

  it('splits multiple transactions without splitting account-only modifiers', () => {
    expect(
      parseTextTransactions('午饭25，微信付的。', context).candidates,
    ).toHaveLength(1);
    expect(
      parseTextTransactions('住酒店420，支付宝。', context).candidates,
    ).toHaveLength(1);

    const candidates = parseTextTransactions(
      '午饭25，打车18，水果32。',
      context,
    ).candidates;
    expect(candidates).toHaveLength(3);
    expect(candidates.map(candidate => candidate.amountMinor)).toEqual([
      2500, 1800, 3200,
    ]);
    expect(candidates.map(candidate => candidate.subcategoryKey)).toEqual([
      'expense.food.lunch',
      'expense.transport.taxi',
      'expense.food.fruit',
    ]);
  });

  it('keeps recharge ambiguous and personal payments at low confidence', () => {
    const recharge = parseOne('充值50元。');
    expect(recharge.confidence).toBeLessThan(0.65);
    expect(recharge.categoryKey).toBeUndefined();
    expect(recharge.categoryAlternatives.map(item => item.label)).toEqual([
      '手机话费',
      '公交卡',
      '游戏充值',
      '饭卡',
      '账户转账',
    ]);

    const personal = parseOne('支付给张三20元。');
    expect(personal).toMatchObject({
      type: 'EXPENSE',
      amountMinor: 2000,
      merchantRawName: '张三',
      confidenceLevel: 'LOW',
    });
    expect(personal.categoryKey).toBeUndefined();
    expect(personal.missingFields).toContain('分类');
  });

  it('uses exact confidence boundaries', () => {
    expect(confidenceLevelFor(0.6499)).toBe('LOW');
    expect(confidenceLevelFor(0.65)).toBe('MEDIUM');
    expect(confidenceLevelFor(0.8999)).toBe('MEDIUM');
    expect(confidenceLevelFor(0.9)).toBe('HIGH');
  });
});
