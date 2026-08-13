import { NativeModules, Platform } from 'react-native';

export type LedgerStorageProtection = (databasePath: string) => Promise<void>;

type NativeLedgerStorageProtection = {
  applyProtection(databasePath: string): Promise<unknown>;
};

export function createLedgerStorageProtection(
  platform: string,
  nativeModule: NativeLedgerStorageProtection | undefined,
): LedgerStorageProtection {
  if (platform !== 'ios') {
    return async () => undefined;
  }

  return async databasePath => {
    if (databasePath.trim().length === 0) {
      throw new Error('The iOS ledger database path is empty.');
    }
    if (nativeModule === undefined) {
      throw new Error(
        'The iOS ledger storage protection module is unavailable.',
      );
    }

    await nativeModule.applyProtection(databasePath);
  };
}

export const protectLedgerStorage = createLedgerStorageProtection(
  Platform.OS,
  NativeModules.LedgerStorageProtection as
    NativeLedgerStorageProtection | undefined,
);
