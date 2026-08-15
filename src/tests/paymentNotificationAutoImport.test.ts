import { NativeModules } from 'react-native';

import { createRepositories, type DatabaseConnection } from '../database';
import { importPendingPaymentNotificationsAutomatically } from '../importers/paymentNotificationAutoImport';
import { openMigratedTestDatabase } from './database/testDatabase';

describe('automatic payment notification import', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
    delete NativeModules.PaymentNotificationCapture;
    database.close();
  });

  it('keeps native capture disabled until the user opts in', async () => {
    const repositories = createRepositories(database);
    const setCaptureEnabled = jest.fn(async () => ({
      supported: true,
      permissionGranted: true,
      captureEnabled: false,
      queuedCount: 0,
    }));
    const listPending = jest.fn(async () => []);
    NativeModules.PaymentNotificationCapture = {
      setCaptureEnabled,
      listPending,
    };

    await expect(
      importPendingPaymentNotificationsAutomatically(repositories),
    ).resolves.toMatchObject({ capturedCount: 0, importedCount: 0 });
    expect(setCaptureEnabled).toHaveBeenCalledWith(false);
    expect(listPending).not.toHaveBeenCalled();
  });

  it('automatically creates pending entries and acknowledges the entire durable batch', async () => {
    const repositories = createRepositories(database);
    await repositories.experimentalFeatures.update(
      { paymentNotificationsEnabled: true },
      '2026-08-15T00:00:00.000Z',
    );
    let pending = [
      {
        key: 'wechat|1',
        packageName: 'com.tencent.mm' as const,
        title: '微信支付',
        text: '向公交集团付款成功 2.00元',
        postedAt: Date.parse('2026-08-15T08:00:00.000Z'),
      },
      {
        key: 'alipay|amount-free',
        packageName: 'com.eg.android.AlipayGphone' as const,
        title: '支付宝',
        text: '支付成功，查看详情',
        postedAt: Date.parse('2026-08-15T08:01:00.000Z'),
      },
    ];
    const acknowledge = jest.fn(async (keys: string[]) => {
      pending = pending.filter(item => !keys.includes(item.key));
    });
    NativeModules.PaymentNotificationCapture = {
      setCaptureEnabled: jest.fn(async () => ({
        supported: true,
        permissionGranted: true,
        captureEnabled: true,
        queuedCount: 2,
      })),
      listPending: jest.fn(async () => pending),
      acknowledge,
    };

    await expect(
      importPendingPaymentNotificationsAutomatically(repositories),
    ).resolves.toMatchObject({
      capturedCount: 2,
      importedCount: 1,
      ignoredCount: 1,
    });
    expect(acknowledge).toHaveBeenCalledWith([
      'wechat|1',
      'alipay|amount-free',
    ]);
    const transactions = await database.execute<{
      source: string;
      confirmation_status: string;
    }>(
      `SELECT source, confirmation_status FROM transactions
       WHERE source_reference_id LIKE 'notification:%'`,
    );
    expect(transactions.rows).toEqual([
      { source: 'WECHAT_IMPORT', confirmation_status: 'PENDING' },
    ]);
  });

  it('does not acknowledge raw notifications when the ledger transaction fails', async () => {
    const repositories = createRepositories(database);
    await repositories.experimentalFeatures.update(
      { paymentNotificationsEnabled: true },
      '2026-08-15T00:00:00.000Z',
    );
    const acknowledge = jest.fn(async () => undefined);
    NativeModules.PaymentNotificationCapture = {
      setCaptureEnabled: jest.fn(async () => ({
        supported: true,
        permissionGranted: true,
        captureEnabled: true,
        queuedCount: 1,
      })),
      listPending: jest.fn(async () => [
        {
          key: 'wechat|retry',
          packageName: 'com.tencent.mm',
          title: '微信支付',
          text: '付款成功 2.00元',
          postedAt: Date.parse('2026-08-15T08:00:00.000Z'),
        },
      ]),
      acknowledge,
    };
    jest
      .spyOn(repositories.paymentNotificationImports, 'commitMany')
      .mockRejectedValueOnce(new Error('simulated write failure'));

    await expect(
      importPendingPaymentNotificationsAutomatically(repositories),
    ).rejects.toThrow('simulated write failure');
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('drains a payment that arrives while the first batch is committing', async () => {
    const repositories = createRepositories(database);
    await repositories.experimentalFeatures.update(
      { paymentNotificationsEnabled: true },
      '2026-08-15T00:00:00.000Z',
    );
    const snapshots = [
      {
        key: 'wechat|first',
        packageName: 'com.tencent.mm',
        title: '微信支付',
        text: '付款成功 2.00元',
        postedAt: Date.parse('2026-08-15T08:00:00.000Z'),
      },
      {
        key: 'alipay|second',
        packageName: 'com.eg.android.AlipayGphone',
        title: '支付宝',
        text: '成功付款 3.00元',
        postedAt: Date.parse('2026-08-15T08:00:01.000Z'),
      },
    ] as const;
    let pass = 0;
    NativeModules.PaymentNotificationCapture = {
      setCaptureEnabled: jest.fn(async () => ({
        supported: true,
        permissionGranted: true,
        captureEnabled: true,
        queuedCount: pass < 2 ? 1 : 0,
      })),
      listPending: jest.fn(async () => (pass < 2 ? [snapshots[pass++]!] : [])),
      acknowledge: jest.fn(async () => undefined),
    };

    await expect(
      importPendingPaymentNotificationsAutomatically(repositories),
    ).resolves.toMatchObject({ capturedCount: 2, importedCount: 2 });
    const result = await database.execute<{ count: number }>(
      `SELECT COUNT(*) AS count FROM transactions
       WHERE source_reference_id LIKE 'notification:%'`,
    );
    expect(result.rows[0]?.count).toBe(2);
  });
});
