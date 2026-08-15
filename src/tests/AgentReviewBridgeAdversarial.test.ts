import { spawnSync } from 'node:child_process';

import { openAndroidReview, openIosSimulatorReview } from '../agent';

jest.mock('node:child_process', () => ({ spawnSync: jest.fn() }));

const mockedSpawnSync = jest.mocked(spawnSync);

describe('agent review adapter adversarial boundaries', () => {
  beforeEach(() => mockedSpawnSync.mockReset());

  it('passes Android shell metacharacters as one inert argument', () => {
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: 'Status: ok',
      stderr: '',
      status: 0,
      signal: null,
    });
    const billText = '午饭25元; $(touch /data/local/tmp/pwned) `whoami`';

    const result = openAndroidReview({ text: billText });

    expect(result.status).toBe('OPENED_FOR_REVIEW');
    const [, args, options] = mockedSpawnSync.mock.calls[0]!;
    expect(args).toContain(billText);
    expect(options).toMatchObject({ shell: false });
  });

  it('percent-encodes a malicious iOS deep-link value without returning it', () => {
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
    });
    const billText = '午饭25元&source=trusted#confirm=true';

    const result = openIosSimulatorReview({ text: billText });

    expect(result).not.toHaveProperty('text');
    const [, args, options] = mockedSpawnSync.mock.calls[0]!;
    const url = new URL(String(args?.[3]));
    expect(url.searchParams.get('text')).toBe(billText);
    expect(url.searchParams.get('source')).toBe('agent');
    expect(url.searchParams.has('confirm')).toBe(false);
    expect(options).toMatchObject({ shell: false });
  });

  it.each([openAndroidReview, openIosSimulatorReview])(
    'rejects 501 Unicode characters before starting a platform command',
    openReview => {
      expect(() => openReview({ text: '字'.repeat(501) })).toThrow(/500/u);
      expect(mockedSpawnSync).not.toHaveBeenCalled();
    },
  );
});
