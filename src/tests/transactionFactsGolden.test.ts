import { parseTextTransactions } from '../classification/parseTextTransactions';
import type { ParsedTransactionCandidate } from '../classification/types';
import type { Account } from '../domain/entities';

const timestamp = '2026-08-22T00:00:00.000Z';
const referenceDate = new Date('2026-08-22T04:00:00.000Z');
const accounts: readonly Account[] = [
  {
    id: 'account-alipay',
    name: '支付宝',
    type: 'ALIPAY',
    currency: 'CNY',
    includeInNetWorth: true,
    sortOrder: 1,
    isHidden: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'account-wechat',
    name: '微信',
    type: 'WECHAT',
    currency: 'CNY',
    includeInNetWorth: true,
    sortOrder: 2,
    isHidden: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

function parseOne(text: string): ParsedTransactionCandidate {
  const result = parseTextTransactions(text, {
    referenceDate,
    timezoneOffsetMinutes: 480,
    accounts,
  });
  expect(result.blockedEvents).toEqual([]);
  expect(result.candidates).toHaveLength(1);
  const candidate = result.candidates[0];
  if (candidate === undefined) throw new Error(`Expected a candidate: ${text}`);
  return candidate;
}

function semanticProjection(candidate: ParsedTransactionCandidate) {
  return {
    type: candidate.type,
    amountMinor: candidate.amountMinor,
    currency: candidate.currency,
    accountKey: candidate.accountKey,
    targetAccountKey: candidate.targetAccountKey,
    merchantRawName: candidate.merchantRawName,
    categoryKey: candidate.categoryKey,
    subcategoryKey: candidate.subcategoryKey,
    event: {
      direction: candidate.eventFacts?.direction,
      fundSemantics: candidate.eventFacts?.fundSemantics,
      payer: candidate.eventFacts?.payer,
      payee: candidate.eventFacts?.payee,
    },
    facts: {
      status: candidate.factResolution?.status,
      action: candidate.factResolution?.action?.value,
      counterparty: candidate.factResolution?.counterparty?.text,
      counterpartyRole: candidate.factResolution?.counterparty?.role,
      purpose: candidate.factResolution?.purpose?.value,
      sourceAccount: candidate.factResolution?.sourceAccount?.accountType,
      targetAccount: candidate.factResolution?.targetAccount?.accountType,
      conflicts: candidate.factResolution?.conflicts ?? [],
    },
  };
}

describe('transaction facts full-field golden cases', () => {
  it.each([
    {
      text: '支付宝给老王发了67块',
      expected: {
        type: 'TRANSFER',
        amountMinor: 6_700,
        currency: 'CNY',
        accountKey: 'ALIPAY',
        targetAccountKey: undefined,
        merchantRawName: '老王',
        categoryKey: undefined,
        subcategoryKey: undefined,
        event: {
          direction: 'OUTFLOW',
          fundSemantics: 'TRANSFER',
          payer: 'SELF',
          payee: 'OTHER',
        },
        facts: {
          status: 'RESOLVED',
          action: 'SEND_MONEY',
          counterparty: '老王',
          counterpartyRole: 'PAYEE',
          purpose: undefined,
          sourceAccount: undefined,
          targetAccount: undefined,
          conflicts: [],
        },
      },
    },
    {
      text: '给老王支付67元，支付宝',
      expected: {
        type: 'EXPENSE',
        amountMinor: 6_700,
        currency: 'CNY',
        accountKey: 'ALIPAY',
        targetAccountKey: undefined,
        merchantRawName: '老王',
        categoryKey: undefined,
        subcategoryKey: undefined,
        event: {
          direction: 'OUTFLOW',
          fundSemantics: 'PURCHASE',
          payer: 'SELF',
          payee: 'OTHER',
        },
        facts: {
          status: 'RESOLVED',
          action: 'PAY',
          counterparty: '老王',
          counterpartyRole: 'PAYEE',
          purpose: undefined,
          sourceAccount: undefined,
          targetAccount: undefined,
          conflicts: [],
        },
      },
    },
    {
      text: '老王给我转了67块，支付宝',
      expected: {
        type: undefined,
        amountMinor: 6_700,
        currency: 'CNY',
        accountKey: 'ALIPAY',
        targetAccountKey: undefined,
        merchantRawName: '老王',
        categoryKey: undefined,
        subcategoryKey: undefined,
        event: {
          direction: 'INFLOW',
          fundSemantics: 'TRANSFER',
          payer: 'OTHER',
          payee: 'SELF',
        },
        facts: {
          status: 'RESOLVED',
          action: 'RECEIVE_MONEY',
          counterparty: '老王',
          counterpartyRole: 'PAYER',
          purpose: undefined,
          sourceAccount: undefined,
          targetAccount: undefined,
          conflicts: [],
        },
      },
    },
    {
      text: '支付宝给孩子交学费3000元',
      expected: {
        type: 'EXPENSE',
        amountMinor: 300_000,
        currency: 'CNY',
        accountKey: 'ALIPAY',
        targetAccountKey: undefined,
        merchantRawName: undefined,
        categoryKey: 'expense.education',
        subcategoryKey: 'expense.education.tuition',
        event: {
          direction: 'OUTFLOW',
          fundSemantics: 'PURCHASE',
          payer: 'SELF',
          payee: 'UNKNOWN',
        },
        facts: {
          status: 'RESOLVED',
          action: 'PAY',
          counterparty: '孩子',
          counterpartyRole: 'BENEFICIARY',
          purpose: 'TUITION_FEE',
          sourceAccount: undefined,
          targetAccount: undefined,
          conflicts: [],
        },
      },
    },
    {
      text: '从微信转到支付宝67块',
      expected: {
        type: 'TRANSFER',
        amountMinor: 6_700,
        currency: 'CNY',
        accountKey: 'WECHAT',
        targetAccountKey: 'ALIPAY',
        merchantRawName: undefined,
        categoryKey: undefined,
        subcategoryKey: undefined,
        event: {
          direction: 'INTERNAL_TRANSFER',
          fundSemantics: 'TRANSFER',
          payer: 'SELF',
          payee: 'SELF',
        },
        facts: {
          status: 'RESOLVED',
          action: 'SEND_MONEY',
          counterparty: undefined,
          counterpartyRole: undefined,
          purpose: undefined,
          sourceAccount: 'WECHAT',
          targetAccount: 'ALIPAY',
          conflicts: [],
        },
      },
    },
    {
      text: '向老王借了67块支付宝',
      expected: {
        type: 'BORROW_IN',
        amountMinor: 6_700,
        currency: 'CNY',
        accountKey: 'ALIPAY',
        targetAccountKey: undefined,
        merchantRawName: '老王',
        categoryKey: undefined,
        subcategoryKey: undefined,
        event: {
          direction: 'INFLOW',
          fundSemantics: 'DEBT',
          payer: 'OTHER',
          payee: 'SELF',
        },
        facts: {
          status: 'RESOLVED',
          action: 'BORROW',
          counterparty: '老王',
          counterpartyRole: 'PAYER',
          purpose: undefined,
          sourceAccount: undefined,
          targetAccount: undefined,
          conflicts: [],
        },
      },
    },
    {
      text: '给老王发红包67块支付宝',
      expected: {
        type: 'EXPENSE',
        amountMinor: 6_700,
        currency: 'CNY',
        accountKey: 'ALIPAY',
        targetAccountKey: undefined,
        merchantRawName: '老王',
        categoryKey: 'expense.social',
        subcategoryKey: 'expense.social.red_packet',
        event: {
          direction: 'OUTFLOW',
          fundSemantics: 'PURCHASE',
          payer: 'SELF',
          payee: 'OTHER',
        },
        facts: {
          status: 'RESOLVED',
          action: 'SEND_MONEY',
          counterparty: '老王',
          counterpartyRole: 'PAYEE',
          purpose: 'RED_PACKET',
          sourceAccount: undefined,
          targetAccount: undefined,
          conflicts: [],
        },
      },
    },
    {
      text: '坐车花了45块钱，支付宝',
      expected: {
        type: 'EXPENSE',
        amountMinor: 4_500,
        currency: 'CNY',
        accountKey: 'ALIPAY',
        targetAccountKey: undefined,
        merchantRawName: undefined,
        categoryKey: 'expense.transport',
        subcategoryKey: undefined,
        event: {
          direction: 'OUTFLOW',
          fundSemantics: 'PURCHASE',
          payer: 'SELF',
          payee: 'UNKNOWN',
        },
        facts: {
          status: undefined,
          action: undefined,
          counterparty: undefined,
          counterpartyRole: undefined,
          purpose: undefined,
          sourceAccount: undefined,
          targetAccount: undefined,
          conflicts: [],
        },
      },
    },
    {
      text: '去北京花了35块钱支付宝',
      expected: {
        type: 'EXPENSE',
        amountMinor: 3_500,
        currency: 'CNY',
        accountKey: 'ALIPAY',
        targetAccountKey: undefined,
        merchantRawName: undefined,
        categoryKey: undefined,
        subcategoryKey: undefined,
        event: {
          direction: 'OUTFLOW',
          fundSemantics: 'PURCHASE',
          payer: 'SELF',
          payee: 'UNKNOWN',
        },
        facts: {
          status: undefined,
          action: undefined,
          counterparty: undefined,
          counterpartyRole: undefined,
          purpose: undefined,
          sourceAccount: undefined,
          targetAccount: undefined,
          conflicts: [],
        },
      },
    },
  ])('matches every core field for $text', ({ text, expected }) => {
    expect(semanticProjection(parseOne(text))).toEqual(expected);
  });

  it.each([
    '支付宝给老王发67元',
    '支付宝给老王发了67块',
    '支付宝给老王发过去67块钱',
    '支付宝，给老王发了六十七元',
    '我刚才给老王发了67圆，zfb',
  ])('preserves personal-transfer facts under surface variation: %s', text => {
    expect(semanticProjection(parseOne(text))).toMatchObject({
      type: 'TRANSFER',
      amountMinor: 6_700,
      accountKey: 'ALIPAY',
      merchantRawName: '老王',
      event: {
        direction: 'OUTFLOW',
        fundSemantics: 'TRANSFER',
        payer: 'SELF',
        payee: 'OTHER',
      },
      facts: {
        status: 'RESOLVED',
        action: 'SEND_MONEY',
        counterparty: '老王',
        counterpartyRole: 'PAYEE',
        conflicts: [],
      },
    });
  });
});
