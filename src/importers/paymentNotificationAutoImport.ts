import {
  createRepositories,
  getAppDatabase,
  type Repositories,
} from '../database';
import {
  acknowledgePaymentNotifications,
  listPendingPaymentNotifications,
  notifyPendingPaymentNotificationReview,
  setPaymentNotificationCaptureEnabled,
} from '../native/PaymentNotificationCapture';
import { analyzePaymentNotifications } from './paymentNotificationAnalysis';
import { parsePaymentNotifications } from './paymentNotification';

export type PaymentNotificationAutoImportResult = {
  capturedCount: number;
  importedCount: number;
  ignoredCount: number;
  duplicateBatch: boolean;
};

let importInFlight: Promise<PaymentNotificationAutoImportResult> | undefined;
const MAX_DRAIN_PASSES = 4;

async function runImport(
  repositories: Repositories,
): Promise<PaymentNotificationAutoImportResult> {
  const settings = await repositories.experimentalFeatures.get();
  await setPaymentNotificationCaptureEnabled(
    settings.paymentNotificationsEnabled,
  );
  if (!settings.paymentNotificationsEnabled) {
    return {
      capturedCount: 0,
      importedCount: 0,
      ignoredCount: 0,
      duplicateBatch: false,
    };
  }

  const snapshots = await listPendingPaymentNotifications();
  const parsed = parsePaymentNotifications(snapshots);
  if (snapshots.length === 0) {
    return {
      capturedCount: 0,
      importedCount: 0,
      ignoredCount: 0,
      duplicateBatch: false,
    };
  }

  const analyzed = await analyzePaymentNotifications(
    repositories,
    parsed,
    new Date().toISOString(),
  );
  const result = await repositories.paymentNotificationImports.commitMany(
    analyzed,
    new Date().toISOString(),
  );

  // Once every parseable item has committed atomically, discard the entire captured batch.
  // Amount-free or unsupported variants must not retain raw financial notifications forever.
  await acknowledgePaymentNotifications(snapshots.map(item => item.key));
  if (result.transactionIds.length > 0) {
    // Review alerts are optional presentation. A denied notification permission must never roll
    // back a committed ledger candidate or retain the raw provider notification.
    await notifyPendingPaymentNotificationReview(
      result.transactionIds.length,
    ).catch(() => false);
  }
  return {
    capturedCount: snapshots.length,
    importedCount: result.transactionIds.length,
    ignoredCount: snapshots.length - parsed.length,
    duplicateBatch: result.duplicateBatch,
  };
}

export function importPendingPaymentNotificationsAutomatically(
  repositories: Repositories,
): Promise<PaymentNotificationAutoImportResult> {
  if (importInFlight !== undefined) return importInFlight;
  importInFlight = (async () => {
    const aggregate: PaymentNotificationAutoImportResult = {
      capturedCount: 0,
      importedCount: 0,
      ignoredCount: 0,
      duplicateBatch: false,
    };
    for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
      const current = await runImport(repositories);
      aggregate.capturedCount += current.capturedCount;
      aggregate.importedCount += current.importedCount;
      aggregate.ignoredCount += current.ignoredCount;
      aggregate.duplicateBatch ||= current.duplicateBatch;
      if (current.capturedCount === 0) break;
    }
    return aggregate;
  })().finally(() => {
    importInFlight = undefined;
  });
  return importInFlight;
}

export async function runPaymentNotificationHeadlessTask(): Promise<void> {
  try {
    const database = await getAppDatabase();
    await importPendingPaymentNotificationsAutomatically(
      createRepositories(database),
    );
  } catch {
    // The durable native outbox is intentionally left untouched for foreground retry.
  }
}
