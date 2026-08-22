import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parsePaymentNotifications } from '../importers/paymentNotification';
import type { PaymentNotificationSnapshot } from '../native/PaymentNotificationCapture';

type Fixture = {
  id: string;
  snapshot: Omit<PaymentNotificationSnapshot, 'postedAt'> & {
    postedAt: string;
  };
  expected: {
    transactionSource: 'WECHAT_IMPORT' | 'ALIPAY_IMPORT';
    type: string;
    amountMinor: number;
    merchantRawName?: string;
  } | null;
};

type FixtureFile = {
  schemaVersion: number;
  provenance: string;
  cases: Fixture[];
};

const fixtureFile = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      '../../data/fixtures/payment-notifications.synthetic.json',
    ),
    'utf8',
  ),
) as FixtureFile;

describe('synthetic payment notification fixture gate', () => {
  it('is explicitly synthetic and versioned so it cannot be cited as real coverage', () => {
    expect(fixtureFile.schemaVersion).toBe(1);
    expect(fixtureFile.provenance).toBe('SYNTHETIC_ONLY');
    expect(fixtureFile.cases.length).toBeGreaterThanOrEqual(7);
  });

  it.each(fixtureFile.cases)('$id', ({ snapshot, expected }) => {
    const parsed = parsePaymentNotifications([
      { ...snapshot, postedAt: Date.parse(snapshot.postedAt) },
    ]);
    if (expected === null) {
      expect(parsed).toEqual([]);
      return;
    }
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject(expected);
  });

  it('defends the shared parser boundary even if a native payload is forged', () => {
    expect(
      parsePaymentNotifications([
        {
          key: 'forged',
          packageName: 'com.example.fake',
          title: '支付宝',
          text: '支付成功 100元',
          postedAt: Date.parse('2026-08-15T09:00:00.000Z'),
        } as unknown as PaymentNotificationSnapshot,
      ]),
    ).toEqual([]);
  });
});
