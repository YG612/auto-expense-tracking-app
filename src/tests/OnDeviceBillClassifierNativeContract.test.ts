import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');

describe('on-device bill classifier native contract', () => {
  it('keeps Android native classification local and verified', () => {
    const module = fs.readFileSync(
      path.join(
        root,
        'android/app/src/main/java/com/qingjiai/classification/OnDeviceBillClassifierModule.kt',
      ),
      'utf8',
    );
    expect(module).toContain('assets.open("bill-classifier/manifest.json")');
    expect(module).toContain('MessageDigest.getInstance("SHA-256")');
    expect(module).toContain('noBackupFilesDir');
    expect(module).not.toMatch(/SQLite|fetch\(|https?:\/\//u);
  });

  it('compiles the same fastText core and model directory on iOS', () => {
    const project = fs.readFileSync(
      path.join(root, 'ios/QingJiAI.xcodeproj/project.pbxproj'),
      'utf8',
    );
    const module = fs.readFileSync(
      path.join(root, 'ios/QingJiAI/OnDeviceBillClassifier.mm'),
      'utf8',
    );
    expect(project).toContain('OnDeviceBillClassifierCore.cc in Sources');
    expect(project).toContain('fasttext.cc in Sources');
    expect(project).toContain('bill-classifier in Resources');
    expect(module).toContain('CC_SHA256_Init');
    expect(module).toContain('OnDeviceBillClassifierCore');
    expect(module).not.toMatch(/NSURLSession|https?:\/\//u);
  });
});
