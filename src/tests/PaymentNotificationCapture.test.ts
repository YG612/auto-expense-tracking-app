import { NativeModules } from 'react-native';

import {
  acknowledgePaymentNotifications,
  listPendingPaymentNotifications,
} from '../native/PaymentNotificationCapture';

describe('PaymentNotificationCapture TypeScript boundary', () => {
  afterEach(() => {
    delete NativeModules.PaymentNotificationCapture;
  });

  it('lists without clearing and acknowledges only explicit keys', async () => {
    const listPending = jest.fn(async () => [
      {
        key: 'wechat|1',
        packageName: 'com.tencent.mm',
        title: '支付成功',
        text: '向公交集团支付 2 元',
        postedAt: 1,
      },
    ]);
    const acknowledge = jest.fn(async () => undefined);
    NativeModules.PaymentNotificationCapture = { listPending, acknowledge };

    await expect(listPendingPaymentNotifications()).resolves.toHaveLength(1);
    await acknowledgePaymentNotifications(['wechat|1']);

    expect(listPending).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledWith(['wechat|1']);
  });
});
