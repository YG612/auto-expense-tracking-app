import { parseAmount } from '../classification/parseTextTransactions';

describe('amount parser safety boundaries', () => {
  it.each([
    '午饭12.345元',
    '午饭12..34元',
    '午饭1e6元',
    '午饭1E+6元',
    '午饭十二点三四五元',
    '版本1.2.3',
  ])('fails closed for malformed numeric syntax: %s', text => {
    expect(parseAmount(text)).toMatchObject({
      amountMinor: undefined,
      matchCount: 0,
      evidence: 'NONE',
    });
    expect(parseAmount(text).ambiguityReasons).toContainEqual(
      expect.stringContaining('格式无效'),
    );
  });

  it.each(['$12', 'USD 12', '12美元', 'HKD88', '88港币', 'HK$ 9'])(
    'fails closed for unsupported non-CNY currency: %s',
    text => {
      expect(parseAmount(text)).toMatchObject({
        amountMinor: undefined,
        matchCount: 0,
        evidence: 'NONE',
      });
      expect(parseAmount(text).ambiguityReasons).toContainEqual(
        expect.stringContaining('非人民币'),
      );
    },
  );

  it('keeps block shorthand strict and supports explicit jiao/fen suffixes', () => {
    expect(parseAmount('早餐12块5').amountMinor).toBe(1250);
    expect(parseAmount('早餐12块05').amountMinor).toBe(1205);
    expect(parseAmount('早餐12元5角3分').amountMinor).toBe(1253);
    expect(parseAmount('早餐十二元五角').amountMinor).toBe(1250);
    expect(parseAmount('早餐12元5分').amountMinor).toBe(1205);

    expect(parseAmount('牛奶25元2瓶')).toMatchObject({
      amountMinor: 2500,
      matchCount: 1,
    });
    for (const text of [
      '牛奶25元2点',
      '牛奶25元二',
      '牛奶25元2026年',
      '早餐12元5',
    ]) {
      expect(parseAmount(text)).toMatchObject({
        amountMinor: text.startsWith('早餐') ? 1200 : 2500,
        matchCount: 1,
      });
    }
  });

  it.each([
    '桌号12',
    '工号123',
    '房间号808',
    '航班CA1234',
    '型号K90',
    '苹果手机15',
  ])(
    'does not treat identifiers or arbitrary Han prefixes as money: %s',
    text => {
      expect(parseAmount(text).amountMinor).toBeUndefined();
    },
  );

  it.each([
    ['午饭25', 2500],
    ['住酒店420', 42_000],
    ['花了18', 1800],
    ['牛奶25', 2500],
  ] as const)(
    'still accepts known bare-money contexts: %s',
    (text, amountMinor) => {
      expect(parseAmount(text).amountMinor).toBe(amountMinor);
    },
  );

  it('never promotes a unit price without a matching quantity to the total', () => {
    expect(parseAmount('每瓶牛奶12元')).toMatchObject({
      amountMinor: undefined,
      role: 'UNIT_PRICE',
      evidence: 'AMBIGUOUS',
      ambiguityReasons: expect.arrayContaining([
        expect.stringContaining('单价'),
      ]),
    });
    expect(parseAmount('每瓶牛奶共12元')).toMatchObject({
      amountMinor: 1200,
      role: 'TOTAL',
      evidence: 'EXPLICIT_CURRENCY',
    });
  });

  it.each([
    ['买5瓶牛奶每瓶10块', 5000],
    ['买五瓶牛奶每瓶十元', 5000],
    ['买五瓶牛奶十块一瓶', 5000],
    ['买五瓶牛奶十块五一瓶', 5250],
    ['买5瓶牛奶一瓶10元', 5000],
    ['买5瓶牛奶10元/瓶', 5000],
    ['买2.5斤苹果每斤8元', 2000],
    ['买两斤半水果每斤8元', 2000],
    ['买半斤水果每斤8元', 400],
    ['买5瓶牛奶每瓶10块，共50元', 5000],
  ] as const)(
    'derives an exact integer-cent total from one explicit quantity and unit price: %s',
    (text, amountMinor) => {
      expect(parseAmount(text)).toMatchObject({
        amountMinor,
        role: 'TOTAL',
        ambiguityReasons: [],
      });
    },
  );

  it.each([
    '买5瓶牛奶每瓶10块，共40元',
    '买2瓶又3瓶牛奶每瓶10元',
    '买3瓶牛奶每瓶0.015元',
  ])(
    'fails closed for conflicting or inexact unit-price arithmetic: %s',
    text => {
      const parsed = parseAmount(text);
      expect(parsed.amountMinor).toBeUndefined();
      expect(parsed.ambiguityReasons).not.toHaveLength(0);
    },
  );

  it.each([
    '买5瓶牛奶每瓶10元打八折',
    '买5瓶牛奶每瓶10元满50减10',
    '买5瓶牛奶每瓶10元第二件半价',
    '买5瓶牛奶每瓶10元买一送一',
    '买5瓶牛奶每瓶10元用了优惠券',
  ])(
    'fails closed when an unmodeled promotion changes the payable total: %s',
    text => {
      expect(parseAmount(text)).toMatchObject({
        amountMinor: undefined,
        evidence: 'AMBIGUOUS',
        ambiguityReasons: expect.arrayContaining([
          expect.stringContaining('实付总价'),
        ]),
      });
    },
  );

  it.each([
    '买-5瓶牛奶每瓶10元',
    '买5瓶牛奶每瓶-10元',
    '买负五瓶牛奶每瓶10元',
    '买5瓶牛奶每瓶负十元',
  ])('fails closed instead of silently dropping a negative sign: %s', text => {
    expect(parseAmount(text)).toMatchObject({
      amountMinor: undefined,
      matchCount: 0,
      evidence: 'NONE',
      ambiguityReasons: expect.arrayContaining([
        expect.stringContaining('格式无效'),
      ]),
    });
  });

  it.each([
    ['嗯鲜花饼一块两元', 200],
    ['买一块鲜花饼两元', 200],
    ['两块鲜花饼四元', 400],
    ['两块蛋糕花了20元', 2000],
    ['买两块豆腐每块3元', 600],
    ['买两块豆腐3元一块', 600],
  ] as const)(
    'distinguishes the block measure word from colloquial money: %s',
    (text, amountMinor) => {
      expect(parseAmount(text)).toMatchObject({
        amountMinor,
        ambiguityReasons: [],
      });
    },
  );

  it.each(['买一块蛋糕', '两块蛋糕'])(
    'does not invent money from an explicit block quantity: %s',
    text => {
      expect(parseAmount(text)).toMatchObject({
        amountMinor: undefined,
      });
      expect(parseAmount(text).mentions).toContainEqual(
        expect.objectContaining({ role: 'QUANTITY' }),
      );
    },
  );

  it.each(['豆腐两块', '买了两块'])(
    'fails closed for a terminal block expression without enough context: %s',
    text => {
      expect(parseAmount(text)).toMatchObject({
        amountMinor: undefined,
        ambiguityReasons: expect.arrayContaining([
          expect.stringContaining('既可能表示数量也可能表示金额'),
        ]),
      });
    },
  );

  it('keeps colloquial block money and mao fractions compatible', () => {
    expect(parseAmount('早餐一块二').amountMinor).toBe(120);
    expect(parseAmount('花了一块两毛').amountMinor).toBe(120);
    expect(parseAmount('花了两块钱').amountMinor).toBe(200);
  });

  it('does not prefill one of several conflicting amounts without a total', () => {
    expect(parseAmount('花了一块，又支付两元')).toMatchObject({
      amountMinor: undefined,
      evidence: 'AMBIGUOUS',
      ambiguityReasons: expect.arrayContaining([
        expect.stringContaining('未明确总价'),
      ]),
    });
  });
});
