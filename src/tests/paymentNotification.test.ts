import { parsePaymentNotifications } from '../importers/paymentNotification';

describe('payment notification importer', () => {
  it('accepts only explicit settled-payment notifications and normalizes minimal candidates', () => {
    const previews = parsePaymentNotifications([
      {
        key: 'wechat-payment-1',
        packageName: 'com.tencent.mm',
        title: '微信支付',
        text: '支付成功，你在美团外卖支付￥23.80',
        postedAt: Date.parse('2026-08-14T02:00:00.000Z'),
      },
      {
        key: 'wechat-chat-1',
        packageName: 'com.tencent.mm',
        title: '朋友',
        text: '今晚吃饭吗？',
        postedAt: Date.parse('2026-08-14T02:01:00.000Z'),
      },
    ]);

    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      source: 'WECHAT',
      fileName: '微信支付通知',
    });
    expect(previews[0]?.candidates).toHaveLength(1);
    expect(previews[0]?.candidates[0]).toMatchObject({
      transactionSource: 'WECHAT_IMPORT',
      amountMinor: 2380,
      type: 'EXPENSE',
      merchantRawName: '美团外卖',
    });
    expect(previews[0]?.candidates[0]?.sourceReferenceId).toMatch(
      /^notification:[a-f0-9]{48}$/u,
    );
  });

  it('separates providers and recognizes refunds and income', () => {
    const previews = parsePaymentNotifications([
      {
        key: 'alipay-refund',
        packageName: 'com.eg.android.AlipayGphone',
        title: '支付宝',
        text: '退款成功，退款12.00元',
        postedAt: Date.parse('2026-08-14T03:00:00.000Z'),
      },
      {
        key: 'wechat-income',
        packageName: 'com.tencent.mm',
        title: '微信支付',
        text: '收款到账 88元',
        postedAt: Date.parse('2026-08-14T03:01:00.000Z'),
      },
    ]);

    expect(previews.map(preview => preview.source).sort()).toEqual([
      'ALIPAY',
      'WECHAT',
    ]);
    expect(
      previews.find(preview => preview.source === 'ALIPAY')?.candidates[0]
        ?.type,
    ).toBe('REFUND');
    expect(
      previews.find(preview => preview.source === 'WECHAT')?.candidates[0]
        ?.type,
    ).toBe('INCOME');
  });
});
