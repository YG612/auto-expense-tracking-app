import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('inbound entry native contract', () => {
  it('converts Android text shares to bounded deep-link prefill and exposes shortcuts', () => {
    const activity = read(
      'android/app/src/main/java/com/qingjiai/MainActivity.kt',
    );
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const shortcuts = read('android/app/src/main/res/xml/shortcuts.xml');

    expect(manifest).toContain('android.intent.action.SEND');
    expect(manifest).toContain('android:mimeType="text/plain"');
    expect(manifest).toContain('android:mimeType="image/*"');
    expect(manifest).toContain('android.app.shortcuts');
    expect(activity).toContain('sharedText.take(2_000)');
    expect(activity).toContain('Intent.EXTRA_STREAM');
    expect(activity).toContain('imageUri.scheme == "content"');
    expect(activity).not.toContain('imageUri.scheme == "file"');
    expect(activity).toContain('.appendQueryParameter("imageUri"');
    expect(activity).toContain('.appendQueryParameter("text", sharedText');
    expect(activity).toContain('action = Intent.ACTION_VIEW');
    expect(shortcuts).toContain('qingjiai://entry/smart');
    expect(shortcuts).toContain('qingjiai://entry/manual');
  });

  it('registers iOS deep links and home-screen quick actions', () => {
    const info = read('ios/QingJiAI/Info.plist');
    const delegate = read('ios/QingJiAI/AppDelegate.swift');

    expect(info).toContain('<string>qingjiai</string>');
    expect(info).toContain('UIApplicationShortcutItems');
    expect(delegate).toContain('RCTLinkingManager.application');
    expect(delegate).toContain('launchOptions?[.shortcutItem]');
    expect(delegate).toContain('qingjiai://\\(path)');
  });
});
