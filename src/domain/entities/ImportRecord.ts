export const IMPORT_SOURCES = [
  'WECHAT',
  'ALIPAY',
  'CSV',
  'OCR',
  'ANDROID_NOTIFICATION',
  'IOS_SHARE',
] as const;

export type ImportSource = (typeof IMPORT_SOURCES)[number];

export interface ImportRecord {
  id: string;
  source: ImportSource;
  fileName?: string;
  sourceReferenceId?: string;
  rawContentHash?: string;
  parsedCount: number;
  importedCount: number;
  duplicateCount: number;
  failedCount: number;
  createdAt: string;
}
