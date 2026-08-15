import {
  AgentSyncOperationError,
  agentSyncRevisionEtag,
  cancelAgentSyncOperation,
  claimAgentSyncOperation,
  completeAgentSyncOperation,
  createAgentSyncOperation,
  expireAgentSyncOperation,
  parseAgentSyncRevisionEtag,
  toAgentSyncOperationReceipt,
  toAgentSyncClaimedOperation,
} from '../agent/AgentSyncOperationStateMachine';
import { buildAgentSyncCreateRequest } from '../agent/AgentSyncProtocol';

const now = '2026-08-15T04:00:00.000Z';
const later = '2026-08-15T04:01:00.000Z';
const expiresAt = '2026-08-15T04:15:00.000Z';

function create(text = '今天午饭25元，微信支付') {
  const envelope = buildAgentSyncCreateRequest({
    callerId: 'codex-production',
    deviceId: 'device-01',
    idempotencyKey: 'bill-20260815-001',
    text,
  });
  return createAgentSyncOperation({
    accountId: 'account-01',
    operationId: 'operation-01',
    envelope,
    now,
    expiresAt,
  });
}

describe('agent sync operation state machine', () => {
  it('round-trips strong revision ETags and rejects weak or compound values', () => {
    const record = create().record;
    expect(agentSyncRevisionEtag(record)).toBe('"1"');
    expect(parseAgentSyncRevisionEtag('"1"')).toBe(1);
    for (const value of ['W/"1"', '"0"', '"1", "2"', '*', '1']) {
      expect(() => parseAgentSyncRevisionEtag(value)).toThrow(
        AgentSyncOperationError,
      );
    }
  });

  it('creates, claims and commits with optimistic revisions', () => {
    const created = create();
    expect(created.disposition).toBe('CREATED');
    expect(created.record.status).toBe('QUEUED');
    expect(created.record.revision).toBe(1);

    const claimed = claimAgentSyncOperation(created.record, 1, later);
    expect(claimed.status).toBe('CLAIMED');
    expect(claimed.revision).toBe(2);
    expect(toAgentSyncClaimedOperation(claimed)).toMatchObject({
      command: 'bill.create-pending',
      callerId: 'codex-production',
      idempotencyKey: 'bill-20260815-001',
      text: '今天午饭25元，微信支付',
    });

    const committed = completeAgentSyncOperation(
      claimed,
      2,
      '2026-08-15T04:02:00.000Z',
      { status: 'COMMITTED', transactionIds: ['transaction-01'] },
    );
    expect(committed.status).toBe('COMMITTED');
    expect(committed.revision).toBe(3);
    expect(toAgentSyncOperationReceipt(committed)).not.toHaveProperty(
      'payloadSha256',
    );
    expect(toAgentSyncOperationReceipt(committed)).not.toHaveProperty(
      'request',
    );
    expect(toAgentSyncOperationReceipt(committed)).not.toHaveProperty('text');
  });

  it('returns the original receipt for the same idempotency key and payload', () => {
    const created = create();
    const duplicate = createAgentSyncOperation({
      accountId: 'account-01',
      operationId: 'ignored-new-operation-id',
      envelope: buildAgentSyncCreateRequest({
        callerId: 'codex-production',
        deviceId: 'device-01',
        idempotencyKey: 'bill-20260815-001',
        text: '今天午饭25元，微信支付',
      }),
      now,
      expiresAt,
      existing: created.record,
    });

    expect(duplicate.disposition).toBe('DUPLICATE');
    expect(duplicate.record).toBe(created.record);
    expect(duplicate.receipt.operationId).toBe('operation-01');
  });

  it('rejects the same idempotency key with a different payload', () => {
    const created = create();
    expect(() =>
      createAgentSyncOperation({
        accountId: 'account-01',
        operationId: 'operation-02',
        envelope: buildAgentSyncCreateRequest({
          callerId: 'codex-production',
          deviceId: 'device-01',
          idempotencyKey: 'bill-20260815-001',
          text: '今天晚饭26元，微信支付',
        }),
        now,
        expiresAt,
        existing: created.record,
      }),
    ).toThrow('another payload');
  });

  it('rejects a forged payload fingerprint before persistence', () => {
    const envelope = buildAgentSyncCreateRequest({
      callerId: 'codex-production',
      deviceId: 'device-01',
      idempotencyKey: 'bill-20260815-001',
      text: '今天午饭25元，微信支付',
    });
    envelope.headers['X-QingJi-Payload-SHA256'] = '0'.repeat(64);

    expect(() =>
      createAgentSyncOperation({
        accountId: 'account-01',
        operationId: 'operation-01',
        envelope,
        now,
        expiresAt,
      }),
    ).toThrow('fingerprint');
  });

  it('allows cancellation only before the app claims the operation', () => {
    const created = create().record;
    const cancelled = cancelAgentSyncOperation(created, 1, later);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.completedAt).toBe(later);

    const claimed = claimAgentSyncOperation(created, 1, later);
    expect(() => cancelAgentSyncOperation(claimed, 2, later)).toThrow(
      AgentSyncOperationError,
    );
  });

  it('fails closed on stale revisions and invalid completion data', () => {
    const claimed = claimAgentSyncOperation(create().record, 1, later);
    expect(() =>
      completeAgentSyncOperation(claimed, 1, '2026-08-15T04:02:00.000Z', {
        status: 'COMMITTED',
        transactionIds: ['transaction-01'],
      }),
    ).toThrow('revision changed');
    expect(() =>
      completeAgentSyncOperation(claimed, 2, '2026-08-15T04:02:00.000Z', {
        status: 'COMMITTED',
        transactionIds: [],
      }),
    ).toThrow('1 to 20');
  });

  it('expires unfinished operations but never terminal ones', () => {
    const created = create().record;
    const expired = expireAgentSyncOperation(
      created,
      1,
      '2026-08-15T04:15:00.000Z',
    );
    expect(expired.status).toBe('EXPIRED');

    const cancelled = cancelAgentSyncOperation(created, 1, later);
    expect(() =>
      expireAgentSyncOperation(cancelled, 2, '2026-08-15T04:15:00.000Z'),
    ).toThrow('unfinished');
  });
});
