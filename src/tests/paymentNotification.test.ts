import { parsePaymentNotifications } from '../importers/paymentNotification';

describe('payment notification parsing', () => {
  it('extracts provider, merchant, amount and direction without persisting raw notifications', () => {
    const parsed = parsePaymentNotifications([
      {
        key: 'wechat|bus-1',
        packageName: 'com.tencent.mm',
        title: '微信支付',
        text: '向上海公共交通有限公司付款成功 2.00元',
        postedAt: Date.parse('2026-08-14T08:00:00.000Z'),
      },
      {
        key: 'alipay|income-1',
        packageName: 'com.eg.android.AlipayGphone',
        title: '支付宝',
        text: '收款成功 18.50元',
        postedAt: Date.parse('2026-08-14T09:00:00.000Z'),
      },
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      notificationKey: 'wechat|bus-1',
      transactionSource: 'WECHAT_IMPORT',
      amountMinor: 200,
      type: 'EXPENSE',
      merchantRawName: '上海公共交通有限公司',
    });
    expect(parsed[1]).toMatchObject({
      transactionSource: 'ALIPAY_IMPORT',
      amountMinor: 1850,
      type: 'INCOME',
    });
    expect(parsed[0]?.sourceReferenceId).toMatch(
      /^notification:[a-f0-9]{48}$/u,
    );
  });

  it('ignores unrelated or amount-free notifications', () => {
    expect(
      parsePaymentNotifications([
        {
          key: 'wechat|chat',
          packageName: 'com.tencent.mm',
          title: '朋友消息',
          text: '今晚见面吗',
          postedAt: 1,
        },
        {
          key: 'alipay|no-amount',
          packageName: 'com.eg.android.AlipayGphone',
          title: '支付成功',
          text: '查看交易详情',
          postedAt: 2,
        },
      ]),
    ).toEqual([]);
  });
});
