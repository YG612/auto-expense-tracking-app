import { createRepositories, type DatabaseConnection } from '../database';
import type { Tag } from '../domain/entities';
import {
  buildManualTransaction,
  parseAmountToMinor,
  type ManualTransactionDraft,
  validateManualTransaction,
} from '../domain/services/manualTransaction';
import { openMigratedTestDatabase } from './database/testDatabase';

const recordedAt = new Date('2026-07-20T04:30:00.000Z');
const createdAt = '2026-07-20T04:31:00.000Z';

function expenseDraft(
  overrides: Partial<ManualTransactionDraft> = {},
): ManualTransactionDraft {
  return {
    type: 'EXPENSE',
    amountText: '25.80',
    occurredAt: recordedAt,
    categoryId: 'category-expense-food',
    subcategoryId: 'category-expense-food-lunch',
    accountId: 'account-wechat',
    merchantName: '示例餐厅',
    tagIds: [],
    note: '和朋友午餐',
    ...overrides,
  };
}

describe('manual bookkeeping', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('parses decimal amounts into exact integer minor units', () => {
    expect(parseAmountToMinor('12')).toBe(1200);
    expect(parseAmountToMinor('12.5')).toBe(1250);
    expect(parseAmountToMinor('１２．５０')).toBe(1250);
    expect(parseAmountToMinor('0')).toBeUndefined();
    expect(parseAmountToMinor('-1')).toBeUndefined();
    expect(parseAmountToMinor('1.001')).toBeUndefined();
    expect(parseAmountToMinor('not money')).toBeUndefined();
  });

  it('validates required fields and transfer account rules', () => {
    expect(validateManualTransaction(expenseDraft())).toEqual({
      ok: true,
      amountMinor: 2580,
    });
    expect(
      validateManualTransaction(expenseDraft({ categoryId: undefined })),
    ).toMatchObject({ ok: false, field: 'categoryId' });

    const transfer = expenseDraft({
      type: 'TRANSFER',
      categoryId: undefined,
      subcategoryId: undefined,
      targetAccountId: undefined,
    });
    expect(validateManualTransaction(transfer)).toMatchObject({
      ok: false,
      field: 'targetAccountId',
    });
    expect(
      validateManualTransaction({
        ...transfer,
        targetAccountId: transfer.accountId,
      }),
    ).toMatchObject({ ok: false, field: 'targetAccountId' });
    expect(
      validateManualTransaction({
        ...transfer,
        targetAccountId: 'account-alipay',
      }),
    ).toEqual({ ok: true, amountMinor: 2580 });
  });

  it('saves, searches, edits, soft-deletes and restores a transaction', async () => {
    const repositories = createRepositories(database);
    const tag: Tag = {
      id: 'tag-friends',
      name: '朋友',
      createdAt,
      updatedAt: createdAt,
    };
    await repositories.tags.create(tag);

    const draft = expenseDraft({ tagIds: [tag.id] });
    const validation = validateManualTransaction(draft);
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      throw new Error(validation.message);
    }

    const transaction = buildManualTransaction(
      draft,
      validation.amountMinor,
      'transaction-manual-lunch',
      createdAt,
    );
    await repositories.transactions.saveWithTags(transaction, draft.tagIds);

    await expect(
      repositories.transactions.listSummaries({
        query: '午餐',
        type: 'EXPENSE',
        categoryId: 'category-expense-food-lunch',
        accountId: 'account-wechat',
        tagId: tag.id,
        occurredFrom: '2026-07-01T00:00:00.000Z',
        occurredBefore: '2026-08-01T00:00:00.000Z',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: transaction.id,
        amountMinor: 2580,
        categoryName: '餐饮',
        subcategoryName: '午餐',
        accountName: '微信',
        merchantName: '示例餐厅',
        tagNames: ['朋友'],
      }),
    ]);

    const categories =
      await repositories.categories.listVisibleByUsage('EXPENSE');
    const accounts = await repositories.accounts.listVisibleByUsage();
    expect(categories[0]?.id).toBe('category-expense-food-lunch');
    expect(accounts[0]?.id).toBe('account-wechat');

    const edited = buildManualTransaction(
      { ...draft, amountText: '30', note: '午餐已补小费' },
      3000,
      transaction.id,
      '2026-07-20T05:00:00.000Z',
      transaction,
    );
    const savedEdit = await repositories.transactions.saveWithTags(edited, []);
    await expect(
      repositories.transactions.findById(transaction.id),
    ).resolves.toMatchObject({ amountMinor: 3000, note: '午餐已补小费' });
    await expect(
      repositories.transactionTags.listForTransaction(transaction.id),
    ).resolves.toEqual([]);

    const deletedAt = '2026-07-20T05:05:00.000Z';
    const deleted = await repositories.transactions.softDelete(
      { id: transaction.id, revision: savedEdit.revision },
      deletedAt,
    );
    expect(deleted.status).toBe('APPLIED');
    await expect(repositories.transactions.listSummaries()).resolves.toEqual(
      [],
    );
    await expect(
      repositories.transactions.listSummaries({ deletedOnly: true }),
    ).resolves.toEqual([
      expect.objectContaining({ id: transaction.id, deletedAt }),
    ]);

    if (deleted.status !== 'APPLIED') {
      throw new Error('Expected delete to succeed.');
    }
    await repositories.transactions.restore(
      { id: transaction.id, revision: deleted.transaction.revision },
      '2026-07-20T05:10:00.000Z',
    );
    await expect(repositories.transactions.listSummaries()).resolves.toEqual([
      expect.objectContaining({ id: transaction.id }),
    ]);
  });
});
