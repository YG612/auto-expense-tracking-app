export const PRIVACY_LOCK_TIMEOUT_SECONDS = [0, 30, 60, 300] as const;

export type PrivacyLockTimeoutSeconds =
  (typeof PRIVACY_LOCK_TIMEOUT_SECONDS)[number];

export interface PrivacySettings {
  appLockEnabled: boolean;
  hideAmounts: boolean;
  lockTimeoutSeconds: PrivacyLockTimeoutSeconds;
  onboardingCompleted: boolean;
  firstBackupReminderDismissed: boolean;
  lastBackupAt?: string;
  updatedAt: string;
}
