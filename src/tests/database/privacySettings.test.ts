import { createRepositories } from '../../database';
import { openMigratedTestDatabase } from './testDatabase';

describe('PrivacySettingsRepository', () => {
  it('starts private features disabled and persists allowed settings', async () => {
    const database = await openMigratedTestDatabase();
    try {
      const repository = createRepositories(database).privacySettings;
      await expect(repository.get()).resolves.toEqual({
        appLockEnabled: false,
        hideAmounts: false,
        lockTimeoutSeconds: 0,
        onboardingCompleted: false,
        firstBackupReminderDismissed: false,
        lastBackupAt: undefined,
        updatedAt: '2026-08-13T00:00:00.000Z',
      });
      await expect(
        repository.update(
          {
            appLockEnabled: true,
            hideAmounts: true,
            lockTimeoutSeconds: 60,
            onboardingCompleted: true,
            lastBackupAt: '2026-08-13T12:00:00.000Z',
          },
          '2026-08-13T12:01:00.000Z',
        ),
      ).resolves.toMatchObject({
        appLockEnabled: true,
        hideAmounts: true,
        lockTimeoutSeconds: 60,
        onboardingCompleted: true,
        lastBackupAt: '2026-08-13T12:00:00.000Z',
      });
    } finally {
      database.close();
    }
  });

  it('rejects unsupported lock timeouts before writing', async () => {
    const database = await openMigratedTestDatabase();
    try {
      const repository = createRepositories(database).privacySettings;
      await expect(
        repository.update(
          { lockTimeoutSeconds: 10 as never },
          '2026-08-13T12:00:00.000Z',
        ),
      ).rejects.toThrow('timeout is invalid');
      await expect(repository.get()).resolves.toMatchObject({
        lockTimeoutSeconds: 0,
      });
    } finally {
      database.close();
    }
  });
});
