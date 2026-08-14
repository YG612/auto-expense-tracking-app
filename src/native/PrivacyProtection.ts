import { NativeModules } from 'react-native';

type NativePrivacyProtection = {
  getCapabilities(): Promise<PrivacyProtectionCapabilities>;
  authenticate(reason: string): Promise<PrivacyAuthenticationResult>;
  setScreenCaptureProtected(enabled: boolean): Promise<void>;
};

export type PrivacyProtectionCapabilities = {
  available: boolean;
  method: 'DEVICE_OWNER_AUTHENTICATION' | 'NONE';
};

export type PrivacyAuthenticationResult =
  { status: 'AUTHENTICATED' } | { status: 'CANCELLED' };

function nativeProtection(): NativePrivacyProtection {
  const module = NativeModules.PrivacyProtection as
    NativePrivacyProtection | undefined;
  if (module === undefined) {
    throw new Error('Privacy protection is unavailable on this build.');
  }
  return module;
}

export async function getPrivacyProtectionCapabilities(): Promise<PrivacyProtectionCapabilities> {
  const result = await nativeProtection().getCapabilities();
  if (
    typeof result.available !== 'boolean' ||
    !['DEVICE_OWNER_AUTHENTICATION', 'NONE'].includes(result.method)
  ) {
    throw new Error('Privacy protection returned invalid capabilities.');
  }
  return result;
}

export async function authenticatePrivacyProtection(
  reason: string,
): Promise<PrivacyAuthenticationResult> {
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0 || trimmedReason.length > 120) {
    throw new Error('Privacy authentication reason is invalid.');
  }
  const result = await nativeProtection().authenticate(trimmedReason);
  if (result.status !== 'AUTHENTICATED' && result.status !== 'CANCELLED') {
    throw new Error('Privacy authentication returned an invalid result.');
  }
  return result;
}

export async function setScreenCaptureProtected(
  enabled: boolean,
): Promise<void> {
  await nativeProtection().setScreenCaptureProtected(enabled);
}
