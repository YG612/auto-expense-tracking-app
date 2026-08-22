/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { runPaymentNotificationHeadlessTask } from './src/importers/paymentNotificationAutoImport';

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask(
  'PaymentNotificationAutoImport',
  () => runPaymentNotificationHeadlessTask,
);
