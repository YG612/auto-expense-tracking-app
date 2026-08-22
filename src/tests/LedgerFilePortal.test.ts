import { NativeModules } from 'react-native';

import {
  MAX_LEDGER_FILE_BYTES,
  openLedgerTextFile,
  saveLedgerTextFile,
} from '../native/LedgerFilePortal';

describe('LedgerFilePortal TypeScript boundary', () => {
  afterEach(() => {
    delete NativeModules.LedgerFilePortal;
  });

  it('passes text only to the explicitly selected system destination', async () => {
    const saveText = jest.fn(async () => ({
      status: 'SAVED' as const,
      uri: 'content://documents/ledger.csv',
    }));
    NativeModules.LedgerFilePortal = { saveText };

    await expect(
      saveLedgerTextFile({
        suggestedFileName: 'qingji-ledger.csv',
        mimeType: 'text/csv',
        content: 'a,b\r\n1,2\r\n',
      }),
    ).resolves.toEqual({
      status: 'SAVED',
      uri: 'content://documents/ledger.csv',
    });
    expect(saveText).toHaveBeenCalledWith(
      'qingji-ledger.csv',
      'text/csv',
      'a,b\r\n1,2\r\n',
    );
  });

  it('validates metadata and rejects unavailable native builds', async () => {
    await expect(
      saveLedgerTextFile({
        suggestedFileName: '',
        mimeType: 'text/csv',
        content: '',
      }),
    ).rejects.toThrow('file name is invalid');

    await expect(
      saveLedgerTextFile({
        suggestedFileName: 'ledger.csv',
        mimeType: 'text/csv',
        content: '',
      }),
    ).rejects.toThrow('unavailable on this build');
  });

  it('rejects oversized UTF-8 content before opening the system picker', async () => {
    const saveText = jest.fn();
    NativeModules.LedgerFilePortal = { saveText };
    const oversized =
      '\u0800'.repeat(Math.floor(MAX_LEDGER_FILE_BYTES / 3)) + 'aaa';

    await expect(
      saveLedgerTextFile({
        suggestedFileName: 'ledger.csv',
        mimeType: 'text/csv',
        content: oversized,
      }),
    ).rejects.toThrow('50 MiB');
    expect(saveText).not.toHaveBeenCalled();
  });

  it('opens GB18030 statement text selected by the user', async () => {
    const openText = jest.fn(async () => ({
      status: 'OPENED' as const,
      content: '交易时间,金额\n2026-08-01,12.50',
      encoding: 'GB18030' as const,
      fileName: '微信支付账单.csv',
    }));
    NativeModules.LedgerFilePortal = { openText };

    await expect(
      openLedgerTextFile(['text/csv', 'text/plain']),
    ).resolves.toMatchObject({
      status: 'OPENED',
      encoding: 'GB18030',
      fileName: '微信支付账单.csv',
    });
    expect(openText).toHaveBeenCalledWith(['text/csv', 'text/plain']);
  });
});
