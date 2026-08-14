import { NativeModules } from 'react-native';

import { AppError } from '../domain/errors/AppError';
import { utf8ByteLength } from '../utils/utf8ByteLength';

export const MIN_BACKUP_PASSPHRASE_CHARACTERS = 8;
export const MAX_BACKUP_PASSPHRASE_CHARACTERS = 256;
export const MAX_BACKUP_PLAINTEXT_BYTES = 32 * 1024 * 1024;
export const MAX_ENCRYPTED_BACKUP_BYTES = 50 * 1024 * 1024;

function backupSizeError(): AppError {
  return new AppError(
    'BACKUP-SIZE-LIMIT',
    '账本备份超过 32 MiB 上限，请改用分批 CSV 导出。',
    { category: 'VALIDATION', retryable: false },
  );
}

function encryptedBackupSizeError(): AppError {
  return new AppError(
    'ENCRYPTED-BACKUP-SIZE-LIMIT',
    '加密备份超过 50 MiB 上限，请改用分批 CSV 导出。',
    { category: 'VALIDATION', retryable: false },
  );
}

type NativeLedgerBackupCrypto = {
  encrypt(plaintext: string, passphrase: string): Promise<string>;
  decrypt(envelope: string, passphrase: string): Promise<string>;
};

function nativeCrypto(): NativeLedgerBackupCrypto {
  const module = NativeModules.LedgerBackupCrypto as
    NativeLedgerBackupCrypto | undefined;
  if (module === undefined) {
    throw new Error('Encrypted ledger backup is unavailable on this build.');
  }
  return module;
}

function validatePassphrase(passphrase: string): void {
  const length = [...passphrase].length;
  if (
    length < MIN_BACKUP_PASSPHRASE_CHARACTERS ||
    length > MAX_BACKUP_PASSPHRASE_CHARACTERS
  ) {
    throw new Error(
      `Backup passphrase must contain ${MIN_BACKUP_PASSPHRASE_CHARACTERS} to ${MAX_BACKUP_PASSPHRASE_CHARACTERS} characters.`,
    );
  }
}

export async function encryptLedgerBackup(
  plaintext: string,
  passphrase: string,
): Promise<string> {
  validatePassphrase(passphrase);
  if (
    plaintext.length === 0 ||
    utf8ByteLength(plaintext) > MAX_BACKUP_PLAINTEXT_BYTES
  ) {
    throw backupSizeError();
  }
  const encrypted = await nativeCrypto().encrypt(plaintext, passphrase);
  if (utf8ByteLength(encrypted) > MAX_ENCRYPTED_BACKUP_BYTES) {
    throw encryptedBackupSizeError();
  }
  return encrypted;
}

export async function decryptLedgerBackup(
  envelope: string,
  passphrase: string,
): Promise<string> {
  validatePassphrase(passphrase);
  if (
    envelope.length === 0 ||
    utf8ByteLength(envelope) > MAX_ENCRYPTED_BACKUP_BYTES
  ) {
    throw encryptedBackupSizeError();
  }
  return nativeCrypto().decrypt(envelope, passphrase);
}
