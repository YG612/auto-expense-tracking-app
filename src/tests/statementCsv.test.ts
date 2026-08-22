import {
  inspectStatementHeaders,
  MAX_STATEMENT_TEXT_CHARACTERS,
  parseStatementCsv,
} from '../importers/statementCsv';

describe('statement CSV importer', () => {
  it('uses the amount sign when a generic CSV omits the type column', () => {
    const preview = parseStatementCsv({
      fileName: 'generic.csv',
      content: [
        '交易时间,金额,商户',
        '2026-08-01 08:00,-12.50,早餐店',
        '2026-08-01 09:00,5000.00,工资',
      ].join('\n'),
    });

    expect(preview.candidates.map(candidate => candidate.type)).toEqual([
      'EXPENSE',
      'INCOME',
    ]);
  });

  it('exposes arbitrary headers so users can map unknown exports', () => {
    expect(
      inspectStatementHeaders('when,cost,who\n2026-08-14,12.30,店铺'),
    ).toEqual(['when', 'cost', 'who']);
  });

  it('normalizes an official WeChat export without retaining the source file', () => {
    const content = [
      '微信支付账单明细',
      '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,备注',
      '2026-08-13 12:34:00,商户消费,便利店,午餐,支出,¥12.30,零钱,支付成功,wx-001,工作餐',
    ].join('\r\n');
    const preview = parseStatementCsv({
      content,
      fileName: '微信支付账单.csv',
    });

    expect(preview.source).toBe('WECHAT');
    expect(preview.rawContentHash).toHaveLength(64);
    expect(preview).not.toHaveProperty('rawContent');
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0]).toMatchObject({
      schemaVersion: 1,
      transactionSource: 'WECHAT_IMPORT',
      sourceReferenceId: 'wx-001',
      type: 'EXPENSE',
      settlementState: 'COMPLETED',
      fundSemantics: 'PURCHASE',
      semanticWarnings: [],
      amountMinor: 1230,
      merchantRawName: '便利店',
      accountHint: '零钱',
      note: '工作餐',
    });
  });

  it('excludes non-settled rows and keeps independent refunds', () => {
    const preview = parseStatementCsv({
      fileName: '微信账单.csv',
      content: [
        '微信支付账单',
        '交易时间,交易对方,收/支,金额(元),当前状态,交易单号,备注',
        '2026-08-13 08:00,早餐店,支出,12.00,支付成功,ok-1,早餐',
        '2026-08-13 08:01,早餐店,支出,12.00,支付失败,failed-1,早餐',
        '2026-08-13 08:02,早餐店,支出,12.00,已取消,cancelled-1,早餐',
        '2026-08-13 08:03,早餐店,支出,12.00,处理中,pending-1,早餐',
        '2026-08-13 08:04,早餐店,支出,12.00,已全额退款,refunded-original,早餐',
        '2026-08-13 08:05,早餐店,退款,12.00,退款成功,refund-1,退款',
      ].join('\n'),
    });

    expect(
      preview.candidates.map(candidate => candidate.sourceReferenceId),
    ).toEqual(['ok-1', 'refund-1']);
    expect(preview.candidates[1]).toMatchObject({
      type: 'REFUND',
      settlementState: 'COMPLETED',
      fundSemantics: 'REFUND',
      semanticWarnings: ['退款应关联原支出后再确认'],
    });
    expect(preview.exclusions.map(exclusion => exclusion.code)).toEqual([
      'SETTLEMENT_FAILED',
      'SETTLEMENT_CANCELLED',
      'SETTLEMENT_PENDING',
      'ORIGINAL_TRANSACTION_REFUNDED',
    ]);
    expect(preview.failures).toEqual([]);
  });

  it('maps transfers and fees before generic income/expense direction', () => {
    const preview = parseStatementCsv({
      fileName: 'alipay.csv',
      content: [
        '支付宝账单',
        '交易时间,交易对方,收/支,金额,状态,备注',
        '2026-08-13 09:00,老王,转入,100.00,交易成功,转账',
        '2026-08-13 09:01,支付平台,退款,2.00,交易成功,退款手续费',
      ].join('\n'),
    });

    expect(preview.candidates).toEqual([
      expect.objectContaining({
        type: 'TRANSFER',
        fundSemantics: 'TRANSFER',
        semanticWarnings: ['转账的来源、去向和账户关系必须人工确认'],
      }),
      expect.objectContaining({
        type: 'EXPENSE',
        fundSemantics: 'FEE',
      }),
    ]);
  });

  it('marks missing or unknown provider status for mandatory review', () => {
    const missing = parseStatementCsv({
      fileName: 'generic.csv',
      content: '交易时间,金额\n2026-08-13 09:00,-10.00',
    });
    const unknown = parseStatementCsv({
      fileName: 'generic.csv',
      content: '交易时间,金额,交易状态\n2026-08-13 09:00,-10.00,状态码X9',
    });

    expect(missing.candidates[0]).toMatchObject({
      settlementState: 'UNKNOWN',
      semanticWarnings: ['账单未提供交易状态，必须人工确认是否已经完成'],
    });
    expect(unknown.candidates[0]).toMatchObject({
      settlementState: 'UNKNOWN',
      semanticWarnings: [expect.stringContaining('未识别交易状态')],
    });
  });

  it('normalizes quoted Alipay fields and reports malformed rows separately', () => {
    const content = [
      '支付宝交易记录明细查询',
      '交易号,交易创建时间,交易对方,商品名称,金额（元）,收/支,备注',
      'ali-1,2026-08-13 08:00:00,"早餐,咖啡店",拿铁,18.50,支出,"含,逗号"',
      'ali-2,不是日期,退款商家,退款,5.00,退款,',
    ].join('\n');
    const preview = parseStatementCsv({ content, fileName: 'alipay.csv' });

    expect(preview.source).toBe('ALIPAY');
    expect(preview.candidates[0]).toMatchObject({
      sourceReferenceId: 'ali-1',
      merchantRawName: '早餐,咖啡店',
      amountMinor: 1850,
      note: '含,逗号',
    });
    expect(preview.failures).toEqual([
      { sourceRow: 4, message: '交易时间格式无效' },
    ]);
  });

  it('supports explicit generic mappings and rejects malformed or huge input', () => {
    const preview = parseStatementCsv({
      content: 'When,Value,Who\n2026-08-13T00:00:00.000Z,9.99,Market',
      fileName: 'custom.csv',
      mapping: {
        occurredAt: 'When',
        amount: 'Value',
        merchant: 'Who',
      },
    });
    expect(preview.source).toBe('CSV');
    expect(preview.candidates[0]?.amountMinor).toBe(999);

    expect(() =>
      parseStatementCsv({
        content: '日期,金额\n"2026-08-13,10.00',
        fileName: 'broken.csv',
      }),
    ).toThrow('未闭合');
    expect(() =>
      parseStatementCsv({
        content: 'x'.repeat(MAX_STATEMENT_TEXT_CHARACTERS + 1),
        fileName: 'huge.csv',
      }),
    ).toThrow('过大');
    expect(() =>
      inspectStatementHeaders('x'.repeat(MAX_STATEMENT_TEXT_CHARACTERS + 1)),
    ).toThrow('过大');
  });
});
