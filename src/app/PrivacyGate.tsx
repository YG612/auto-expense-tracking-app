import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PrivacySettings } from '../domain/entities';
import { safeErrorMessage } from '../domain/errors/AppError';
import {
  authenticatePrivacyProtection,
  hidePrivacyOverlay,
  setScreenCaptureProtected,
} from '../native/PrivacyProtection';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { useRepositories } from './DatabaseProvider';
import { OnboardingScreen } from './OnboardingScreen';

type PrivacyContextValue = {
  settings: PrivacySettings;
  updateSettings(
    patch: Parameters<
      ReturnType<typeof useRepositories>['privacySettings']['update']
    >[0],
  ): Promise<PrivacySettings>;
  reloadSettings(): Promise<PrivacySettings>;
};

const PrivacyContext = createContext<PrivacyContextValue | undefined>(
  undefined,
);

export function usePrivacySettings(): PrivacyContextValue {
  const value = useContext(PrivacyContext);
  if (value === undefined) {
    throw new Error('usePrivacySettings must be used inside PrivacyGate.');
  }
  return value;
}

export function PrivacyGate({ children }: { children: ReactNode }) {
  const repositories = useRepositories();
  const [settings, setSettings] = useState<PrivacySettings>();
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string>();
  const backgroundedAt = useRef<number | undefined>(undefined);
  const authenticating = useRef(false);

  useEffect(() => {
    let active = true;
    repositories.privacySettings
      .get()
      .then(value => {
        if (!active) return;
        setSettings(value);
        setLocked(value.appLockEnabled);
        if (value.appLockEnabled) {
          setScreenCaptureProtected(true).catch(() => undefined);
        }
      })
      .catch(loadError => {
        if (active) {
          setError(
            safeErrorMessage(
              loadError,
              '读取隐私设置失败。',
              'PRIVACY-SETTINGS-LOAD-UNEXPECTED',
            ),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [repositories]);

  useEffect(() => {
    if (locked) {
      // Effects run only after the React lock screen has committed, so iOS can
      // safely remove the app-switcher overlay without flashing ledger data.
      hidePrivacyOverlay().catch(() => undefined);
    }
  }, [locked]);

  useEffect(() => {
    if (settings === undefined) return undefined;
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        if (!authenticating.current && backgroundedAt.current === undefined) {
          backgroundedAt.current = Date.now();
        }
        return;
      }
      if (nextState === 'active' && settings.appLockEnabled) {
        const leftAt = backgroundedAt.current;
        backgroundedAt.current = undefined;
        const shouldLock =
          !authenticating.current &&
          leftAt !== undefined &&
          Date.now() - leftAt >= settings.lockTimeoutSeconds * 1000;
        if (shouldLock) {
          setLocked(true);
        } else {
          hidePrivacyOverlay().catch(() => undefined);
        }
      }
    };
    const subscription = AppState.addEventListener('change', handleAppState);
    return () => subscription.remove();
  }, [settings]);

  const updateSettings = useCallback(
    async (
      patch: Parameters<typeof repositories.privacySettings.update>[0],
    ) => {
      const updated = await repositories.privacySettings.update(
        patch,
        new Date().toISOString(),
      );
      setSettings(updated);
      if (!updated.appLockEnabled) {
        setLocked(false);
        await setScreenCaptureProtected(false).catch(() => undefined);
      } else {
        await setScreenCaptureProtected(true);
      }
      return updated;
    },
    [repositories],
  );

  const reloadSettings = useCallback(async () => {
    const updated = await repositories.privacySettings.get();
    setSettings(updated);
    setLocked(updated.appLockEnabled);
    if (updated.appLockEnabled) {
      await setScreenCaptureProtected(true);
    } else {
      await setScreenCaptureProtected(false).catch(() => undefined);
    }
    return updated;
  }, [repositories]);

  const unlock = async () => {
    setUnlocking(true);
    setError(undefined);
    authenticating.current = true;
    try {
      const result =
        await authenticatePrivacyProtection('验证身份以查看本机账本');
      if (result.status === 'AUTHENTICATED') setLocked(false);
    } catch (unlockError) {
      setError(
        safeErrorMessage(
          unlockError,
          '无法完成系统身份验证。',
          'PRIVACY-AUTH-UNEXPECTED',
        ),
      );
    } finally {
      authenticating.current = false;
      backgroundedAt.current = undefined;
      setUnlocking(false);
    }
  };

  if (settings === undefined) {
    return (
      <SafeAreaView style={styles.centered}>
        {error === undefined ? (
          <ActivityIndicator color={colors.brand} size="large" />
        ) : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </SafeAreaView>
    );
  }

  if (locked) {
    return (
      <SafeAreaView style={styles.centered}>
        <View style={styles.lockCard}>
          <Text accessibilityRole="header" style={styles.title}>
            账本已锁定
          </Text>
          <Text style={styles.description}>
            使用设备生物识别、锁屏密码或设备凭据解锁。轻记 AI
            不保存你的系统凭据。
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={unlocking}
            onPress={unlock}
            style={[styles.button, unlocking && styles.disabled]}
          >
            {unlocking ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>解锁账本</Text>
            )}
          </Pressable>
          {error === undefined ? null : (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (!settings.onboardingCompleted) {
    return (
      <PrivacyContext.Provider
        value={{ settings, updateSettings, reloadSettings }}
      >
        <OnboardingScreen
          onComplete={async () => {
            await updateSettings({ onboardingCompleted: true });
          }}
        />
      </PrivacyContext.Provider>
    );
  }

  return (
    <PrivacyContext.Provider
      value={{ settings, updateSettings, reloadSettings }}
    >
      {children}
    </PrivacyContext.Provider>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
    padding: spacing.lg,
  },
  lockCard: {
    width: '100%',
    maxWidth: 420,
    gap: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    padding: spacing.xl,
  },
  title: {
    color: colors.ink,
    fontSize: typography.pageTitle,
    fontWeight: '900',
  },
  description: { color: colors.inkSecondary, lineHeight: 22 },
  button: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  buttonText: { color: colors.white, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  error: { color: colors.expenseText, lineHeight: 20, textAlign: 'center' },
});
