import { createPendingAgentBills } from '../../agent';
import {
  AgentOperationPayloadMismatchError,
  createRepositories,
  type DatabaseConnection,
} from '../../database';
import { openMigratedTestDatabase } from './testDatabase';

const now = new Date('2026-08-15T04:00:00.000Z');

describe('durable agent operation receipts', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('creates pending rows once and reconciles a restart replay', async () => {
    const first = await createPendingAgentBills(
      {
        callerId: 'codex.local',
        idempotencyKey: 'bill-20260815-001',
        text: '今天午饭25元，微信支付',
        referenceDate: now.toISOString(),
        timezoneOffsetMinutes: 480,
      },
      createRepositories(database),
      now,
    );
    expect(first).toMatchObject({
      status: 'COMMITTED',
      transactions: [
        {
          amountMinor: 2500,
          source: 'TEXT',
          confirmationStatus: 'PENDING',
        },
      ],
    });

    const replay = await createPendingAgentBills(
      {
        callerId: 'codex.local',
        idempotencyKey: 'bill-20260815-001',
        text: '今天午饭25元，微信支付',
        referenceDate: now.toISOString(),
        timezoneOffsetMinutes: 480,
      },
      createRepositories(database),
      new Date('2026-08-15T05:00:00.000Z'),
    );
    expect(replay.status).toBe('ALREADY_COMMITTED');
    expect(replay.transactions[0]?.id).toBe(first.transactions[0]?.id);
    await expect(
      createRepositories(database).transactions.list({ includeDeleted: true }),
    ).resolves.toHaveLength(1);
  });

  it('rejects the same caller key for different bill content', async () => {
    const repositories = createRepositories(database);
    await createPendingAgentBills(
      {
        callerId: 'claude.local',
        idempotencyKey: 'same-key',
        text: '午饭25元，现金',
        referenceDate: now.toISOString(),
      },
      repositories,
      now,
    );

    await expect(
      createPendingAgentBills(
        {
          callerId: 'claude.local',
          idempotencyKey: 'same-key',
          text: '午饭35元，现金',
          referenceDate: now.toISOString(),
        },
        repositories,
        now,
      ),
    ).rejects.toBeInstanceOf(AgentOperationPayloadMismatchError);
    await expect(repositories.transactions.list()).resolves.toHaveLength(1);
  });

  it('consumes a deleted agent operation and never resurrects it', async () => {
    const repositories = createRepositories(database);
    const committed = await createPendingAgentBills(
      {
        callerId: 'codex.local',
        idempotencyKey: 'deleted-key',
        text: '午饭25元，现金',
        referenceDate: now.toISOString(),
      },
      repositories,
      now,
    );
    const transaction = committed.transactions[0]!;
    await repositories.transactions.softDelete(
      { id: transaction.id, revision: transaction.revision },
      '2026-08-15T04:01:00.000Z',
    );

    await expect(
      createPendingAgentBills(
        {
          callerId: 'codex.local',
          idempotencyKey: 'deleted-key',
          text: '午饭25元，现金',
          referenceDate: now.toISOString(),
        },
        createRepositories(database),
        now,
      ),
    ).resolves.toMatchObject({ status: 'CONSUMED_DELETED' });
    await expect(
      repositories.transactions.list({ includeDeleted: true }),
    ).resolves.toHaveLength(1);
  });

  it('rolls back transactions when receipt commit fails', async () => {
    const repositories = createRepositories(database);
    await database.execute(
      `CREATE TRIGGER fail_agent_receipt_commit
       BEFORE UPDATE ON agent_operation_receipts
       BEGIN
         SELECT RAISE(ABORT, 'agent receipt write failed');
       END`,
    );

    await expect(
      createPendingAgentBills(
        {
          callerId: 'codex.local',
          idempotencyKey: 'receipt-failure',
          text: '午饭25元，现金',
          referenceDate: now.toISOString(),
        },
        repositories,
        now,
      ),
    ).rejects.toThrow();
    await expect(
      repositories.transactions.list({ includeDeleted: true }),
    ).resolves.toHaveLength(0);
    const receipts = await database.execute<{ count: number }>(
      'SELECT COUNT(*) AS count FROM agent_operation_receipts',
    );
    expect(receipts.rows[0]?.count).toBe(0);
  });
});
