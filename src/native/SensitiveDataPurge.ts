import { clearAgentCommandInbox } from './AgentCommandInbox';
import { clearPaymentNotifications } from './PaymentNotificationCapture';
import { clearSharedEntryPayloads } from './SharedEntryPayload';

export class SensitiveDataPurgeError extends Error {
  constructor(readonly failedStoreCount: number) {
    super('One or more native sensitive-data stores could not be cleared.');
    this.name = 'SensitiveDataPurgeError';
  }
}

export async function purgeTransientSensitiveData(): Promise<void> {
  const results = await Promise.allSettled([
    clearPaymentNotifications(),
    clearAgentCommandInbox(),
    clearSharedEntryPayloads(),
  ]);
  const failedStoreCount = results.filter(
    result => result.status === 'rejected',
  ).length;
  if (failedStoreCount > 0) {
    throw new SensitiveDataPurgeError(failedStoreCount);
  }
}
