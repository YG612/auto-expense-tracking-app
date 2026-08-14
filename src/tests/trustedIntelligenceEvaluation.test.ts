import { parseTextTransactions } from '../classification/parseTextTransactions';

type EvaluationCase = {
  text: string;
  amountMinor?: number;
  type?: string;
  categoryKey?: string;
  accountKey?: string;
  mustReview: boolean;
};

const CASES: readonly EvaluationCase[] = [
  {
    text: '午饭25元，微信付的',
    amountMinor: 2500,
    type: 'EXPENSE',
    categoryKey: 'expense.food',
    accountKey: 'WECHAT',
    mustReview: false,
  },
  {
    text: '早餐12块5，现金',
    amountMinor: 1250,
    type: 'EXPENSE',
    categoryKey: 'expense.food',
    accountKey: 'CASH',
    mustReview: false,
  },
  {
    text: '工资8000元，银行卡到账',
    amountMinor: 800_000,
    type: 'INCOME',
    categoryKey: 'income.salary',
    accountKey: 'BANK_CARD',
    mustReview: false,
  },
  {
    text: '支付宝给朋友转了300元',
    amountMinor: 30_000,
    mustReview: true,
  },
  {
    text: '微信充值100元',
    amountMinor: 10_000,
    accountKey: 'WECHAT',
    mustReview: true,
  },
  {
    text: '给小王50元',
    amountMinor: 5000,
    mustReview: true,
  },
  {
    text: '咖啡原价30优惠5实付25元，微信',
    accountKey: 'WECHAT',
    mustReview: false,
  },
  {
    text: '明天午饭25元，微信',
    amountMinor: 2500,
    categoryKey: 'expense.food',
    accountKey: 'WECHAT',
    mustReview: true,
  },
  {
    text: '一箱24瓶水共48元，支付宝',
    amountMinor: 4800,
    type: 'EXPENSE',
    accountKey: 'ALIPAY',
    mustReview: true,
  },
  {
    text: '收到报销200元，银行卡',
    amountMinor: 20_000,
    type: 'REIMBURSEMENT',
    accountKey: 'BANK_CARD',
    mustReview: true,
  },
] as const;

describe('trusted intelligence field-level evaluation corpus', () => {
  it('meets separate amount, type, category, account, and risk gates', () => {
    const counts = {
      amount: { expected: 0, correct: 0 },
      type: { expected: 0, correct: 0 },
      category: { expected: 0, correct: 0 },
      account: { expected: 0, correct: 0 },
      risk: { expected: CASES.length, correct: 0 },
    };
    const riskMismatches: string[] = [];
    for (const item of CASES) {
      const candidate = parseTextTransactions(item.text, {
        referenceDate: new Date('2026-08-14T08:00:00.000Z'),
        timezoneOffsetMinutes: 480,
      }).candidates[0]!;
      for (const field of [
        'amountMinor',
        'type',
        'categoryKey',
        'accountKey',
      ] as const) {
        const expected = item[field];
        if (expected === undefined) continue;
        const metric =
          field === 'amountMinor'
            ? counts.amount
            : field === 'type'
              ? counts.type
              : field === 'categoryKey'
                ? counts.category
                : counts.account;
        metric.expected += 1;
        if (candidate[field] === expected) metric.correct += 1;
      }
      const requiresReview =
        candidate.missingFields.length > 0 ||
        candidate.ambiguityReasons.length > 0 ||
        candidate.confidenceLevel !== 'HIGH';
      if (requiresReview === item.mustReview) counts.risk.correct += 1;
      else riskMismatches.push(item.text);
    }

    const accuracy = (metric: { expected: number; correct: number }) =>
      metric.correct / metric.expected;
    expect(accuracy(counts.amount)).toBeGreaterThanOrEqual(0.95);
    expect(accuracy(counts.type)).toBeGreaterThanOrEqual(0.9);
    expect(accuracy(counts.category)).toBeGreaterThanOrEqual(0.85);
    expect(accuracy(counts.account)).toBeGreaterThanOrEqual(0.95);
    expect(riskMismatches).toEqual([]);
    expect(accuracy(counts.risk)).toBeGreaterThanOrEqual(0.9);
  });
});
