import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Android payment notification capture contract', () => {
  it('requires explicit notification-listener access and allowlists only payment providers', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const service = read(
      'android/app/src/main/java/com/qingjiai/notifications/PaymentNotificationCaptureService.kt',
    );
    const application = read(
      'android/app/src/main/java/com/qingjiai/MainApplication.kt',
    );

    expect(manifest).toContain(
      'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
    );
    expect(service).toContain('"com.tencent.mm"');
    expect(service).toContain('"com.eg.android.AlipayGphone"');
    expect(service).toContain('MAX_QUEUE_SIZE = 100');
    expect(service).toContain('MAX_ACKNOWLEDGED_KEYS = 500');
    expect(service).toContain('fun listPending()');
    expect(service).toContain('fun acknowledge(keys: Set<String>)');
    expect(service).not.toContain('fun drain()');
    expect(service).toContain('paymentCues');
    expect(service).not.toMatch(
      /SharedPreferences|SQLite|Room|FileOutputStream/u,
    );
    expect(application).toContain('add(PaymentNotificationCapturePackage())');
    const module = read(
      'android/app/src/main/java/com/qingjiai/notifications/PaymentNotificationCaptureModule.kt',
    );
    expect(module).toContain('fun listPending(promise: Promise)');
    expect(module).toContain('fun acknowledge(');
  });
});
