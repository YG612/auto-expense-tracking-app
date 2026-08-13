import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  createRepositories,
  getAppDatabase,
  type DatabaseConnection,
  type Repositories,
} from '../database';
import { safeErrorMessage } from '../domain/errors/AppError';

export type DatabaseFactory = () => Promise<DatabaseConnection>;

type DatabaseProviderProps = {
  children: ReactNode;
  databaseFactory?: DatabaseFactory;
};

type DatabaseState =
  | { status: 'loading' }
  | { status: 'ready'; repositories: Repositories }
  | { status: 'error'; message: string };

const RepositoriesContext = createContext<Repositories | undefined>(undefined);

export function DatabaseProvider({
  children,
  databaseFactory = getAppDatabase,
}: DatabaseProviderProps) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DatabaseState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });

    databaseFactory()
      .then(database => {
        if (active) {
          setState({
            status: 'ready',
            repositories: createRepositories(database),
          });
        }
      })
      .catch(error => {
        if (active) {
          setState({
            status: 'error',
            message: safeErrorMessage(
              error,
              '无法打开本地账本，请重试。',
              'DB-INIT-UNEXPECTED',
            ),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [attempt, databaseFactory]);

  const content = useMemo(() => {
    if (state.status === 'loading') {
      return (
        <SafeAreaView style={styles.centered}>
          <ActivityIndicator color="#2563EB" size="large" />
          <Text style={styles.statusText}>正在准备本地账本…</Text>
        </SafeAreaView>
      );
    }

    if (state.status === 'error') {
      return (
        <SafeAreaView style={styles.centered}>
          <View style={styles.errorCard}>
            <Text accessibilityRole="header" style={styles.errorTitle}>
              本地账本初始化失败
            </Text>
            <Text style={styles.errorMessage}>{state.message}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setAttempt(value => value + 1)}
              style={styles.retryButton}
            >
              <Text style={styles.retryButtonText}>重试</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      );
    }

    return (
      <RepositoriesContext.Provider value={state.repositories}>
        {children}
      </RepositoriesContext.Provider>
    );
  }, [children, state]);

  return content;
}

export function useRepositories(): Repositories {
  const repositories = useContext(RepositoriesContext);

  if (repositories === undefined) {
    throw new Error('useRepositories must be used inside DatabaseProvider.');
  }

  return repositories;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: '#F8FAFC',
    padding: 24,
  },
  statusText: {
    color: '#475569',
    fontSize: 15,
  },
  errorCard: {
    width: '100%',
    gap: 12,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  errorTitle: {
    color: '#991B1B',
    fontSize: 20,
    fontWeight: '700',
  },
  errorMessage: {
    color: '#475569',
    lineHeight: 22,
  },
  retryButton: {
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#2563EB',
    paddingVertical: 12,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
