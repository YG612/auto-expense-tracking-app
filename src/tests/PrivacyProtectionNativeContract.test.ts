import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

describe('privacy protection native contract', () => {
  it('uses Android device-owner authentication and secure window flags', () => {
    const module = read(
      'android/app/src/main/java/com/qingjiai/privacy/PrivacyProtectionModule.kt',
    );
    const application = read(
      'android/app/src/main/java/com/qingjiai/MainApplication.kt',
    );

    expect(module).toContain('keyguardManager.isDeviceSecure');
    expect(module).toContain('createConfirmDeviceCredentialIntent');
    expect(module).toContain('WindowManager.LayoutParams.FLAG_SECURE');
    expect(module).toContain('Activity.RESULT_OK');
    expect(application).toContain('add(PrivacyProtectionPackage())');
  });

  it('uses iOS owner authentication and protects app-switcher snapshots', () => {
    const module = read('ios/QingJiAI/PrivacyProtection.swift');
    const bridge = read('ios/QingJiAI/PrivacyProtectionBridge.m');
    const project = read('ios/QingJiAI.xcodeproj/project.pbxproj');

    expect(module).toContain('.deviceOwnerAuthentication');
    expect(module).toContain('UIApplication.willResignActiveNotification');
    expect(module).toContain('showPrivacyOverlayIfNeeded');
    expect(bridge).toContain('RCT_EXTERN_MODULE(PrivacyProtection, NSObject)');
    expect(project).toContain('PrivacyProtection.swift in Sources');
    expect(project).toContain('PrivacyProtectionBridge.m in Sources');
  });
});
