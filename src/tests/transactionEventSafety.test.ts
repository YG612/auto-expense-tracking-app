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
