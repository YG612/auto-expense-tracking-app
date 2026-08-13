import {
  createRepositories,
  RecognizedPayloadMismatchError,
  type DatabaseConnection,
} from '../../database';
import type { Transaction } from '../../domain/entities';
import { openMigratedTestDatabase } from './testDatabase';

const timestamp = '2026-08-12T04:00:00.000Z';

function voiceTransaction(
  id: string,
  sourceReferenceId: string,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    revision: 1,
    type: 'EXPENSE',
    amountMinor: 1_000,
    currency: 'CNY',
    occurredAt: timestamp,
    categoryId: 'category-expense-food',
    subcategoryId: 'category-expense-food-lunch',
    accountId: 'account-wechat',
    source: 'VOICE',
    sourceReferenceId,
    originalText: '午饭十元',
    confidence: 0.94,
    requiresReview: false,
    reviewReasonCodes: [],
    confirmationStatus: 'CONFIRMED',
    duplicateStatus: 'NONE',
    createdAt: timestamp,
    updatedAt: timestamp,
    syncStatus: 'LOCAL_ONLY',
    ...overrides,
  };
}

describe('durable voice operation receipts', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('commits ledger and receipt once, then reconciles a restart replay', async () => {
    const firstRepositories = createRepositories(database);
    const first = voiceTransaction('voice-tx-1', 'speech:result-1:0');

    await expect(
      firstRepositories.transactions.saveRecognizedWithTags(first, []),
    ).resolves.toMatchObject({
      status: 'COMMITTED',
      transaction: { id: first.id },
    });

    // A fresh repository instance models process/session recovery. The new
    // transient transaction id must not create a second ledger row.
    const restartedRepositories = createRepositories(database);
    const replay = voiceTransaction(
      'voice-tx-after-restart',
      'speech:result-1:0',
    );
    await expect(
      restartedRepositories.transactions.saveRecognizedWithTags(replay, []),
    ).resolves.toMatchObject({
      status: 'ALREADY_COMMITTED',
      transaction: { id: first.id },
    });

    const rows = await restartedRepositories.transactions.list({
      includeDeleted: true,
    });
    expect(rows.map(row => row.id)).toEqual([first.id]);
    await expect(
      restartedRepositories.transactions.reconcileRecognizedOperation(
        replay,
        [],
      ),
    ).resolves.toMatchObject({ status: 'ALREADY_COMMITTED' });
  });

  it('rejects the same voice origin when canonical ledger data changes', async () => {
    const repositories = createRepositories(database);
    const first = voiceTransaction('voice-tx-2', 'speech:result-2:0');
    await repositories.transactions.saveRecognizedWithTags(first, []);

    await expect(
      repositories.transactions.saveRecognizedWithTags(
        voiceTransaction('voice-tx-2-conflict', 'speech:result-2:0', {
          amountMinor: 5_000,
        }),
        [],
      ),
    ).rejects.toBeInstanceOf(RecognizedPayloadMismatchError);
    await expect(
      repositories.transactions.list({ includeDeleted: true }),
    ).resolves.toHaveLength(1);
  });

  it('consumes a soft-deleted origin permanently and never resurrects it', async () => {
    const repositories = createRepositories(database);
    const first = voiceTransaction('voice-tx-3', 'speech:result-3:0');
    const committed = await repositories.transactions.saveRecognizedWithTags(
      first,
      [],
    );
    if (committed.status !== 'COMMITTED') {
      throw new Error('Expected initial operation to commit.');
    }
    await repositories.transactions.softDelete(
      { id: first.id, revision: committed.transaction.revision },
      '2026-08-12T04:01:00.000Z',
    );

    await expect(
      repositories.transactions.saveRecognizedWithTags(
        voiceTransaction('voice-tx-3-replay', 'speech:result-3:0'),
        [],
      ),
    ).resolves.toMatchObject({
      status: 'CONSUMED_DELETED',
      transaction: { id: first.id },
    });
    await expect(
      repositories.transactions.findBySourceReference(
        'VOICE',
        'speech:result-3:0',
        { includeDeleted: true },
      ),
    ).resolves.toMatchObject({ id: first.id, deletedAt: expect.any(String) });
    await expect(
      repositories.transactions.list({ includeDeleted: true }),
    ).resolves.toHaveLength(1);
  });

  it('rolls back both ledger and receipt when transaction validation fails', async () => {
    const repositories = createRepositories(database);
    const invalid = voiceTransaction('voice-tx-invalid', 'speech:invalid:0');

    await expect(
      repositories.transactions.saveRecognizedWithTags(invalid, [
        'tag-does-not-exist',
      ]),
    ).rejects.toThrow();
    await expect(
      repositories.transactions.findById(invalid.id, { includeDeleted: true }),
    ).resolves.toBeUndefined();
    const receiptCount = await database.execute<{ count: number }>(
      `SELECT COUNT(*) AS count FROM recognized_operation_receipts
        WHERE source = 'VOICE' AND source_reference_id = ?`,
      [invalid.sourceReferenceId!],
    );
    expect(receiptCount.rows[0]?.count).toBe(0);
  });

  it('rolls back the ledger when receipt persistence fails after validation', async () => {
    const repositories = createRepositories(database);
    await database.execute(
      `CREATE TRIGGER fail_voice_receipt
       BEFORE INSERT ON recognized_operation_receipts
       BEGIN
         SELECT RAISE(ABORT, 'receipt write failed');
       END`,
    );
    const candidate = voiceTransaction(
      'voice-tx-receipt-failure',
      'speech:receipt-failure:0',
    );

    await expect(
      repositories.transactions.saveRecognizedWithTags(candidate, []),
    ).rejects.toThrow();
    await expect(
      repositories.transactions.findById(candidate.id, {
        includeDeleted: true,
      }),
    ).resolves.toBeUndefined();
    const receiptCount = await database.execute<{ count: number }>(
      'SELECT COUNT(*) AS count FROM recognized_operation_receipts',
    );
    expect(receiptCount.rows[0]?.count).toBe(0);
  });

  it('does not deduplicate genuinely repeated TEXT entries', async () => {
    const repositories = createRepositories(database);
    const common = {
      source: 'TEXT' as const,
      originalText: '午饭十元',
    };
    await repositories.transactions.saveWithTags(
      {
        ...voiceTransaction('text-repeat-1', 'unused'),
        ...common,
        sourceReferenceId: 'text-session-1',
      },
      [],
    );
    await repositories.transactions.saveWithTags(
      {
        ...voiceTransaction('text-repeat-2', 'unused'),
        ...common,
        sourceReferenceId: 'text-session-2',
      },
      [],
    );
    await expect(repositories.transactions.list()).resolves.toHaveLength(2);
  });
});
