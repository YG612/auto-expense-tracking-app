import { NativeModules } from 'react-native';

import {
  MAX_LEDGER_FILE_BYTES,
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
});
