import fs from 'node:fs';
import path from 'node:path';

describe('Android device regression harness contract', () => {
  const script = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'android-device-regression.ps1'),
    'utf8',
  );

  it('keeps evidence on D drive and omits sensitive collection commands', () => {
    expect(script).toContain('D:\\CodexData\\TestEvidence\\QingJiAI');
    expect(script).toContain('deviceSerialStored = $false');
    expect(script).toContain('ledgerTextStored = $false');
    expect(script).toContain('logcatCollected = $false');
    expect(script).not.toMatch(
      /\b(?:logcat|bugreport|screencap|screenrecord)\b/i,
    );
    expect(script).not.toMatch(/\b(?:uninstall|pm\s+clear|grant|revoke)\b/i);
    expect(script).not.toContain('ro.serialno');
    expect(script).toContain("'shell', 'am', 'get-current-user'");
    expect(script).toContain(
      "'shell', 'dumpsys', 'package', 'check-permission'",
    );
    expect(script).not.toContain("'shell', 'dumpsys', 'package', $packageId");
  });

  it('covers the release-blocking manual scenarios without auto-passing them', () => {
    for (const id of [
      'REG-01',
      'REG-02',
      'REG-03',
      'REG-04',
      'REG-05',
      'REG-06',
      'REG-09',
      'REG-10',
      'REG-11',
      'REG-12',
      'REG-13',
      'REG-14',
      'REG-15',
      'REG-16',
    ]) {
      expect(script).toContain(id);
    }
    expect(script).toContain("status = 'NOT_RUN'");
    expect(script).toContain('MANUAL_APP_CHECK_REQUIRED');
  });
});
