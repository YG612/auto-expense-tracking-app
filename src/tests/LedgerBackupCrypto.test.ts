import { NativeModules } from 'react-native';

import {
  MAX_BACKUP_PLAINTEXT_BYTES,
  MAX_ENCRYPTED_BACKUP_BYTES,
  decryptLedgerBackup,
  encryptLedgerBackup,
} from '../native/LedgerBackupCrypto';

describe('LedgerBackupCrypto TypeScript boundary', () => {
  afterEach(() => {
    delete NativeModules.LedgerBackupCrypto;
  });

  it('passes the passphrase only to the native encryption operation', async () => {
    const encrypt = jest.fn(async () => '{"encrypted":true}');
    const decrypt = jest.fn(async () => '{"ledger":true}');
    NativeModules.LedgerBackupCrypto = { encrypt, decrypt };

    await expect(
      encryptLedgerBackup('{"ledger":true}', '正确马电池订书钉'),
    ).resolves.toBe('{"encrypted":true}');
    await expect(
      decryptLedgerBackup('{"encrypted":true}', '正确马电池订书钉'),
    ).resolves.toBe('{"ledger":true}');
    expect(encrypt).toHaveBeenCalledWith('{"ledger":true}', '正确马电池订书钉');
    expect(decrypt).toHaveBeenCalledWith(
      '{"encrypted":true}',
      '正确马电池订书钉',
    );
  });

  it('rejects weak passphrases before invoking native code', async () => {
    NativeModules.LedgerBackupCrypto = {
      encrypt: jest.fn(),
      decrypt: jest.fn(),
    };

    await expect(encryptLedgerBackup('{}', '1234567')).rejects.toThrow(
      '8 to 256 characters',
    );
    expect(NativeModules.LedgerBackupCrypto.encrypt).not.toHaveBeenCalled();
  });

  it('enforces the 32 MiB plaintext and 50 MiB envelope UTF-8 byte limits', async () => {
    const encrypt = jest.fn(async () => '{}');
    const decrypt = jest.fn(async () => '{}');
    NativeModules.LedgerBackupCrypto = { encrypt, decrypt };
    const exactPlaintext =
      '\u0800'.repeat(Math.floor(MAX_BACKUP_PLAINTEXT_BYTES / 3)) + 'aa';
    const oversizedPlaintext = `${exactPlaintext}a`;

    await expect(
      encryptLedgerBackup(exactPlaintext, 'correct horse battery staple'),
    ).resolves.toBe('{}');
    await expect(
      encryptLedgerBackup(oversizedPlaintext, 'correct horse battery staple'),
    ).rejects.toThrow('32 MiB');
    expect(encrypt).toHaveBeenCalledTimes(1);

    const exactEnvelope =
      '\u0800'.repeat(Math.floor(MAX_ENCRYPTED_BACKUP_BYTES / 3)) + 'aa';
    await expect(
      decryptLedgerBackup(exactEnvelope, 'correct horse battery staple'),
    ).resolves.toBe('{}');
    await expect(
      decryptLedgerBackup(`${exactEnvelope}a`, 'correct horse battery staple'),
    ).rejects.toThrow('50 MiB');
    expect(decrypt).toHaveBeenCalledTimes(1);
  });
});
