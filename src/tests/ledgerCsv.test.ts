import { createRepositories } from '../database';
import {
  createLedgerCsv,
  encodeCsvCell,
  formatMinorUnits,
} from '../domain/services/ledgerCsv';
import { openMigratedTestDatabase } from './database/testDatabase';

describe('ledger CSV export', () => {
  it('formats integer minor units without floating-point conversion', () => {
    expect(formatMinorUnits(0)).toBe('0.00');
    expect(formatMinorUnits(5)).toBe('0.05');
    expect(formatMinorUnits(123456789)).toBe('1234567.89');
    expect(() => formatMinorUnits(1.2)).toThrow();
  });

  it('quotes special characters and neutralizes spreadsheet formulas', () => {
    expect(encodeCsvCell('咖啡,早餐')).toBe('"咖啡,早餐"');
    expect(encodeCsvCell('他说"好"\n下一行')).toBe('"他说""好""\n下一行"');
    expect(encodeCsvCell('=HYPERLINK("https://example.test")')).toBe(
      '"\'=HYPERLINK(""https://example.test"")"',
    );
    expect(encodeCsvCell('  -2+3')).toBe('"\'  -2+3"');
  });

  it('exports joined ledger labels with privacy and recycle-bin controls', async () => {
    const database = await openMigratedTestDatabase();

    try {
      await database.execute(
        `INSERT INTO tags (id, name, created_at, updated_at)
         VALUES
           ('tag-csv-b', '旅行', '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z'),
           ('tag-csv-a', '工作', '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z')`,
      );
      await database.execute(
        `INSERT INTO projects (
           id, name, currency, is_archived, created_at, updated_at
         ) VALUES (
           'project-csv', '上海出差', 'CNY', 0,
           '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z'
         )`,
      );
      await database.execute(
        `INSERT INTO transactions (
           id, type, amount_minor, currency, occurred_at, category_id,
           account_id, merchant_raw_name, project_id, note, source,
           source_reference_id, original_text, confidence,
           confirmation_status, duplicate_status, created_at, updated_at,
           sync_status
         ) VALUES (
           'transaction-csv', 'EXPENSE', 12345, 'CNY',
           '2026-08-13T08:30:00.000Z', 'category-expense-food-lunch',
           'account-wechat', '=危险商户', 'project-csv', '咖啡,早餐', 'TEXT',
           'text-session-csv', '上海午饭123.45', 0.9, 'CONFIRMED', 'NONE',
           '2026-08-13T08:31:00.000Z', '2026-08-13T08:31:00.000Z',
           'LOCAL_ONLY'
         )`,
      );
      await database.execute(
        `INSERT INTO transaction_tags (transaction_id, tag_id)
         VALUES
           ('transaction-csv', 'tag-csv-b'),
           ('transaction-csv', 'tag-csv-a')`,
      );
      await database.execute(
        `INSERT INTO transactions (
           id, type, amount_minor, currency, occurred_at, source,
           confirmation_status, duplicate_status, created_at, updated_at,
           deleted_at, sync_status
         ) VALUES (
           'transaction-csv-deleted', 'EXPENSE', 100, 'CNY',
           '2026-08-12T08:30:00.000Z', 'MANUAL', 'CONFIRMED', 'NONE',
           '2026-08-12T08:31:00.000Z', '2026-08-12T08:31:00.000Z',
           '2026-08-13T09:00:00.000Z', 'LOCAL_ONLY'
         )`,
      );

      const repository = createRepositories(database).ledgerExport;
      const privateRows = await repository.listTransactionsForExport();
      expect(privateRows).toHaveLength(1);
      expect(privateRows[0]).toMatchObject({
        id: 'transaction-csv',
        amountMinor: 12345,
        category: '午餐',
        account: '微信',
        merchant: '=危险商户',
        project: '上海出差',
        tags: '工作；旅行',
        note: '咖啡,早餐',
        originalText: undefined,
      });

      const completeRows = await repository.listTransactionsForExport({
        includeDeleted: true,
        includeOriginalText: true,
      });
      expect(completeRows).toHaveLength(2);
      expect(completeRows[1]?.originalText).toBe('上海午饭123.45');

      const csv = createLedgerCsv([completeRows[1]!]);
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('"12345","123.45"');
      expect(csv).toContain('"\'=危险商户"');
      expect(csv).toContain('"咖啡,早餐"');
      expect(csv).toContain('"上海午饭123.45"');
    } finally {
      database.close();
    }
  });
});
