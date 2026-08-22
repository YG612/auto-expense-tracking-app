import { NativeModules } from 'react-native';

import {
  purgeTransientSensitiveData,
  SensitiveDataPurgeError,
} from '../native/SensitiveDataPurge';

describe('native sensitive-data purge', () => {
  afterEach(() => {
    delete NativeModules.PaymentNotificationCapture;
    delete NativeModules.AgentCommandInbox;
    delete NativeModules.SharedEntryPayload;
  });

  it('clears every native financial-text store', async () => {
    const clearPayment = jest.fn(async () => undefined);
    const clearAgent = jest.fn(async () => undefined);
    const clearSharedEntry = jest.fn(async () => undefined);
    NativeModules.PaymentNotificationCapture = { clear: clearPayment };
    NativeModules.AgentCommandInbox = { clear: clearAgent };
    NativeModules.SharedEntryPayload = { clear: clearSharedEntry };

    await expect(purgeTransientSensitiveData()).resolves.toBeUndefined();
    expect(clearPayment).toHaveBeenCalledTimes(1);
    expect(clearAgent).toHaveBeenCalledTimes(1);
    expect(clearSharedEntry).toHaveBeenCalledTimes(1);
  });

  it('attempts every store and reports an incomplete purge', async () => {
    const clearPayment = jest.fn(async () => {
      throw new Error('injected payment-store failure');
    });
    const clearAgent = jest.fn(async () => undefined);
    const clearSharedEntry = jest.fn(async () => undefined);
    NativeModules.PaymentNotificationCapture = { clear: clearPayment };
    NativeModules.AgentCommandInbox = { clear: clearAgent };
    NativeModules.SharedEntryPayload = { clear: clearSharedEntry };

    await expect(purgeTransientSensitiveData()).rejects.toMatchObject<
      Partial<SensitiveDataPurgeError>
    >({ failedStoreCount: 1 });
    expect(clearPayment).toHaveBeenCalledTimes(1);
    expect(clearAgent).toHaveBeenCalledTimes(1);
    expect(clearSharedEntry).toHaveBeenCalledTimes(1);
  });
});
