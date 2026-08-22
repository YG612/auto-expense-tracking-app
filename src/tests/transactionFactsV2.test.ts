import {
  resolveTransactionFacts,
  TRANSACTION_ACTION_LEXICON,
  TRANSACTION_ACCOUNT_LEXICON,
  TRANSACTION_FACT_RULESET_VERSION,
  validateTransactionFactProjection,
} from '../classification/facts';

describe('transaction facts v2', () => {
  it.each([
    ['给老王发了67块', 'SEND_MONEY', 'TRANSFER'],
    ['给老王打了67元', 'SEND_MONEY', 'TRANSFER'],
    ['给老王汇了67块钱', 'SEND_MONEY', 'TRANSFER'],
    ['给老王转账了67元', 'SEND_MONEY', 'TRANSFER'],
    ['给老王划过去67块', 'SEND_MONEY', 'TRANSFER'],
    ['给老王付了67块', 'PAY', 'EXPENSE'],
    ['支付宝给老王支付了67元', 'PAY', 'EXPENSE'],
  ] as const)(
    'resolves an outgoing personal money frame: %s',
    (text, action, transactionType) => {
      expect(resolveTransactionFacts(text)).toMatchObject({
        rulesetVersion: TRANSACTION_FACT_RULESET_VERSION,
        status: 'RESOLVED',
        action: { value: action },
        direction: { value: 'OUTFLOW' },
        transactionType: { value: transactionType },
        counterparty: {
          text: '老王',
          role: 'PAYEE',
          kind: 'EXTERNAL_PARTY',
        },
        moneyRanges: [{ text: expect.stringContaining('67') }],
        conflicts: [],
        merchantProjection: 'COUNTERPARTY',
      });
    },
  );

  it('keeps action, counterparty and money spans disjoint', () => {
    const result = resolveTransactionFacts('给老王发了67块');
    expect(result.counterparty?.span).toEqual({
      start: 1,
      end: 3,
      text: '老王',
    });
    expect(result.action?.span).toEqual({ start: 3, end: 4, text: '发' });
    expect(result.moneyRanges).toEqual([{ start: 5, end: 8, text: '67块' }]);
    expect(result.counterparty?.span.end).toBeLessThanOrEqual(
      result.action?.span.start ?? -1,
    );
    expect(result.action?.span.end).toBeLessThanOrEqual(
      result.moneyRanges[0]?.start ?? -1,
    );
  });

  it('supports amount-first outgoing wording', () => {
    expect(resolveTransactionFacts('转了67块给老王')).toMatchObject({
      status: 'RESOLVED',
      action: { value: 'SEND_MONEY' },
      direction: { value: 'OUTFLOW' },
      transactionType: { value: 'TRANSFER' },
      counterparty: { text: '老王', role: 'PAYEE' },
      moneyRanges: [{ text: '67块' }],
    });
  });

  it('resolves an incoming external-party frame without guessing income type', () => {
    expect(resolveTransactionFacts('老王给我转了67块')).toMatchObject({
      status: 'RESOLVED',
      action: { value: 'RECEIVE_MONEY' },
      direction: { value: 'INFLOW' },
      fundSemantics: { value: 'TRANSFER' },
      transactionType: undefined,
      counterparty: {
        text: '老王',
        role: 'PAYER',
        kind: 'EXTERNAL_PARTY',
      },
      moneyRanges: [{ text: '67块' }],
    });
  });

  it('keeps a fee beneficiary separate from the merchant projection', () => {
    expect(resolveTransactionFacts('给孩子交学费3000元')).toMatchObject({
      status: 'RESOLVED',
      action: { value: 'PAY' },
      direction: { value: 'OUTFLOW' },
      fundSemantics: { value: 'PURCHASE' },
      transactionType: { value: 'EXPENSE' },
      counterparty: {
        text: '孩子',
        role: 'BENEFICIARY',
      },
      purpose: { value: 'TUITION_FEE' },
      moneyRanges: [{ text: '3000元' }],
      merchantProjection: 'SUPPRESS_LEGACY',
    });
  });

  it.each(['给老王发红包67块', '给老王发了67块红包'])(
    'uses explicit red-packet purpose instead of transfer semantics: %s',
    text => {
      expect(resolveTransactionFacts(text)).toMatchObject({
        status: 'RESOLVED',
        action: { value: 'SEND_MONEY' },
        purpose: { value: 'RED_PACKET' },
        direction: { value: 'OUTFLOW' },
        fundSemantics: { value: 'PURCHASE' },
        transactionType: { value: 'EXPENSE' },
        counterparty: { text: '老王', role: 'PAYEE' },
        moneyRanges: [{ text: '67块' }],
      });
    },
  );

  it('resolves a two-account transfer without inventing a merchant', () => {
    expect(resolveTransactionFacts('从微信转到支付宝67块')).toMatchObject({
      status: 'RESOLVED',
      action: { value: 'SEND_MONEY' },
      direction: { value: 'INTERNAL_TRANSFER' },
      fundSemantics: { value: 'TRANSFER' },
      transactionType: { value: 'TRANSFER' },
      counterparty: undefined,
      sourceAccount: { accountType: 'WECHAT', role: 'SOURCE' },
      targetAccount: { accountType: 'ALIPAY', role: 'TARGET' },
      moneyRanges: [{ text: '67块' }],
      merchantProjection: 'SUPPRESS_LEGACY',
    });
  });

  it.each([
    ['借给老王67块', 'LEND', 'LEND_OUT', 'OUTFLOW', 'PAYEE'],
    ['我还老王67块', 'REPAY', 'REPAYMENT_OUT', 'OUTFLOW', 'PAYEE'],
    ['向老王借了67块', 'BORROW', 'BORROW_IN', 'INFLOW', 'PAYER'],
    ['老王还我67块', 'REPAY', 'REPAYMENT_IN', 'INFLOW', 'PAYER'],
  ] as const)(
    'resolves a personal debt frame: %s',
    (text, action, transactionType, direction, role) => {
      expect(resolveTransactionFacts(text)).toMatchObject({
        status: 'RESOLVED',
        action: { value: action },
        direction: { value: direction },
        fundSemantics: { value: 'DEBT' },
        transactionType: { value: transactionType },
        counterparty: { text: '老王', role },
        moneyRanges: [{ text: '67块' }],
      });
    },
  );

  it.each([
    '买3块面包',
    '去北京花了35块钱支付宝',
    '北京到上海高铁票500元',
    '预算1000元',
    '给我自己转了67块',
  ])('does not invent a personal transfer frame for %s', text => {
    expect(resolveTransactionFacts(text)).toMatchObject({
      status: 'NO_MATCH',
      moneyRanges: [],
      conflicts: [],
    });
  });

  it('fails closed when one clause contains multiple personal money frames', () => {
    expect(
      resolveTransactionFacts('给老王发了67块给老李发了20元'),
    ).toMatchObject({
      status: 'AMBIGUOUS',
      moneyRanges: [],
      conflicts: [
        {
          code: 'MULTIPLE_EVENT_FRAMES',
          ruleIds: expect.any(Array),
        },
      ],
      merchantProjection: 'NONE',
    });
  });

  it('keeps action aliases unique across canonical definitions', () => {
    const aliases = TRANSACTION_ACTION_LEXICON.flatMap(
      definition => definition.aliases,
    );
    expect(new Set(aliases).size).toBe(aliases.length);
    const accountAliases = TRANSACTION_ACCOUNT_LEXICON.flatMap(
      definition => definition.aliases,
    );
    expect(new Set(accountAliases).size).toBe(accountAliases.length);
  });

  it('abstains when compatibility fields contradict resolved facts', () => {
    const detected = resolveTransactionFacts('给老王发了67块');
    const validated = validateTransactionFactProjection(detected, {
      type: 'EXPENSE',
      merchantRawName: '老王发了',
      eventFacts: {
        settlementState: 'COMPLETED',
        actor: 'SELF',
        payer: 'SELF',
        payee: 'SELF',
        ledgerOwner: 'SELF',
        direction: 'INTERNAL_TRANSFER',
        fundSemantics: 'PURCHASE',
        blockingReasons: [],
      },
    });

    expect(validated.status).toBe('ABSTAINED');
    expect(validated.conflicts.map(conflict => conflict.code)).toEqual(
      expect.arrayContaining([
        'TRANSACTION_TYPE_CONFLICT',
        'PARTICIPANT_DIRECTION_CONFLICT',
        'FUND_SEMANTICS_CONFLICT',
        'MERCHANT_PROJECTION_CONFLICT',
      ]),
    );
  });
});
