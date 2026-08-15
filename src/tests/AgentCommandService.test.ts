import { createPendingAgentBills, previewAgentBill } from '../agent';

describe('AgentCommandService', () => {
  it('returns the same local-parser evidence through a stable agent contract', () => {
    const result = previewAgentBill({
      text: '今天午饭25元，微信支付',
      referenceDate: '2026-08-15T04:00:00.000Z',
      timezoneOffsetMinutes: 480,
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      command: 'bill.preview',
      candidateCount: 1,
      candidates: [
        {
          type: 'EXPENSE',
          amountMinor: 2500,
          currency: 'CNY',
          categoryKey: 'expense.food',
          subcategoryKey: 'expense.food.lunch',
          accountKey: 'WECHAT',
          reviewDisposition: 'DIRECT_CONFIRM',
        },
      ],
    });
  });

  it('uses injected reference data without giving the agent a database handle', () => {
    const result = previewAgentBill(
      {
        text: '今天午饭25元',
        referenceDate: '2026-08-15T04:00:00.000Z',
        timezoneOffsetMinutes: 480,
      },
      {
        recentAccountKey: 'CASH',
        accounts: [
          {
            id: 'account-cash',
            name: '现金',
            type: 'CASH',
            currency: 'CNY',
            includeInNetWorth: true,
            isHidden: false,
            sortOrder: 1,
            createdAt: '2026-08-15T00:00:00.000Z',
            updatedAt: '2026-08-15T00:00:00.000Z',
          },
        ],
      },
    );

    expect(result.candidates[0]).toMatchObject({
      accountKey: 'CASH',
      accountResolutionSource: 'RECENT_FALLBACK',
      reviewDisposition: 'REVIEW_CONFIRM',
    });
  });

  it.each([841, -841, 1.5])(
    'rejects unsafe timezone offset %p at the shared boundary',
    timezoneOffsetMinutes => {
      expect(() =>
        previewAgentBill({
          text: '午饭25元，现金',
          timezoneOffsetMinutes,
        }),
      ).toThrow(/timezoneOffsetMinutes/u);
    },
  );

  it.each(['../forged', 'caller with spaces', '', 'x'.repeat(129)])(
    'rejects forged caller identifiers before repository access: %p',
    async callerId => {
      const repositories = {
        accounts: { listAll: jest.fn() },
        agentOperations: {
          reconcile: jest.fn(),
          commitPending: jest.fn(),
        },
        categories: { listAll: jest.fn() },
        merchants: { listAll: jest.fn() },
        projects: { listAll: jest.fn() },
        tags: { listAll: jest.fn() },
        userRules: { listEnabled: jest.fn() },
      };

      await expect(
        createPendingAgentBills(
          {
            callerId,
            idempotencyKey: 'safe-key',
            text: '午饭25元',
          },
          repositories,
        ),
      ).rejects.toMatchObject({ code: 'AGENT-IDENTIFIER-INVALID' });
      expect(repositories.agentOperations.reconcile).not.toHaveBeenCalled();
    },
  );
});
