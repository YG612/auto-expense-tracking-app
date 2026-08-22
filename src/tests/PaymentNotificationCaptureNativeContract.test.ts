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
    const classifier = read(
      'android/app/src/main/java/com/qingjiai/notifications/PaymentNotificationClassifier.kt',
    );
    const application = read(
      'android/app/src/main/java/com/qingjiai/MainApplication.kt',
    );
    const entrypoint = read('index.js');

    expect(manifest).toContain(
      'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
    );
    expect(manifest).toMatch(
      /PaymentNotificationCaptureService[\s\S]*?android:exported="false"/u,
    );
    expect(manifest).toMatch(
      /android:name="android\.permission\.INTERNET"[\s\S]*?tools:node="remove"/u,
    );
    expect(manifest).toMatch(
      /android:name="android\.permission\.ACCESS_NETWORK_STATE"[\s\S]*?tools:node="remove"/u,
    );
    expect(classifier).toContain('"com.tencent.mm"');
    expect(classifier).toContain('"com.eg.android.AlipayGphone"');
    expect(service).toContain('PaymentNotificationStore(this)');
    expect(service).toContain(
      'PaymentNotificationImportScheduler.schedule(this)',
    );
    expect(service).not.toContain('activeNotifications');
    const store = read(
      'android/app/src/main/java/com/qingjiai/notifications/PaymentNotificationStore.kt',
    );
    expect(store).toContain('noBackupFilesDir');
    expect(store).toContain('AtomicFile');
    expect(store).toContain('MAX_QUEUE_SIZE = 100');
    expect(store).toContain('MAX_AGE_MILLIS');
    expect(store).toContain('fun acknowledge(keys: Set<String>)');
    expect(store).toContain('if (!enabled) outbox.delete()');
    expect(store).toContain('current[existingIndex] = snapshot');
    expect(application).toContain('add(PaymentNotificationCapturePackage())');
    const module = read(
      'android/app/src/main/java/com/qingjiai/notifications/PaymentNotificationCaptureModule.kt',
    );
    expect(module).toContain('fun listPending(promise: Promise)');
    expect(module).toContain('fun acknowledge(');
    expect(module).toContain('fun setCaptureEnabled(');
    expect(module).toContain('fun notifyPendingReview(');
    expect(module).toContain('fun clear(promise: Promise)');
    expect(module).toContain('store.setEnabled(false)');
    expect(module).toContain(
      'PaymentNotificationImportScheduler.cancel(reactContext)',
    );
    expect(module).toContain('cancel(REVIEW_NOTIFICATION_ID)');
    expect(module).toContain('Uri.parse("qingjiai://pending")');
    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(manifest).toMatch(
      /PaymentNotificationImportJobService[\s\S]*?android\.permission\.BIND_JOB_SERVICE/u,
    );
    const scheduler = read(
      'android/app/src/main/java/com/qingjiai/notifications/PaymentNotificationImportScheduler.kt',
    );
    const jobService = read(
      'android/app/src/main/java/com/qingjiai/notifications/PaymentNotificationImportJobService.kt',
    );
    expect(scheduler).toContain('JobScheduler');
    expect(scheduler).toContain('BACKOFF_POLICY_EXPONENTIAL');
    expect(jobService).toContain('HeadlessJsTaskContext');
    expect(jobService).toContain('store.queuedCount() > 0');
    expect(jobService).toContain('jobFinished(currentParameters, retry)');
    expect(entrypoint).toContain("'PaymentNotificationAutoImport'");
    expect(entrypoint).toContain('registerHeadlessTask');
  });
});
