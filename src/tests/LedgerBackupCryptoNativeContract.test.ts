import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

describe('encrypted ledger backup native contract', () => {
  it('pins authenticated Android encryption parameters and clears derived keys', () => {
    const module = read(
      'android/app/src/main/java/com/qingjiai/backup/LedgerBackupCryptoModule.kt',
    );
    const application = read(
      'android/app/src/main/java/com/qingjiai/MainApplication.kt',
    );

    expect(module).toContain('PBKDF2WithHmacSHA256');
    expect(module).toContain('AES/GCM/NoPadding');
    expect(module).toContain('PBKDF2_ITERATIONS = 310_000');
    expect(module).toContain('KEY_BITS = 256');
    expect(module).toContain('GCMParameterSpec(TAG_BITS, nonce)');
    expect(module).toContain('cipher.updateAAD(ASSOCIATED_DATA)');
    expect(module).toContain('Arrays.fill(key, 0.toByte())');
    expect(module).toContain('MAX_PLAINTEXT_BYTES = 32 * 1024 * 1024');
    expect(module).toContain('MAX_ENVELOPE_BYTES = 50 * 1024 * 1024');
    expect(module).not.toMatch(/Log\.|println\(|print\(/u);
    expect(application).toContain('add(LedgerBackupCryptoPackage())');
  });

  it('uses the same envelope, KDF, AAD and authenticated cipher on iOS', () => {
    const module = read('ios/QingJiAI/LedgerBackupCrypto.swift');
    const bridge = read('ios/QingJiAI/LedgerBackupCryptoBridge.m');
    const project = read('ios/QingJiAI.xcodeproj/project.pbxproj');

    expect(module).toContain('PBKDF2-HMAC-SHA256');
    expect(module).toContain('AES-256-GCM');
    expect(module).toContain('static let iterations = 310_000');
    expect(module).toContain('CCKeyDerivationPBKDF');
    expect(module).toContain('AES.GCM.seal');
    expect(module).toContain('authenticating: Contract.associatedData');
    expect(module).toContain('derivedKey.resetBytes');
    expect(module).toContain('maximumPlaintextBytes = 32 * 1024 * 1024');
    expect(module).toContain('maximumEnvelopeBytes = 50 * 1024 * 1024');
    expect(bridge).toContain('RCT_EXTERN_MODULE(LedgerBackupCrypto, NSObject)');
    expect(project).toContain('LedgerBackupCrypto.swift in Sources');
    expect(project).toContain('LedgerBackupCryptoBridge.m in Sources');
  });
});
