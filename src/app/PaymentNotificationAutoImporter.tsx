import { useEffect } from 'react';
import { AppState } from 'react-native';

import { importPendingPaymentNotificationsAutomatically } from '../importers/paymentNotificationAutoImport';
import { useRepositories } from './DatabaseProvider';

export function PaymentNotificationAutoImporter() {
  const repositories = useRepositories();

  useEffect(() => {
    const importPending = () => {
      importPendingPaymentNotificationsAutomatically(repositories).catch(
        () => undefined,
      );
    };
    importPending();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') importPending();
    });
    return () => subscription.remove();
  }, [repositories]);

  return null;
}
