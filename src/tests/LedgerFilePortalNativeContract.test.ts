import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

describe('ledger system file portal native contract', () => {
  it('uses Android Storage Access Framework without broad storage access', () => {
    const module = read(
      'android/app/src/main/java/com/qingjiai/files/LedgerFilePortalModule.kt',
    );
    const application = read(
      'android/app/src/main/java/com/qingjiai/MainApplication.kt',
    );
    const manifest = read('android/app/src/main/AndroidManifest.xml');

    expect(module).toContain('Intent.ACTION_CREATE_DOCUMENT');
    expect(module).toContain('Intent.ACTION_OPEN_DOCUMENT');
    expect(module).toContain('Intent.CATEGORY_OPENABLE');
    expect(module).toContain('contentResolver.openOutputStream');
    expect(module).toContain('contentResolver.openInputStream');
    expect(module).toContain('OpenableColumns.DISPLAY_NAME');
    expect(module).toContain('Base64.encodeToString');
    expect(module).toContain('Activity.RESULT_CANCELED');
    expect(module).toContain('MAX_TEXT_BYTES = 50 * 1024 * 1024');
    expect(application).toContain('add(LedgerFilePortalPackage())');
    expect(manifest).not.toMatch(
      /MANAGE_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/,
    );
  });

  it('uses the iOS document exporter and protects its temporary plaintext', () => {
    const module = read('ios/QingJiAI/LedgerFilePortal.swift');
    const bridge = read('ios/QingJiAI/LedgerFilePortalBridge.m');
    const project = read('ios/QingJiAI.xcodeproj/project.pbxproj');

    expect(module).toContain('UIDocumentPickerViewController');
    expect(module).toContain('forExporting: [fileURL]');
    expect(module).toContain('forOpeningContentTypes: types');
    expect(module).toContain('url.lastPathComponent');
    expect(module).toContain('data.base64EncodedString()');
    expect(module).toContain('FileProtectionType.complete');
    expect(module).toContain('maximumTextBytes = 50 * 1024 * 1024');
    expect(module).toContain('maximumOpenBytes = 50 * 1024 * 1024');
    expect(module).toContain(
      'removeItem(at: temporaryURL.deletingLastPathComponent())',
    );
    expect(bridge).toContain('RCT_EXTERN_MODULE(LedgerFilePortal, NSObject)');
    expect(project).toContain('LedgerFilePortal.swift in Sources');
    expect(project).toContain('LedgerFilePortalBridge.m in Sources');
  });
});
