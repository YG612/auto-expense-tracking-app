import { NativeModules } from 'react-native';

import { AppError } from '../domain/errors/AppError';
import { utf8ByteLength } from '../utils/utf8ByteLength';

export const MAX_LEDGER_FILE_BYTES = 50 * 1024 * 1024;
const MAX_OPEN_CONTENT_CHARACTERS = Math.ceil((MAX_LEDGER_FILE_BYTES * 4) / 3);

type NativeLedgerFilePortal = {
  saveText(
    suggestedFileName: string,
    mimeType: string,
    content: string,
  ): Promise<LedgerFileSaveResult>;
  openText(mimeTypes: string[]): Promise<LedgerFileOpenResult>;
};

export type LedgerFileSaveResult =
  { status: 'SAVED'; uri?: string } | { status: 'CANCELLED' };

export type LedgerFileOpenResult =
  | {
      status: 'OPENED';
      content: string;
      encoding?: 'UTF8' | 'GB18030' | 'BASE64';
      uri?: string;
      fileName?: string;
    }
  | { status: 'CANCELLED' };

export type LedgerTextFile = {
  suggestedFileName: string;
  mimeType: string;
  content: string;
};

function nativePortal(): NativeLedgerFilePortal {
  const portal = NativeModules.LedgerFilePortal as
    NativeLedgerFilePortal | undefined;

  if (portal === undefined) {
    throw new Error('Ledger file export is unavailable on this build.');
  }

  return portal;
}

export async function saveLedgerTextFile(
  file: LedgerTextFile,
): Promise<LedgerFileSaveResult> {
  const suggestedFileName = file.suggestedFileName.trim();
  const mimeType = file.mimeType.trim();

  if (suggestedFileName.length === 0 || suggestedFileName.length > 128) {
    throw new Error('Export file name is invalid.');
  }
  if (mimeType.length === 0 || mimeType.length > 100) {
    throw new Error('Export MIME type is invalid.');
  }
  if (utf8ByteLength(file.content) > MAX_LEDGER_FILE_BYTES) {
    throw new AppError(
      'LEDGER-FILE-SIZE-LIMIT',
      '导出内容超过 50 MiB 上限；如为账本数据，请改用分批 CSV 导出。',
      { category: 'VALIDATION', retryable: false },
    );
  }

  const result = await nativePortal().saveText(
    suggestedFileName,
    mimeType,
    file.content,
  );

  if (result.status !== 'SAVED' && result.status !== 'CANCELLED') {
    throw new Error('Native file export returned an invalid result.');
  }

  return result;
}

export async function openLedgerTextFile(
  mimeTypes: readonly string[],
): Promise<LedgerFileOpenResult> {
  if (
    mimeTypes.length === 0 ||
    mimeTypes.length > 8 ||
    mimeTypes.some(value => value.length === 0 || value.length > 100)
  ) {
    throw new Error('Ledger file MIME types are invalid.');
  }
  const result = await nativePortal().openText([...mimeTypes]);
  if (result.status !== 'OPENED' && result.status !== 'CANCELLED') {
    throw new Error('Native file import returned an invalid result.');
  }
  if (
    result.status === 'OPENED' &&
    (typeof result.content !== 'string' ||
      result.content.length > MAX_OPEN_CONTENT_CHARACTERS ||
      (result.encoding !== undefined &&
        result.encoding !== 'UTF8' &&
        result.encoding !== 'GB18030' &&
        result.encoding !== 'BASE64') ||
      (result.fileName !== undefined &&
        (result.fileName.length === 0 || result.fileName.length > 255)))
  ) {
    throw new Error('Selected ledger file content is invalid.');
  }
  return result;
}
