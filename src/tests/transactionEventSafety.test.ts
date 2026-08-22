import { parseTextTransactions } from '../classification/parseTextTransactions';

const context = {
  referenceDate: new Date('2026-08-04T07:20:00.000Z'),
  timezoneOffsetMinutes: 480,
} as const;

function parse(text: string) {
  return parseTextTransactions(text, context).candidates;
}

describe('transaction event safety boundary', () => {
  it.each([
    ['差点花了100元', 'COUNTERFACTUAL_EVENT'],
    ['朋友说他花了100元', 'SETTLEMENT_REPORTED'],
    ['提醒我明天交房租2000元', 'SETTLEMENT_PLANNED'],
    ['商家报价100元', 'SETTLEMENT_QUOTED'],
    ['预算1000元', 'NON_TRANSACTION_SNAPSHOT'],
    ['余额1000元', 'NON_TRANSACTION_SNAPSHOT'],
    ['信用卡账单1000元', 'NON_TRANSACTION_SNAPSHOT'],
    ['红包200元', 'DIRECTION_UNKNOWN'],
  ])('blocks non-ledger facts with a stable reason code: %s', (text, code) => {
    const result = parseTextTransactions(text, context);
    expect(result.candidates).toEqual([]);
    expect(result.blockedEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
  });

  it('keeps a live self transaction when an earlier reported event is present', () => {
    const result = parseTextTransactions(
      '朋友说他花了100元，然后我花了20元',
      context,
    );
    expect(result.blockedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SETTLEMENT_REPORTED' }),
      ]),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      type: 'EXPENSE',
      amountMinor: 2_000,
      eventFacts: {
        settlementState: 'COMPLETED',
        actor: 'SELF',
        direction: 'OUTFLOW',
      },
    });
  });

  it('treats employer payroll as an outflow instead of salary income', () => {
    const candidates = parse('我给员工发工资8000元');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'EXPENSE',
      amountMinor: 800_000,
      categoryKey: 'expense.other_expense',
      eventFacts: {
        settlementState: 'COMPLETED',
        actor: 'SELF',
        direction: 'OUTFLOW',
        fundSemantics: 'UNKNOWN',
        payer: 'SELF',
        payee: 'OTHER',
        ledgerOwner: 'SELF',
      },
    });
  });

  it.each([
    [
      '给孩子交学费3000元',
      {
        type: 'EXPENSE',
        amountMinor: 300_000,
        categoryKey: 'expense.education',
        direction: 'OUTFLOW',
      },
    ],
    [
      '转给老王100元',
      {
        type: 'TRANSFER',
        amountMinor: 10_000,
        direction: 'OUTFLOW',
      },
    ],
    [
      '我还老王100元',
      {
        type: 'REPAYMENT_OUT',
        amountMinor: 10_000,
        direction: 'OUTFLOW',
      },
    ],
    [
      '押金退回100元',
      {
        type: 'REFUND',
        amountMinor: 10_000,
        direction: 'INFLOW',
      },
    ],
    [
      '闲鱼卖手机800元',
      {
        type: 'INCOME',
        amountMinor: 80_000,
        categoryKey: 'income.secondhand_sale',
        direction: 'INFLOW',
      },
    ],
    [
      '在医院停车10元',
      {
        type: 'EXPENSE',
        amountMinor: 1_000,
        categoryKey: 'expense.transport',
        subcategoryKey: 'expense.transport.parking',
        direction: 'OUTFLOW',
      },
    ],
    [
      '在学校买饭10元',
      {
        type: 'EXPENSE',
        amountMinor: 1_000,
        categoryKey: 'expense.food',
        subcategoryKey: 'expense.food.other',
        direction: 'OUTFLOW',
      },
    ],
    [
      '花呗分期手续费10元',
      {
        type: 'EXPENSE',
        amountMinor: 1_000,
        categoryKey: 'expense.financial_fees',
        subcategoryKey: 'expense.financial_fees.service_fee',
        direction: 'OUTFLOW',
      },
    ],
  ])('preserves high-risk transaction direction: %s', (text, expected) => {
    const candidates = parse(text);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: expected.type,
      amountMinor: expected.amountMinor,
      ...('categoryKey' in expected
        ? { categoryKey: expected.categoryKey }
        : {}),
      ...('subcategoryKey' in expected
        ? { subcategoryKey: expected.subcategoryKey }
        : {}),
      eventFacts: {
        settlementState: 'COMPLETED',
        direction: expected.direction,
      },
    });
  });

  it('keeps external transfer participants without inventing ordinary income', () => {
    const candidates = parse('老王转给我100元');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: undefined,
      amountMinor: 10_000,
      eventFacts: {
        settlementState: 'COMPLETED',
        actor: 'OTHER',
        payer: 'OTHER',
        payee: 'SELF',
        ledgerOwner: 'SELF',
        direction: 'INFLOW',
        fundSemantics: 'TRANSFER',
      },
    });
    expect(candidates[0]?.missingFields).toContain('交易类型');
  });

  it.each([
    {
      text: '微信午饭25打车18水果32',
      expected: [
        ['EXPENSE', 2_500, 'expense.food.lunch'],
        ['EXPENSE', 1_800, 'expense.transport.taxi'],
        ['EXPENSE', 3_200, 'expense.food.fruit'],
      ],
    },
    {
      text: '微信退款20又买30',
      expected: [
        ['REFUND', 2_000, undefined],
        ['EXPENSE', 3_000, undefined],
      ],
    },
    {
      text: '微信工资8000晚饭30',
      expected: [
        ['INCOME', 800_000, undefined],
        ['EXPENSE', 3_000, 'expense.food.dinner'],
      ],
    },
    {
      text: '微信收到100元，然后花了20元',
      expected: [
        ['INCOME', 10_000, undefined],
        ['EXPENSE', 2_000, undefined],
      ],
    },
    {
      text: '微信收到100元花了20元',
      expected: [
        ['INCOME', 10_000, undefined],
        ['EXPENSE', 2_000, undefined],
      ],
    },
  ])('splits adjacent event-money anchors: $text', ({ text, expected }) => {
    expect(
      parse(text).map(candidate => [
        candidate.type,
        candidate.amountMinor,
        candidate.subcategoryKey,
      ]),
    ).toEqual(expected);
  });

  it.each([
    ['工资到账后微信晚饭30元', 'expense.food.dinner'],
    ['退款结束后微信买午饭25元', 'expense.food.lunch'],
    ['午饭结束后微信打车18元', 'expense.transport.taxi'],
    ['退款失败后微信买午饭25元', 'expense.food.lunch'],
  ])(
    'binds one amount to the nearest live event: %s',
    (text, subcategoryKey) => {
      const candidates = parse(text);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        type: 'EXPENSE',
        subcategoryKey,
      });
    },
  );

  it.each([
    '微信不要记午饭25元',
    '微信没买午饭25元',
    '微信未消费25元',
    '微信退款失败20元',
    '微信计划买午饭25元',
    '微信准备花25元',
    '微信没收到100元',
    '微信尚未到账100元',
    '微信如果收到100元',
    '微信预计到账100元',
    '微信收到100元了吗',
    '微信到账100元后又退回',
  ])('never creates a candidate for a non-final event: %s', text => {
    expect(parse(text)).toEqual([]);
  });

  it.each([
    '微信午饭25，打车18，一共43',
    '微信一共43，午饭25，打车18',
    '微信午饭25打车18水果32一共75',
  ])('reconciles and removes an aggregate total: %s', text => {
    const candidates = parse(text);
    expect(candidates.map(candidate => candidate.amountMinor)).toEqual(
      text.includes('水果') ? [2_500, 1_800, 3_200] : [2_500, 1_800],
    );
    expect(
      candidates.every(candidate => !candidate.sourceText.includes('共')),
    ).toBe(true);
  });

  it('fails closed when an aggregate total disagrees with the details', () => {
    const candidates = parse('微信午饭25，打车18，一共45');
    expect(candidates.map(candidate => candidate.amountMinor)).toEqual([
      2_500, 1_800,
    ]);
    expect(
      candidates.every(
        candidate =>
          candidate.confidence <= 0.64 &&
          candidate.ambiguityReasons.some(reason =>
            reason.includes('总价与逐笔金额不一致'),
          ),
      ),
    ).toBe(true);
  });

  it('does not merge a Chinese comma boundary into a thousands value', () => {
    const candidates = parse('微信午饭25，180元打车');
    expect(candidates.map(candidate => candidate.amountMinor)).toEqual([
      2_500, 18_000,
    ]);
    expect(
      candidates.every(
        candidate =>
          candidate.confidence <= 0.64 &&
          candidate.ambiguityReasons.some(reason =>
            reason.includes('千分位或交易分隔符'),
          ),
      ),
    ).toBe(true);
  });

  it('keeps an unpriced event visible and non-confirmable', () => {
    const candidates = parse('微信午饭25，然后打车');
    expect(candidates).toHaveLength(2);
    expect(candidates[1]).toMatchObject({
      type: 'EXPENSE',
      amountMinor: undefined,
      confidenceLevel: 'LOW',
    });
    expect(candidates[1]?.missingFields).toContain('金额');
  });

  it('classifies a refund service fee as an expense, not a refund', () => {
    const candidates = parse('微信支付退款手续费20元');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'EXPENSE',
      amountMinor: 2_000,
      categoryKey: 'expense.financial_fees',
      subcategoryKey: 'expense.financial_fees.service_fee',
    });
  });
});
