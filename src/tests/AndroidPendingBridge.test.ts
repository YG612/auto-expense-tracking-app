import { spawnSync } from 'node:child_process';

import {
  AndroidPendingBridgeError,
  getAndroidPendingBillStatus,
  queueAndroidPendingBill,
} from '../agent/AndroidPendingBridge';

jest.mock('node:child_process', () => ({ spawnSync: jest.fn() }));

const mockedSpawnSync = jest.mocked(spawnSync);
const REQUEST_KEY = 'c'.repeat(64);

describe('Android pending result bridge', () => {
  beforeEach(() => mockedSpawnSync.mockReset());

  it('accepts a minimal committed receipt and never returns bill text', () => {
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: JSON.stringify({
        schemaVersion: 1,
        command: 'bill.create-pending',
        requestKey: REQUEST_KEY,
        status: 'COMMITTED',
        transactionIds: ['agent-pending-1'],
        completedAt: '2026-08-15T12:00:00.000Z',
      }),
      stderr: '',
      status: 0,
      signal: null,
    });

    const result = getAndroidPendingBillStatus({ requestKey: REQUEST_KEY });
    expect(result).toMatchObject({
      status: 'COMMITTED',
      transactionIds: ['agent-pending-1'],
    });
    expect(result).not.toHaveProperty('text');
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'adb',
      expect.arrayContaining(['run-as', 'com.qingjiai.internal']),
      expect.objectContaining({ shell: false }),
    );
  });

  it('rejects a terminal receipt without a completion timestamp', () => {
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: JSON.stringify({
        schemaVersion: 1,
        command: 'bill.create-pending',
        requestKey: REQUEST_KEY,
        status: 'COMMITTED',
        transactionIds: ['agent-pending-1'],
      }),
      stderr: '',
      status: 0,
      signal: null,
    });

    expect(() =>
      getAndroidPendingBillStatus({ requestKey: REQUEST_KEY }),
    ).toThrow(AndroidPendingBridgeError);
  });

  it('rejects invalid request keys before invoking adb', () => {
    expect(() =>
      getAndroidPendingBillStatus({ requestKey: '../transactions.sqlite' }),
    ).toThrow('requestKey 必须是 64 位小写十六进制');
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it('uses adb shell stdin with a fixed quoted program for queue payloads', () => {
    mockedSpawnSync
      .mockReturnValueOnce({
        pid: 1,
        output: [],
        stdout: '',
        stderr: '',
        status: 0,
        signal: null,
      })
      .mockReturnValueOnce({
        pid: 2,
        output: [],
        stdout: '',
        stderr: '',
        status: 0,
        signal: null,
      });
    queueAndroidPendingBill({
      callerId: 'codex-test',
      idempotencyKey: 'stdin-transport-1',
      text: '午饭25元；$(malicious)',
    });

    const [adb, args, options] = mockedSpawnSync.mock.calls[0]!;
    expect(adb).toBe('adb');
    expect(args).toEqual(expect.arrayContaining(['shell', 'run-as']));
    expect(args).not.toContain('exec-out');
    expect(args).not.toContain(expect.stringContaining('午饭'));
    expect(options).toMatchObject({
      input: expect.stringContaining('午饭25元；$(malicious)'),
      shell: false,
    });
    expect(mockedSpawnSync.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining([
        '-n',
        'com.qingjiai.internal/com.qingjiai.MainActivity',
      ]),
    );
  });

  it('rejects text beyond the shared parser limit before invoking adb', () => {
    expect(() =>
      queueAndroidPendingBill({
        callerId: 'codex-test',
        idempotencyKey: 'too-long-1',
        text: '字'.repeat(501),
      }),
    ).toThrow('账单文字必须是 1 到 500 个 Unicode 字符');
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it('surfaces a run-as permission refusal and never launches the app', () => {
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: '',
      stderr: 'run-as: package not debuggable',
      status: 1,
      signal: null,
    });

    let thrown: unknown;
    try {
      queueAndroidPendingBill({
        callerId: 'codex-test',
        idempotencyKey: 'permission-denied-1',
        text: '午饭25元',
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'ADB_AGENT_QUEUE_FAILED' });
    expect(mockedSpawnSync).toHaveBeenCalledTimes(1);
  });
});
