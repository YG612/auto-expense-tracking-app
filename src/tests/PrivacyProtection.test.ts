import { NativeModules } from 'react-native';

import {
  authenticatePrivacyProtection,
  getPrivacyProtectionCapabilities,
  setScreenCaptureProtected,
} from '../native/PrivacyProtection';

describe('PrivacyProtection TypeScript boundary', () => {
  afterEach(() => {
    delete NativeModules.PrivacyProtection;
  });

  it('validates native capabilities and authentication results', async () => {
    const getCapabilities = jest.fn(async () => ({
      available: true,
      method: 'DEVICE_OWNER_AUTHENTICATION' as const,
    }));
    const authenticate = jest.fn(async () => ({
      status: 'AUTHENTICATED' as const,
    }));
    const setProtected = jest.fn(async () => undefined);
    NativeModules.PrivacyProtection = {
      getCapabilities,
      authenticate,
      setScreenCaptureProtected: setProtected,
    };

    await expect(getPrivacyProtectionCapabilities()).resolves.toEqual({
      available: true,
      method: 'DEVICE_OWNER_AUTHENTICATION',
    });
    await expect(
      authenticatePrivacyProtection('  验证身份以查看账本  '),
    ).resolves.toEqual({ status: 'AUTHENTICATED' });
    expect(authenticate).toHaveBeenCalledWith('验证身份以查看账本');
    await expect(setScreenCaptureProtected(true)).resolves.toBeUndefined();
    expect(setProtected).toHaveBeenCalledWith(true);
  });

  it('rejects missing modules, invalid reasons and malformed native values', async () => {
    await expect(getPrivacyProtectionCapabilities()).rejects.toThrow(
      'unavailable on this build',
    );
    await expect(authenticatePrivacyProtection(' ')).rejects.toThrow(
      'reason is invalid',
    );

    NativeModules.PrivacyProtection = {
      getCapabilities: async () => ({ available: 'yes', method: 'FACE' }),
      authenticate: async () => ({ status: 'FAILED' }),
      setScreenCaptureProtected: async () => undefined,
    };
    await expect(getPrivacyProtectionCapabilities()).rejects.toThrow(
      'invalid capabilities',
    );
    await expect(authenticatePrivacyProtection('验证')).rejects.toThrow(
      'invalid result',
    );
  });
});
