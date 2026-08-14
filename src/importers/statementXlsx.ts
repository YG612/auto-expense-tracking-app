/* eslint-disable no-bitwise -- Base64 decoding operates on 24-bit groups. */

import { strFromU8, unzipSync } from 'fflate';

import { inspectStatementHeaders, parseStatementCsv } from './statementCsv';
import type { StatementColumnMapping, StatementImportPreview } from './types';

export const MAX_XLSX_BASE64_CHARACTERS = 40 * 1024 * 1024;
const MAX_XLSX_XML_BYTES = 30 * 1024 * 1024;
const MAX_XLSX_COLUMNS = 200;
const MAX_XLSX_RELEVANT_ENTRIES = 64;

function decodeBase64(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length > MAX_XLSX_BASE64_CHARACTERS ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  ) {
    throw new Error('XLSX 文件编码无效或文件过大。');
  }
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const outputLength =
    (value.length / 4) * 3 -
    (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  const output = new Uint8Array(outputLength);
  let offset = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = alphabet.indexOf(value[index]!);
    const b = alphabet.indexOf(value[index + 1]!);
    const c =
      value[index + 2] === '=' ? 0 : alphabet.indexOf(value[index + 2]!);
    const d =
      value[index + 3] === '=' ? 0 : alphabet.indexOf(value[index + 3]!);
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (offset < output.length) output[offset++] = (chunk >>> 16) & 0xff;
    if (offset < output.length) output[offset++] = (chunk >>> 8) & 0xff;
    if (offset < output.length) output[offset++] = chunk & 0xff;
  }
  return output;
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .replace(/&#(\d+);/gu, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function textRuns(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)]
    .map(match => decodeXmlText(match[1] ?? ''))
    .join('');
}

function sharedStrings(xml: string | undefined): string[] {
  if (xml === undefined) return [];
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gu)].map(match =>
    textRuns(match[1] ?? ''),
  );
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/u)?.[0];
  if (letters === undefined) throw new Error('XLSX 单元格引用无效。');
  let result = 0;
  for (const character of letters) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  if (result < 1 || result > MAX_XLSX_COLUMNS) {
    throw new Error(`XLSX 列数超过 ${MAX_XLSX_COLUMNS}。`);
  }
  return result - 1;
}

function worksheetRows(xml: string, strings: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/gu)) {
    const row: string[] = [];
    const rowXml = rowMatch[1] ?? '';
    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)) {
      const attributes = cellMatch[1] ?? '';
      const content = cellMatch[2] ?? '';
      const reference = /\br="([A-Z]+\d+)"/u.exec(attributes)?.[1];
      if (reference === undefined) continue;
      const type = /\bt="([^"]+)"/u.exec(attributes)?.[1];
      const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/u.exec(content)?.[1];
      let value = '';
      if (type === 's' && raw !== undefined) {
        value = strings[Number(raw)] ?? '';
      } else if (type === 'inlineStr') {
        value = textRuns(content);
      } else if (type === 'b') {
        value = raw === '1' ? 'TRUE' : 'FALSE';
      } else if (raw !== undefined) {
        value = decodeXmlText(raw);
      }
      row[columnIndex(reference)] = value;
    }
    if (row.some(value => value !== undefined && value.length > 0))
      rows.push(row);
  }
  return rows;
}

function csvCell(value: string | undefined): string {
  const text = value ?? '';
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function xlsxAsCsv(base64Content: string): string {
  let selectedOriginalBytes = 0;
  let relevantEntryCount = 0;
  const archive = unzipSync(decodeBase64(base64Content), {
    filter: file => {
      const relevant =
        file.name === 'xl/sharedStrings.xml' ||
        /^xl\/worksheets\/sheet\d+\.xml$/u.test(file.name);
      if (!relevant) return false;
      relevantEntryCount += 1;
      selectedOriginalBytes += file.originalSize;
      if (
        relevantEntryCount > MAX_XLSX_RELEVANT_ENTRIES ||
        file.originalSize > MAX_XLSX_XML_BYTES ||
        selectedOriginalBytes > MAX_XLSX_XML_BYTES
      ) {
        throw new Error('XLSX 解压后内容过大或工作表过多。');
      }
      return true;
    },
  });
  const worksheetName = Object.keys(archive)
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
    .sort((left, right) =>
      left.localeCompare(right, 'en', { numeric: true }),
    )[0];
  if (worksheetName === undefined)
    throw new Error('XLSX 不包含可读取的工作表。');
  const worksheetBytes = archive[worksheetName]!;
  const sharedBytes = archive['xl/sharedStrings.xml'];
  const totalBytes = worksheetBytes.length + (sharedBytes?.length ?? 0);
  if (totalBytes > MAX_XLSX_XML_BYTES) throw new Error('XLSX 解压后内容过大。');

  const strings = sharedStrings(
    sharedBytes === undefined ? undefined : strFromU8(sharedBytes),
  );
  const rows = worksheetRows(strFromU8(worksheetBytes), strings);
  return rows.map(row => row.map(csvCell).join(',')).join('\n');
}

export function inspectStatementXlsxHeaders(
  base64Content: string,
): readonly string[] {
  return inspectStatementHeaders(xlsxAsCsv(base64Content));
}

export function parseStatementXlsx(input: {
  base64Content: string;
  fileName: string;
  mapping?: StatementColumnMapping;
}): StatementImportPreview {
  const csv = xlsxAsCsv(input.base64Content);
  return parseStatementCsv({
    content: csv,
    fileName: input.fileName,
    mapping: input.mapping,
  });
}
