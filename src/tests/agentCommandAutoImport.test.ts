import { NativeModules } from 'react-native';

import { createRepositories, type DatabaseConnection } from '../database';
import { importPendingAgentCommandsAutomatically } from '../importers/agentCommandAutoImport';
import { openMigratedTestDatabase } from './database/testDatabase';

const COMMAND_KEY = 'a'.repeat(64);

describe('Android Internal agent command import', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => {
    delete NativeModules.AgentCommandInbox;
    database.close();
  });

  it('creates only a pending transaction and atomically records the receipt', async () => {
    const repositories = createRepositories(database);
    let pending = [
      {
        key: COMMAND_KEY,
        callerId: 'codex-local',
        idempotencyKey: 'bill-20260815-001',
        text: '今天午饭25元，微信支付',
        referenceDate: '2026-08-15T04:00:00.000Z',
        timezoneOffsetMinutes: 480,
      },
    ];
    const complete = jest.fn(async (key: string) => {
      pending = pending.filter(item => item.key !== key);
    });
    NativeModules.AgentCommandInbox = {
      listPending: jest.fn(async () => pending),
      complete,
    };

    await expect(
      importPendingAgentCommandsAutomatically(repositories),
    ).resolves.toEqual({ queuedCount: 1, importedCount: 1, failedCount: 0 });
    expect(complete).toHaveBeenCalledWith(
      COMMAND_KEY,
      'COMMITTED',
      [expect.any(String)],
      expect.any(String),
      null,
    );

    const transaction = await database.execute<{
      confirmation_status: string;
      source: string;
      amount_minor: number;
    }>(
      `SELECT confirmation_status, source, amount_minor
       FROM transactions WHERE source_reference_id LIKE 'agent:%'`,
    );
    expect(transaction.rows).toEqual([
      { confirmation_status: 'PENDING', source: 'TEXT', amount_minor: 2500 },
    ]);
    const receipt = await database.execute<{ state: string }>(
      `SELECT state FROM agent_operation_receipts
       WHERE caller_id = ? AND idempotency_key = ?`,
      ['codex-local', 'bill-20260815-001'],
    );
    expect(receipt.rows).toEqual([{ state: 'COMMITTED' }]);
  });

  it('acknowledges a same-payload replay without creating a duplicate', async () => {
    const repositories = createRepositories(database);
    const command = {
      key: COMMAND_KEY,
      callerId: 'claude-code-local',
      idempotencyKey: 'bill-replay-001',
      text: '打车18元，支付宝',
      referenceDate: '2026-08-15T04:00:00.000Z',
      timezoneOffsetMinutes: 480,
    };
    NativeModules.AgentCommandInbox = {
      listPending: jest.fn(async () => [command]),
      complete: jest.fn(async () => undefined),
    };

    await importPendingAgentCommandsAutomatically(repositories);
    await expect(
      importPendingAgentCommandsAutomatically(repositories),
    ).resolves.toMatchObject({ importedCount: 1, failedCount: 0 });
    const count = await database.execute<{ count: number }>(
      `SELECT COUNT(*) AS count FROM transactions
       WHERE source_reference_id LIKE 'agent:%'`,
    );
    expect(count.rows[0]?.count).toBe(1);
  });

  it('records a rejected receipt for a conflicting idempotency payload', async () => {
    const repositories = createRepositories(database);
    const native = {
      listPending: jest.fn(async () => [
        {
          key: COMMAND_KEY,
          callerId: 'codex-local',
          idempotencyKey: 'conflict-001',
          text: '午饭25元',
          referenceDate: '2026-08-15T04:00:00.000Z',
        },
      ]),
      complete: jest.fn(async () => undefined),
    };
    NativeModules.AgentCommandInbox = native;
    await importPendingAgentCommandsAutomatically(repositories);
    native.listPending.mockResolvedValueOnce([
      {
        key: 'b'.repeat(64),
        callerId: 'codex-local',
        idempotencyKey: 'conflict-001',
        text: '午饭35元',
        referenceDate: '2026-08-15T04:00:00.000Z',
      },
    ]);

    await expect(
      importPendingAgentCommandsAutomatically(repositories),
    ).resolves.toEqual({ queuedCount: 1, importedCount: 0, failedCount: 1 });
    expect(native.complete).toHaveBeenCalledTimes(2);
    expect(native.complete).toHaveBeenLastCalledWith(
      'b'.repeat(64),
      'REJECTED',
      [],
      expect.any(String),
      'AGENT-IDEMPOTENCY-PAYLOAD-MISMATCH',
    );
  });
});
