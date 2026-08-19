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
  it('rejects oversized text before rule evaluation', () => {
    expect(() => parseTextTransactions('账'.repeat(501), context)).toThrow(
      '记账文本不能超过 500 个字符',
    );
  });

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

  it('keeps quantities, people, route numbers and identifiers out of money', () => {
    for (const text of [
      '买两瓶牛奶',
      '买2瓶牛奶',
      '三个人吃饭',
      '买了25瓶水',
      '下午两点',
      '坐2号线',
      '订单号12345',
    ]) {
      expect(parseAmount(text).amountMinor).toBeUndefined();
    }

    expect(parseAmount('买2瓶牛奶花25元')).toMatchObject({
      amountMinor: 2500,
      explicitUnit: true,
      matchCount: 1,
      role: 'MONEY',
    });
    expect(parseAmount('3个人吃饭花120元').amountMinor).toBe(12_000);
    expect(parseAmount('坐2号线地铁花4元').amountMinor).toBe(400);
    expect(parseAmount('1箱24瓶水共48元').amountMinor).toBe(4800);
    expect(parseAmount('牛奶两元').amountMinor).toBe(200);
    expect(parseAmount('牛奶25元2瓶')).toMatchObject({
      amountMinor: 2500,
      matchCount: 1,
    });
  });

  it('derives explicit quantity-by-unit-price totals without treating the unit price as total', () => {
    const unitPrice = parseAmount('两瓶牛奶每瓶12.5元');
    expect(unitPrice).toMatchObject({
      amountMinor: 2500,
      role: 'TOTAL',
      evidence: 'EXPLICIT_CURRENCY',
      ambiguityReasons: [],
    });
    const unitPriceCandidate = parseTextTransactions('两瓶牛奶每瓶12.5元', {
      ...context,
      recentAccountKey: 'WECHAT',
    }).candidates[0];
    expect(unitPriceCandidate).toMatchObject({
      amountMinor: 2500,
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.groceries',
      confidenceLevel: 'MEDIUM',
    });

    const total = parseAmount('原价30元，优惠5元，实付25元');
    expect(total).toMatchObject({
      amountMinor: 2500,
      role: 'TOTAL',
      explicitUnit: true,
    });
  });

  it('never marks an unmodeled promotion as a high-confidence payable total', () => {
    for (const text of [
      '买5瓶牛奶每瓶10元打八折微信付的',
      '买5瓶牛奶每瓶10元满50减10微信付的',
      '买5瓶牛奶每瓶10元第二件半价微信付的',
      '买5瓶牛奶每瓶10元买一送一微信付的',
    ]) {
      const candidate = parseOne(text);
      expect(candidate).toMatchObject({
        amountMinor: undefined,
        confidenceLevel: 'LOW',
        missingFields: expect.arrayContaining(['金额']),
        ambiguityReasons: expect.arrayContaining([
          expect.stringContaining('实付总价'),
        ]),
      });
    }
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

  it.each([
    ['工资8000元', 'income.salary', 800_000],
    ['今天赚了100元', 'income.other', 10_000],
    ['收入100元', 'income.other', 10_000],
    ['理财收益50元', 'income.investment', 5_000],
    ['利息收入20元', 'income.interest', 2_000],
    ['二手出售500元', 'income.secondhand_sale', 50_000],
    ['收到红包200元', 'income.gift_money', 20_000],
    ['收到生活费1000元', 'income.allowance', 100_000],
    ['兼职收入600元', 'income.part_time', 60_000],
    ['项目补助到账3000元', 'income.project_grant', 300_000],
  ] as const)(
    'classifies ordinary income without falling back to expense: %s',
    (text, categoryKey, amountMinor) => {
      expect(parseOne(text)).toMatchObject({
        type: 'INCOME',
        categoryKey,
        amountMinor,
      });
    },
  );

  it('treats a complete flat income category fairly in confidence scoring', () => {
    expect(parseOne('工资8000元，微信付的')).toMatchObject({
      type: 'INCOME',
      categoryKey: 'income.salary',
      accountKey: 'WECHAT',
      confidenceLevel: 'HIGH',
    });
  });

  it('keeps direction-only cash-flow words unknown', () => {
    for (const text of ['到账100元', '收到100元']) {
      const candidate = parseOne(text);
      expect(candidate.type).toBeUndefined();
      expect(candidate.categoryKey).toBeUndefined();
      expect(candidate.missingFields).toEqual(
        expect.arrayContaining(['交易类型']),
      );
    }
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
    expect(parseOne('借款到账1000元。').type).toBe('BORROW_IN');
    expect(parseOne('公司报销收入360元。').type).toBe('REIMBURSEMENT');
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

  it('attaches a trailing payment complement to the preceding purchase event', () => {
    const result = parseTextTransactions(
      '今天下午去商场买两瓶牛奶然后花了25元',
      context,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      type: 'EXPENSE',
      amountMinor: 2500,
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.groceries',
      merchantRawName: '商场',
      sourceText: '今天下午去商场买两瓶牛奶然后花了25元',
    });
    expect(localParts(result.candidates[0]?.occurredAt)).toMatchObject({
      day: 4,
      hour: 15,
    });
  });

  it.each([
    ['今天下午去商场买2瓶牛奶然后花了25元', 2500],
    ['去超市买了两瓶牛奶，共25块', 2500],
    ['买了2.5斤苹果花了25元', 2500],
    ['3个人吃饭花120元', 12_000],
    ['坐2号线地铁花4元', 400],
    ['1箱24瓶水共48元', 4800],
    ['买两瓶牛奶然后买三个面包一共25元', 2500],
  ] as const)(
    'does not promote quantities to extra transactions: %s',
    (text, amount) => {
      const candidates = parseTextTransactions(text, context).candidates;
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.amountMinor).toBe(amount);
    },
  );

  it('keeps genuinely independent events as separate transactions', () => {
    expect(
      parseTextTransactions('午饭25，然后打车18', context).candidates.map(
        candidate => candidate.amountMinor,
      ),
    ).toEqual([2500, 1800]);
    expect(
      parseTextTransactions(
        '买两瓶牛奶25元，然后打车18元',
        context,
      ).candidates.map(candidate => candidate.amountMinor),
    ).toEqual([2500, 1800]);
    expect(
      parseTextTransactions('退款25元，手续费2元', context).candidates.map(
        candidate => candidate.amountMinor,
      ),
    ).toEqual([2500, 200]);
  });

  it('does not infer transaction verbs or narrative text as merchants', () => {
    expect(parseOne('花了25元').merchantRawName).toBeUndefined();
    expect(parseOne('今天下午去商场买牛奶25元')).toMatchObject({
      merchantRawName: '商场',
      subcategoryKey: 'expense.food.groceries',
    });
    expect(parseOne('卖了两箱牛奶赚200元')).toMatchObject({
      type: 'INCOME',
      amountMinor: 20_000,
      categoryKey: 'income.other',
    });
  });

  it('keeps route locations and the purchased ticket out of the merchant field', () => {
    expect(parseOne('说今天从武汉到上海买的动车票花了270')).toMatchObject({
      type: 'EXPENSE',
      amountMinor: 27_000,
      categoryKey: 'expense.transport',
      subcategoryKey: 'expense.transport.train',
      merchantRawName: undefined,
    });
    for (const routeOnlyText of [
      '今天从武汉到上海花了270元',
      '从北京到天津支付55元车费',
      '从上海到上海花了20元',
    ]) {
      expect(parseOne(routeOnlyText).merchantRawName).toBeUndefined();
    }
    expect(parseOne('铁路12306消费270元从武汉到上海')).toMatchObject({
      merchantRawName: '铁路12306',
      amountMinor: 27_000,
    });
    expect(
      parseTextTransactions('付给春运旅行社270元买票', context).candidates[0],
    ).toMatchObject({
      merchantRawName: '春运旅行社',
      amountMinor: 27_000,
    });
  });

  it.each([
    '今晚去吃沙县小吃花了20元',
    '今晚去沙县小吃吃饭花了20元',
    '今晚在沙县小吃吃了20元',
  ])('keeps dining verbs outside the known merchant span: %s', text => {
    expect(
      parseTextTransactions(text, {
        ...context,
        recentAccountKey: 'WECHAT',
      }).candidates[0],
    ).toMatchObject({
      type: 'EXPENSE',
      amountMinor: 2000,
      merchantRawName: '沙县小吃',
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.other',
      confidenceLevel: 'MEDIUM',
    });
  });

  it.each([
    ['今晚去吃老王面馆花了20元', '老王面馆'],
    ['今晚在老王面馆吃了20元', '老王面馆'],
  ] as const)(
    'extracts a generic dining merchant without travel or eating verbs: %s',
    (text, merchantRawName) => {
      expect(parseOne(text)).toMatchObject({
        merchantRawName,
        categoryKey: 'expense.food',
        subcategoryKey: 'expense.food.other',
      });
    },
  );

  it('does not treat a dining brand used as a product or financial instrument as a restaurant event', () => {
    const frozenFood = parseOne('买沙县小吃速冻包花20元微信付的');
    expect(frozenFood.merchantRawName).toBeUndefined();
    expect(frozenFood.subcategoryKey).not.toBe('expense.food.other');

    const voucher = parseOne('淘宝买沙县小吃代金券花20元微信付的');
    expect(voucher).toMatchObject({
      merchantRawName: '淘宝',
      categoryKey: 'expense.shopping',
      subcategoryKey: 'expense.shopping.online',
    });

    const stock = parseOne('今天买肯德基股票花20元微信付的');
    expect(stock.merchantRawName).toBeUndefined();
    expect(stock.subcategoryKey).not.toBe('expense.food.other');
  });

  it('keeps a generic dining object out of the merchant field', () => {
    expect(parseOne('今晚去吃火锅花100元微信付的')).toMatchObject({
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.other',
      merchantRawName: undefined,
      confidenceLevel: 'HIGH',
    });
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
