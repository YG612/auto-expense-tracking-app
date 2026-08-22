import { parseTextTransactions } from '../classification/parseTextTransactions';
import { reviewDisposition } from '../domain/services/reviewDisposition';
import type { Account } from '../domain/entities';

const timestamp = '2026-08-22T00:00:00.000Z';
const referenceDate = new Date('2026-08-22T04:00:00.000Z');
const alipay: Account = {
  id: 'account-alipay',
  name: '支付宝',
  type: 'ALIPAY',
  currency: 'CNY',
  includeInNetWorth: true,
  sortOrder: 1,
  isHidden: false,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const wechat: Account = {
  ...alipay,
  id: 'account-wechat',
  name: '微信',
  type: 'WECHAT',
};

function parseOne(text: string, accounts: readonly Account[] = []) {
  const result = parseTextTransactions(text, {
    referenceDate,
    timezoneOffsetMinutes: 480,
    accounts,
  });
  expect(result.blockedEvents).toEqual([]);
  expect(result.candidates).toHaveLength(1);
  const candidate = result.candidates[0];
  if (candidate === undefined) throw new Error('Expected one candidate.');
  return candidate;
}

describe('transaction facts v2 integration', () => {
  const personalSendMatrix = [
    ['发了', 'TRANSFER'],
    ['转了', 'TRANSFER'],
    ['打了', 'TRANSFER'],
    ['汇了', 'TRANSFER'],
    ['付了', 'EXPENSE'],
    ['支付了', 'EXPENSE'],
  ].flatMap(([action, type]) =>
    ['元', '块', '块钱'].map(
      unit => [action, unit, type] as readonly [string, string, string],
    ),
  );

  it.each(personalSendMatrix)(
    'keeps the full action/unit matrix coherent: %s 67%s',
    (action, unit, type) => {
      const candidate = parseOne(`给老王${action}67${unit}`);
      expect(candidate.type).toBe(type);
      expect(candidate.amountMinor).toBe(6_700);
      expect(candidate.merchantRawName).toBe('老王');
      expect(candidate.eventFacts).toMatchObject({
        direction: 'OUTFLOW',
        payer: 'SELF',
        payee: 'OTHER',
      });
      expect(candidate.factResolution?.conflicts).toEqual([]);
    },
  );

  it.each(['元', '块', '块钱'] as const)(
    'keeps personal-send amount variants semantically equivalent: %s',
    unit => {
      const candidate = parseOne(`支付宝给老王发了67${unit}`, [alipay]);
      expect(candidate).toMatchObject({
        type: 'TRANSFER',
        amountMinor: 6_700,
        accountKey: 'ALIPAY',
        merchantRawName: '老王',
        eventFacts: {
          settlementState: 'COMPLETED',
          actor: 'SELF',
          payer: 'SELF',
          payee: 'OTHER',
          direction: 'OUTFLOW',
          fundSemantics: 'TRANSFER',
        },
        factResolution: {
          status: 'RESOLVED',
          action: { value: 'SEND_MONEY' },
          direction: { value: 'OUTFLOW' },
          counterparty: { text: '老王', role: 'PAYEE' },
          moneyRanges: [{ text: `67${unit}` }],
          conflicts: [],
        },
      });
      expect(candidate.missingFields).toEqual([]);
      expect(candidate.ambiguityReasons).toContain(
        '个人收款或付款对象无法可靠推断消费分类',
      );
      expect(candidate.merchantRawName).not.toContain('发');
      expect(candidate.missingFields).not.toContain('转入账户');
      expect(reviewDisposition(candidate)).toBe('EDIT_OR_PENDING');
    },
  );

  it.each(['发了', '打了', '汇了', '转了'] as const)(
    'shares one participant/direction interpretation across send synonyms: %s',
    action => {
      expect(parseOne(`给老王${action}67块`)).toMatchObject({
        type: 'TRANSFER',
        amountMinor: 6_700,
        merchantRawName: '老王',
        missingFields: ['账户'],
        eventFacts: {
          direction: 'OUTFLOW',
          payer: 'SELF',
          payee: 'OTHER',
          fundSemantics: 'TRANSFER',
        },
      });
    },
  );

  it('supports amount-first wording without swallowing the action', () => {
    const candidate = parseOne('转了67块给老王');
    expect(candidate).toMatchObject({
      type: 'TRANSFER',
      amountMinor: 6_700,
      merchantRawName: '老王',
      eventFacts: { direction: 'OUTFLOW', fundSemantics: 'TRANSFER' },
    });
    expect(candidate.merchantRawName).not.toContain('转');
  });

  it('extracts an incoming payer but abstains from guessing economic type', () => {
    const candidate = parseOne('老王给我转了67块');
    expect(candidate).toMatchObject({
      type: undefined,
      amountMinor: 6_700,
      merchantRawName: '老王',
      eventFacts: {
        actor: 'OTHER',
        payer: 'OTHER',
        payee: 'SELF',
        direction: 'INFLOW',
        fundSemantics: 'TRANSFER',
      },
      factResolution: {
        status: 'RESOLVED',
        counterparty: { text: '老王', role: 'PAYER' },
      },
    });
    expect(candidate.missingFields).toEqual(
      expect.arrayContaining(['交易类型', '账户']),
    );
  });

  it('does not turn the tuition beneficiary or action phrase into a merchant', () => {
    const candidate = parseOne('支付宝给孩子交学费3000元', [alipay]);
    expect(candidate).toMatchObject({
      type: 'EXPENSE',
      amountMinor: 300_000,
      categoryKey: 'expense.education',
      subcategoryKey: 'expense.education.tuition',
      accountKey: 'ALIPAY',
      merchantRawName: undefined,
      missingFields: [],
      ambiguityReasons: [],
      factResolution: {
        counterparty: { text: '孩子', role: 'BENEFICIARY' },
        merchantProjection: 'SUPPRESS_LEGACY',
      },
    });
    expect(candidate.confidenceLevel).toBe('HIGH');
    expect(reviewDisposition(candidate)).toBe('DIRECT_CONFIRM');
  });

  it('requires a target account only for a real internal transfer', () => {
    const candidate = parseOne('从微信转到支付宝67块', [wechat, alipay]);
    expect(candidate).toMatchObject({
      type: 'TRANSFER',
      amountMinor: 6_700,
      accountKey: 'WECHAT',
      targetAccountKey: 'ALIPAY',
      merchantRawName: undefined,
      missingFields: [],
      eventFacts: {
        payer: 'SELF',
        payee: 'SELF',
        direction: 'INTERNAL_TRANSFER',
        fundSemantics: 'TRANSFER',
      },
      factResolution: {
        status: 'RESOLVED',
        direction: { value: 'INTERNAL_TRANSFER' },
        merchantProjection: 'SUPPRESS_LEGACY',
      },
    });
    expect(reviewDisposition(candidate)).toBe('EDIT_OR_PENDING');
  });

  it.each([
    ['借给老王67块', 'LEND_OUT', 'OUTFLOW'],
    ['我还老王67块', 'REPAYMENT_OUT', 'OUTFLOW'],
    ['向老王借了67块', 'BORROW_IN', 'INFLOW'],
    ['老王还我67块', 'REPAYMENT_IN', 'INFLOW'],
  ] as const)(
    'binds block money and participants for debt semantics: %s',
    (text, type, direction) => {
      const candidate = parseOne(text);
      expect(candidate).toMatchObject({
        type,
        amountMinor: 6_700,
        merchantRawName: '老王',
        eventFacts: { direction, fundSemantics: 'DEBT' },
        factResolution: { status: 'RESOLVED', conflicts: [] },
      });
      expect(candidate.missingFields).toEqual(['账户']);
      expect(reviewDisposition(candidate)).toBe('EDIT_ONLY');
    },
  );

  it.each(['给老王发红包67块', '给老王发了67块红包'])(
    'lets an explicit gift purpose override generic transfer semantics: %s',
    text => {
      const candidate = parseOne(text);
      expect(candidate).toMatchObject({
        type: 'EXPENSE',
        amountMinor: 6_700,
        categoryKey: 'expense.social',
        subcategoryKey: 'expense.social.red_packet',
        merchantRawName: '老王',
        eventFacts: { direction: 'OUTFLOW', fundSemantics: 'PURCHASE' },
        factResolution: {
          status: 'RESOLVED',
          purpose: { value: 'RED_PACKET' },
          conflicts: [],
        },
      });
    },
  );

  it('keeps a block count out of the money field without a money frame', () => {
    const candidate = parseOne('买3块面包');
    expect(candidate.amountMinor).toBeUndefined();
    expect(candidate.factResolution).toBeUndefined();
    expect(candidate.missingFields).toContain('金额');
  });

  it('fails closed when multiple personal transfer frames survive one clause', () => {
    const candidate = parseOne('给老王发了67块给老李发了20元');
    expect(candidate.factResolution).toMatchObject({
      status: 'AMBIGUOUS',
      conflicts: [{ code: 'MULTIPLE_EVENT_FRAMES' }],
    });
    expect(candidate.ambiguityReasons).toContain(
      '同一分句匹配到多个资金事件框架，无法安全确定字段归属。',
    );
    expect(candidate.merchantRawName).not.toBe('老王发了');
    expect(candidate.confidenceLevel).toBe('LOW');
    expect(candidate.confidence).toBeLessThanOrEqual(0.49);
  });

  it.each([
    ['计划给老王发了67块', 'SETTLEMENT_PLANNED'],
    ['给老王发了67块但是失败了', 'SETTLEMENT_FAILED'],
    ['取消给老王发67块', 'SETTLEMENT_CANCELLED'],
    ['差点给老王发了67块', 'COUNTERFACTUAL_EVENT'],
    ['朋友说他给老王发了67块', 'SETTLEMENT_REPORTED'],
    ['没有给老王发67块', 'SETTLEMENT_FAILED'],
    ['计划借给老王67块', 'SETTLEMENT_PLANNED'],
    ['差点向老王借了67块', 'COUNTERFACTUAL_EVENT'],
    ['没有还老王67块', 'SETTLEMENT_FAILED'],
  ] as const)('blocks non-ledger send-money context: %s', (text, code) => {
    const result = parseTextTransactions(text, {
      referenceDate,
      timezoneOffsetMinutes: 480,
    });
    expect(result.candidates).toEqual([]);
    expect(result.blockedEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
  });
});
