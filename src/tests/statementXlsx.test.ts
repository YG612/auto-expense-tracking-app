import { strToU8, zipSync } from 'fflate';

import {
  MAX_XLSX_BASE64_CHARACTERS,
  parseStatementXlsx,
} from '../importers/statementXlsx';

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

describe('statement XLSX importer', () => {
  it('reads shared strings and Excel date serials from the first worksheet', () => {
    const workbook = zipSync({
      'xl/sharedStrings.xml': strToU8(
        '<?xml version="1.0"?><sst><si><t>交易时间</t></si><si><t>金额</t></si><si><t>交易对方</t></si><si><t>收/支</t></si><si><t>便利店</t></si><si><t>支出</t></si></sst>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<?xml version="1.0"?><worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
          '<row r="2"><c r="A2"><v>46247.5</v></c><c r="B2"><v>12.30</v></c><c r="C2" t="s"><v>4</v></c><c r="D2" t="s"><v>5</v></c></row>' +
          '</sheetData></worksheet>',
      ),
    });
    const preview = parseStatementXlsx({
      base64Content: base64(workbook),
      fileName: '账单.xlsx',
    });

    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0]).toMatchObject({
      amountMinor: 1230,
      merchantRawName: '便利店',
      type: 'EXPENSE',
    });
    expect(preview.candidates[0]?.occurredAt).toMatch(/^2026-/u);
  });

  it('rejects invalid and oversized workbook encodings', () => {
    expect(() =>
      parseStatementXlsx({ base64Content: 'not base64', fileName: 'bad.xlsx' }),
    ).toThrow('编码无效');
    expect(() =>
      parseStatementXlsx({
        base64Content: 'A'.repeat(MAX_XLSX_BASE64_CHARACTERS + 4),
        fileName: 'huge.xlsx',
      }),
    ).toThrow('编码无效');

    const compressedBomb = zipSync({
      'xl/sharedStrings.xml': new Uint8Array(16 * 1024 * 1024),
      'xl/worksheets/sheet1.xml': new Uint8Array(16 * 1024 * 1024),
    });
    expect(() =>
      parseStatementXlsx({
        base64Content: base64(compressedBomb),
        fileName: 'compressed-bomb.xlsx',
      }),
    ).toThrow('解压后内容过大');
  });
});
