import { DefaultTheme, type Theme } from '@react-navigation/native';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from '../navigation/RootNavigator';
import { AppErrorBoundary } from './AppErrorBoundary';
import { DatabaseProvider, type DatabaseFactory } from './DatabaseProvider';
import { PrivacyGate } from './PrivacyGate';

const appTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#2563EB',
    background: '#F8FAFC',
    card: '#FFFFFF',
    text: '#0F172A',
    border: '#E2E8F0',
    notification: '#DC2626',
  },
};

type AppProps = {
  databaseFactory?: DatabaseFactory;
};

export default function App({ databaseFactory }: AppProps) {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <AppErrorBoundary>
        <DatabaseProvider databaseFactory={databaseFactory}>
          <PrivacyGate>
            <RootNavigator theme={appTheme} />
          </PrivacyGate>
        </DatabaseProvider>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}
