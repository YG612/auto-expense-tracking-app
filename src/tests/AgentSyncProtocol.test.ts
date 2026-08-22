import {
  AgentSyncProtocolError,
  buildAgentSyncCreateRequest,
  parseAgentSyncOperationReceipt,
} from '../agent/AgentSyncProtocol';

const baseInput = {
  callerId: 'codex-production',
  deviceId: 'device-01',
  idempotencyKey: 'bill-20260815-001',
  text: '今天午饭25元，微信支付',
  referenceDate: '2026-08-15T04:00:00+00:00',
  timezoneOffsetMinutes: 480,
} as const;

describe('production agent sync protocol', () => {
  it('builds a deterministic request without credentials', () => {
    const first = buildAgentSyncCreateRequest(baseInput);
    const second = buildAgentSyncCreateRequest(baseInput);

    expect(first).toEqual(second);
    expect(first.headers['X-QingJi-Payload-SHA256']).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.headers['Idempotency-Key']).toBe(baseInput.idempotencyKey);
    expect(JSON.stringify(first)).not.toMatch(
      /authorization|bearer|access.?token|refresh.?token/iu,
    );
  });

  it('changes the payload fingerprint but not the idempotency key on conflict', () => {
    const first = buildAgentSyncCreateRequest(baseInput);
    const conflict = buildAgentSyncCreateRequest({
      ...baseInput,
      text: '今天晚饭26元，微信支付',
    });

    expect(conflict.headers['Idempotency-Key']).toBe(
      first.headers['Idempotency-Key'],
    );
    expect(conflict.headers['X-QingJi-Payload-SHA256']).not.toBe(
      first.headers['X-QingJi-Payload-SHA256'],
    );
  });

  it('shares the 500-character boundary and rejects unsafe identifiers', () => {
    expect(() =>
      buildAgentSyncCreateRequest({ ...baseInput, text: '餐'.repeat(500) }),
    ).not.toThrow();
    expect(() =>
      buildAgentSyncCreateRequest({ ...baseInput, text: '餐'.repeat(501) }),
    ).toThrow(AgentSyncProtocolError);
    expect(() =>
      buildAgentSyncCreateRequest({
        ...baseInput,
        callerId: 'codex\nAuthorization: Bearer stolen',
      }),
    ).toThrow(AgentSyncProtocolError);
  });

  it('accepts a minimal committed receipt', () => {
    const receipt = parseAgentSyncOperationReceipt({
      schemaVersion: 1,
      operationId: 'operation-01',
      requestKey: 'a'.repeat(64),
      status: 'COMMITTED',
      transactionIds: ['transaction-01'],
      createdAt: '2026-08-15T04:00:00.000Z',
      updatedAt: '2026-08-15T04:00:01.000Z',
      completedAt: '2026-08-15T04:00:01.000Z',
    });

    expect(receipt.status).toBe('COMMITTED');
    expect(receipt.transactionIds).toEqual(['transaction-01']);
  });

  it('rejects receipts that leak bill text or credentials', () => {
    const baseReceipt = {
      schemaVersion: 1,
      operationId: 'operation-01',
      requestKey: 'a'.repeat(64),
      status: 'QUEUED',
      transactionIds: [],
      createdAt: '2026-08-15T04:00:00.000Z',
      updatedAt: '2026-08-15T04:00:00.000Z',
    };

    for (const leaked of [
      { text: '午饭25元' },
      { authorization: 'Bearer secret' },
      { accountBalance: 123_45 },
    ]) {
      expect(() =>
        parseAgentSyncOperationReceipt({ ...baseReceipt, ...leaked }),
      ).toThrow('unapproved field');
    }
  });

  it('rejects inconsistent terminal status fields', () => {
    expect(() =>
      parseAgentSyncOperationReceipt({
        schemaVersion: 1,
        operationId: 'operation-01',
        requestKey: 'a'.repeat(64),
        status: 'REJECTED',
        transactionIds: ['transaction-should-not-leak'],
        createdAt: '2026-08-15T04:00:00.000Z',
        updatedAt: '2026-08-15T04:00:01.000Z',
        completedAt: '2026-08-15T04:00:01.000Z',
        errorCode: 'AGENT-PAYLOAD-INVALID',
      }),
    ).toThrow(AgentSyncProtocolError);
  });
});
