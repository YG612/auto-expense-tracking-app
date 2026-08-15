import { NativeModules } from 'react-native';

export type PaymentNotificationCaptureStatus = {
  supported: boolean;
  permissionGranted: boolean;
  captureEnabled: boolean;
  queuedCount: number;
};

export type PaymentNotificationSnapshot = {
  key: string;
  packageName: 'com.tencent.mm' | 'com.eg.android.AlipayGphone';
  title: string;
  text: string;
  postedAt: number;
};

type NativePaymentNotificationCapture = {
  getStatus(): Promise<PaymentNotificationCaptureStatus>;
  setCaptureEnabled(
    enabled: boolean,
  ): Promise<PaymentNotificationCaptureStatus>;
  openSettings(): Promise<void>;
  listPending(): Promise<unknown>;
  acknowledge(keys: string[]): Promise<void>;
  clear(): void;
};

function nativeModule(): NativePaymentNotificationCapture | undefined {
  return NativeModules.PaymentNotificationCapture as
    NativePaymentNotificationCapture | undefined;
}

function validStatus(value: PaymentNotificationCaptureStatus) {
  return (
    typeof value.supported === 'boolean' &&
    typeof value.permissionGranted === 'boolean' &&
    typeof value.captureEnabled === 'boolean' &&
    Number.isSafeInteger(value.queuedCount) &&
    value.queuedCount >= 0
  );
}

function snapshot(value: unknown): PaymentNotificationSnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const item = value as Partial<PaymentNotificationSnapshot>;
  if (
    typeof item.key !== 'string' ||
    item.key.length === 0 ||
    item.key.length > 512 ||
    !['com.tencent.mm', 'com.eg.android.AlipayGphone'].includes(
      item.packageName ?? '',
    ) ||
    typeof item.title !== 'string' ||
    item.title.length > 256 ||
    typeof item.text !== 'string' ||
    item.text.length > 2_000 ||
    typeof item.postedAt !== 'number' ||
    !Number.isSafeInteger(item.postedAt) ||
    item.postedAt <= 0
  ) {
    return undefined;
  }
  return item as PaymentNotificationSnapshot;
}

export async function getPaymentNotificationCaptureStatus(): Promise<PaymentNotificationCaptureStatus> {
  const module = nativeModule();
  if (module === undefined) {
    return {
      supported: false,
      permissionGranted: false,
      captureEnabled: false,
      queuedCount: 0,
    };
  }
  const status = await module.getStatus();
  if (!validStatus(status)) throw new Error('支付通知监听状态无效。');
  return status;
}

export async function setPaymentNotificationCaptureEnabled(
  enabled: boolean,
): Promise<PaymentNotificationCaptureStatus> {
  const module = nativeModule();
  if (module === undefined) {
    if (enabled) throw new Error('当前设备不支持支付通知自动记账。');
    return {
      supported: false,
      permissionGranted: false,
      captureEnabled: false,
      queuedCount: 0,
    };
  }
  const status = await module.setCaptureEnabled(enabled);
  if (!validStatus(status)) throw new Error('支付通知监听状态无效。');
  return status;
}

export async function openPaymentNotificationSettings(): Promise<void> {
  const module = nativeModule();
  if (module === undefined) throw new Error('当前设备不支持支付通知辅助记账。');
  await module.openSettings();
}

export async function listPendingPaymentNotifications(): Promise<
  PaymentNotificationSnapshot[]
> {
  const module = nativeModule();
  if (module === undefined) return [];
  const values = await module.listPending();
  if (!Array.isArray(values)) throw new Error('支付通知数据格式无效。');
  return values
    .map(snapshot)
    .filter((item): item is PaymentNotificationSnapshot => item !== undefined);
}

export async function acknowledgePaymentNotifications(
  keys: readonly string[],
): Promise<void> {
  const module = nativeModule();
  if (module === undefined || keys.length === 0) return;
  if (
    keys.length > 100 ||
    keys.some(key => key.length === 0 || key.length > 512)
  ) {
    throw new Error('支付通知确认键无效。');
  }
  await module.acknowledge([...new Set(keys)]);
}

export function clearPaymentNotifications(): void {
  nativeModule()?.clear();
}
