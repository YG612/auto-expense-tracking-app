import {
  createLedgerStorageProtection,
  type LedgerStorageProtection,
} from '../../database/LedgerStorageProtection';
import { initializeAppDatabaseConnection } from '../../database';
import type { DatabaseConnection } from '../../database/types';

type PathAwareDatabaseConnection = DatabaseConnection & {
  getDatabasePath(): string;
};

function fakeDatabase(databasePath: string): PathAwareDatabaseConnection {
  return {
    getDatabasePath: () => databasePath,
    close: jest.fn(),
  } as unknown as PathAwareDatabaseConnection;
}

describe('iOS ledger storage protection', () => {
  it('passes the exact OP-SQLite path to the iOS native module', async () => {
    const applyProtection = jest.fn(async () => undefined);
    const protect = createLedgerStorageProtection('ios', {
      applyProtection,
    });
    const databasePath =
      '/private/var/mobile/Containers/Data/Application/APP/Library/qingji_ai.sqlite';

    await protect(databasePath);

    expect(applyProtection).toHaveBeenCalledTimes(1);
    expect(applyProtection).toHaveBeenCalledWith(databasePath);
  });

  it('is a no-op outside iOS without requiring an iOS native module', async () => {
    const protect = createLedgerStorageProtection('android', undefined);

    await expect(protect('/data/qingji_ai.sqlite')).resolves.toBeUndefined();
  });

  it('fails closed on iOS when the native protection module is unavailable', async () => {
    const protect = createLedgerStorageProtection('ios', undefined);

    await expect(protect('/Library/qingji_ai.sqlite')).rejects.toThrow(
      'storage protection module is unavailable',
    );
  });

  it('reapplies protection after open, WAL configuration, and migrations', async () => {
    const events: string[] = [];
    const databasePath = '/Library/qingji_ai.sqlite';
    const database = fakeDatabase(databasePath);
    const protect: LedgerStorageProtection = async path => {
      events.push(`protect:${path}`);
    };

    await initializeAppDatabaseConnection(database, {
      protect,
      configure: async value => {
        expect(value).toBe(database);
        events.push('configure');
      },
      migrate: async value => {
        expect(value).toBe(database);
        events.push('migrate');
      },
    });

    expect(events).toEqual([
      `protect:${databasePath}`,
      'configure',
      `protect:${databasePath}`,
      'migrate',
      `protect:${databasePath}`,
    ]);
  });

  it('still reapplies protection when a WAL-producing migration fails', async () => {
    const events: string[] = [];
    const databasePath = '/Library/qingji_ai.sqlite';
    const database = fakeDatabase(databasePath);
    const migrationError = new Error('migration failed');

    await expect(
      initializeAppDatabaseConnection(database, {
        protect: async path => {
          events.push(`protect:${path}`);
        },
        configure: async () => {
          events.push('configure');
        },
        migrate: async () => {
          events.push('migrate');
          throw migrationError;
        },
      }),
    ).rejects.toBe(migrationError);

    expect(events).toEqual([
      `protect:${databasePath}`,
      'configure',
      `protect:${databasePath}`,
      'migrate',
      `protect:${databasePath}`,
    ]);
  });
});
