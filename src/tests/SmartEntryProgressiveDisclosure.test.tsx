import { fireEvent, render, waitFor } from '@testing-library/react-native';

import type { ParsedTransactionCandidate } from '../classification/types';
import { SmartEntryScreen } from '../features/smart-entry/SmartEntryScreen';
import type {
  BookkeepingSessionSnapshot,
  SessionCandidate,
} from '../features/smart-entry/BookkeepingSession';
import type { SpeechRecognitionSnapshot } from '../speech/types';

const mockNavigate = jest.fn();
const mockListCategories = jest.fn();
const mockListAccounts = jest.fn();
const mockListProjects = jest.fn();
const mockListTags = jest.fn();
const mockListRules = jest.fn();
const mockListMerchants = jest.fn();
const mockPersistRecognizedSessionCandidate = jest.fn();
const mockPersistEditedSessionCandidate = jest.fn();
const mockPrepareSessionCandidateForEditing = jest.fn();

const mockRepositories = {
  categories: { listVisible: mockListCategories },
  accounts: { listVisibleByUsage: mockListAccounts },
  projects: { listActive: mockListProjects },
  tags: { listAll: mockListTags },
  userRules: { listEnabled: mockListRules, recordUsage: jest.fn() },
  merchants: { listAll: mockListMerchants },
};

let mockSession: BookkeepingSessionSnapshot;
let mockSpeechSnapshot: SpeechRecognitionSnapshot;
const mockResetForNewDraft = jest.fn();
const mockConsumeResult = jest.fn((_resultToken: string) => true);

jest.mock('@react-navigation/native', () => {
  const React = require('react') as typeof import('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate }),
    useIsFocused: () => true,
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(callback, [callback]);
    },
  };
});

jest.mock('../app/DatabaseProvider', () => ({
  useRepositories: () => mockRepositories,
}));

jest.mock('../features/smart-entry/BookkeepingSessionPersistence', () => ({
  persistRecognizedSessionCandidate: (...args: unknown[]) =>
    mockPersistRecognizedSessionCandidate(...args),
  persistEditedSessionCandidate: (...args: unknown[]) =>
    mockPersistEditedSessionCandidate(...args),
  prepareSessionCandidateForEditing: (...args: unknown[]) =>
    mockPrepareSessionCandidateForEditing(...args),
}));

jest.mock('../features/smart-entry/BookkeepingSession', () => ({
  bookkeepingSession: {
    beginEdit: jest.fn(() => true),
    clearReview: jest.fn(),
    discardReview: jest.fn(),
    discardReviewIfOwned: jest.fn(),
    dismissCompletion: jest.fn(),
    getSnapshot: jest.fn(() => mockSession),
    getCandidate: jest.fn((sessionId: string, candidateId: string) =>
      mockSession.sessionId === sessionId
        ? mockSession.candidates.find(candidate => candidate.id === candidateId)
        : undefined,
    ),
    advanceEntryGeneration: jest.fn(() => {
      const nextGeneration = mockSession.entryGeneration + 1;
      mockSession = { ...mockSession, entryGeneration: nextGeneration };
      return nextGeneration;
    }),
    isEntryGenerationCurrent: jest.fn(
      (generation: number) => generation === mockSession.entryGeneration,
    ),
    persistCandidate: jest.fn(),
    persistEditedCandidate: jest.fn(),
    start: jest.fn(),
  },
  useBookkeepingSession: () => mockSession,
}));

jest.mock('../speech/useSpeechRecognition', () => ({
  useSpeechRecognition: (
    _onFinalResult: (text: string, resultToken: string) => void,
  ) => {
    return [
      mockSpeechSnapshot,
      {
        start: jest.fn(),
        continueDictation: jest.fn(),
        stop: jest.fn(),
        cancel: jest.fn(),
        retry: jest.fn(),
        downloadModel: jest.fn(),
        useNetworkAndRetry: jest.fn(),
        openSettings: jest.fn(),
        consumeResult: (resultToken: string) => mockConsumeResult(resultToken),
        resetForNewDraft: () => mockResetForNewDraft(),
      },
    ];
  },
}));

const recognizedCandidate: ParsedTransactionCandidate = {
  type: 'EXPENSE',
  amountMinor: 2500,
  currency: 'CNY',
  occurredAt: '2026-08-09T04:00:00.000Z',
  categoryKey: 'expense.food',
  subcategoryKey: 'expense.food.lunch',
  accountKey: 'WECHAT',
  tags: [],
  confidence: 0.95,
  missingFields: [],
  ambiguityReasons: [],
  originalText: '午饭25，微信',
  sourceText: '午饭25,微信',
  categoryAlternatives: [],
  confidenceLevel: 'HIGH',
  suggestionSource: 'EXPLICIT_TEXT',
};

const matchedRuleCandidate: ParsedTransactionCandidate = {
  ...recognizedCandidate,
  matchedRuleId: 'matched-rule-1',
};

function idleSession(): BookkeepingSessionSnapshot {
  return {
    phase: 'IDLE',
    entryGeneration: 0,
    candidates: [],
    confirmedCount: 0,
    pendingCount: 0,
  };
}

function reviewingSession(): BookkeepingSessionSnapshot {
  return {
    phase: 'REVIEWING',
    entryGeneration: 0,
    sessionId: 'session-1',
    sourceText: recognizedCandidate.originalText,
    candidates: [
      {
        id: 'candidate-1',
        sessionId: 'session-1',
        entryGeneration: 0,
        transactionId: 'transaction-1',
        feedbackId: 'feedback-1',
        learnedRuleId: 'rule-1',
        idempotencyKey: 'session-1:candidate-1',
        createdAt: '2026-08-09T04:00:00.000Z',
        candidate: recognizedCandidate,
        inputSource: 'VOICE',
        reviewState: 'READY',
        originKey: 'speech:result-original:0',
      },
    ],
    confirmedCount: 0,
    pendingCount: 0,
  };
}

function resolveReferences() {
  mockListCategories.mockResolvedValue([]);
  mockListAccounts.mockResolvedValue([]);
  mockListProjects.mockResolvedValue([]);
  mockListTags.mockResolvedValue([]);
  mockListRules.mockResolvedValue([]);
  mockListMerchants.mockResolvedValue([]);
}

describe('smart entry progressive disclosure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConsumeResult.mockReturnValue(true);
    mockRepositories.userRules.recordUsage.mockResolvedValue(undefined);
    mockPersistRecognizedSessionCandidate.mockResolvedValue({
      transaction: {},
      outcome: 'COMMITTED',
    });
    mockPersistEditedSessionCandidate.mockResolvedValue({
      transaction: {},
      wasAlreadySaved: false,
    });
    mockPrepareSessionCandidateForEditing.mockReturnValue({
      draft: {
        type: 'EXPENSE',
        amountText: '25.00',
        occurredAt: new Date('2026-08-09T04:00:00.000Z'),
        categoryId: 'category-food',
        accountId: 'account-wechat',
        merchantName: '',
        tagIds: [],
        note: '',
      },
    });
    resolveReferences();
    mockSession = idleSession();
    mockSpeechSnapshot = {
      draftGeneration: 0,
      turnGeneration: 0,
      status: 'IDLE',
      partialText: '',
      usingNetworkFallback: false,
    };
  });

  it('uses one contextual primary action for the unified composer', async () => {
    const screen = await render(<SmartEntryScreen />);
    await screen.findByText('记一笔');

    expect(screen.getByRole('button', { name: '开始语音' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: '核对账单' })).toBeNull();
    expect(screen.getByRole('button', { name: '手动填写' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '待处理' })).toBeOnTheScreen();

    fireEvent.changeText(screen.getByLabelText('记账描述'), '午饭25，微信');

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '开始语音' })).toBeNull();
      expect(
        screen.getByRole('button', { name: '核对账单' }),
      ).toBeOnTheScreen();
    });
    expect(
      screen.getByText(/只有点击“确认入账”才会写入账本/),
    ).toBeOnTheScreen();
  }, 15_000);

  it('hides the composer while candidates are awaiting review', async () => {
    const { bookkeepingSession: mockedBookkeepingSession } = jest.requireMock(
      '../features/smart-entry/BookkeepingSession',
    ) as {
      bookkeepingSession: { discardReview: jest.Mock };
    };
    mockSession = {
      phase: 'REVIEWING',
      entryGeneration: 0,
      sessionId: 'session-1',
      sourceText: recognizedCandidate.originalText,
      candidates: [
        {
          id: 'candidate-1',
          sessionId: 'session-1',
          entryGeneration: 0,
          transactionId: 'transaction-1',
          feedbackId: 'feedback-1',
          learnedRuleId: 'rule-1',
          idempotencyKey: 'session-1:candidate-1',
          createdAt: '2026-08-09T04:00:00.000Z',
          candidate: recognizedCandidate,
          inputSource: 'TEXT',
          reviewState: 'READY',
        },
      ],
      confirmedCount: 0,
      pendingCount: 0,
    };

    const screen = await render(<SmartEntryScreen />);
    await screen.findByText('确认账单');

    expect(screen.getByText('1 笔')).toBeOnTheScreen();
    expect(screen.getByText('第 1 笔')).toBeOnTheScreen();
    expect(screen.queryByLabelText('记账描述')).toBeNull();
    expect(screen.queryByRole('button', { name: '开始语音' })).toBeNull();
    expect(screen.queryByRole('button', { name: '核对账单' })).toBeNull();

    await fireEvent.press(
      screen.getByRole('button', {
        name: '放弃本次结果并重新输入',
      }),
    );
    await waitFor(() => {
      expect(mockedBookkeepingSession.discardReview).toHaveBeenCalledTimes(1);
    });
  });

  it('shows a page-level load error with one recovery action and clears it after success', async () => {
    mockListCategories
      .mockRejectedValueOnce(new Error('local rules unavailable'))
      .mockResolvedValue([]);

    const screen = await render(<SmartEntryScreen />);
    await screen.findByText(/读取本地识别资料失败。/);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: '重新加载' }));

    await waitFor(() => {
      expect(screen.getByText('记一笔')).toBeOnTheScreen();
    });
    expect(screen.queryByText(/读取本地识别资料失败。/)).toBeNull();
  });

  it('isolates completion from stale speech errors until the user starts another entry', async () => {
    const { bookkeepingSession: mockedBookkeepingSession } = jest.requireMock(
      '../features/smart-entry/BookkeepingSession',
    ) as {
      bookkeepingSession: {
        advanceEntryGeneration: jest.Mock;
        dismissCompletion: jest.Mock;
        start: jest.Mock;
      };
    };
    mockSession = {
      phase: 'COMPLETED',
      entryGeneration: 0,
      candidates: [],
      confirmedCount: 1,
      pendingCount: 0,
      completion: {
        id: 'completion-1',
        confirmedCount: 1,
        pendingCount: 0,
        message: '已确认入账 1 笔。',
      },
    };
    mockSpeechSnapshot = {
      draftGeneration: 0,
      turnGeneration: 0,
      status: 'ERROR',
      partialText: '今天在网吧消费10元',
      resultToken: 'result-from-completed-entry',
      hasFreshTurnEvidence: false,
      usingNetworkFallback: false,
      error: {
        code: 'language-not-supported',
        message: '当前语音服务不支持中文普通话识别。',
        canRetry: true,
        canUseNetwork: true,
        canDownloadModel: false,
        canOpenSettings: false,
      },
    };

    const screen = await render(<SmartEntryScreen />);
    await screen.findByText('已确认入账 1 笔。');

    expect(screen.queryByText(/不支持中文普通话识别/)).toBeNull();
    expect(screen.queryByRole('button', { name: '开始语音' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '再记一笔' }));
    expect(mockedBookkeepingSession.dismissCompletion).toHaveBeenCalledWith(
      'completion-1',
    );
    expect(
      mockedBookkeepingSession.advanceEntryGeneration.mock
        .invocationCallOrder[1],
    ).toBeLessThan(mockResetForNewDraft.mock.invocationCallOrder[1] ?? 0);
    expect(mockResetForNewDraft.mock.invocationCallOrder[1]).toBeLessThan(
      mockedBookkeepingSession.dismissCompletion.mock.invocationCallOrder[0] ??
        0,
    );

    mockSession = idleSession();
    mockSession.entryGeneration = 2;
    screen.rerender(<SmartEntryScreen />);
    await screen.findByText('记一笔');
    expect(
      screen.queryByRole('button', { name: '使用已转写文字继续' }),
    ).toBeNull();
    expect(mockedBookkeepingSession.start).not.toHaveBeenCalled();
  });

  it('does not revive the confirmed candidate through stale speech after starting another entry', async () => {
    const { bookkeepingSession: mockedBookkeepingSession } = jest.requireMock(
      '../features/smart-entry/BookkeepingSession',
    ) as {
      bookkeepingSession: {
        dismissCompletion: jest.Mock;
        persistEditedCandidate: jest.Mock;
        start: jest.Mock;
      };
    };
    mockSession = reviewingSession();
    mockedBookkeepingSession.persistEditedCandidate.mockResolvedValue({
      status: 'SAVED',
      outcome: 'COMMITTED',
    });

    const screen = await render(<SmartEntryScreen />);
    await screen.findByText('确认账单');
    await fireEvent.press(screen.getByRole('button', { name: '确认入账' }));
    expect(
      mockedBookkeepingSession.persistEditedCandidate,
    ).toHaveBeenCalledTimes(1);

    mockSession = {
      phase: 'COMPLETED',
      entryGeneration: 0,
      candidates: [],
      confirmedCount: 1,
      pendingCount: 0,
      completion: {
        id: 'completion-after-confirm',
        confirmedCount: 1,
        pendingCount: 0,
        message: '已确认入账 1 笔。',
      },
    };
    screen.rerender(<SmartEntryScreen />);
    await screen.findByText('已确认入账 1 笔。');
    await fireEvent.press(screen.getByRole('button', { name: '再记一笔' }));

    mockSession = {
      ...idleSession(),
      entryGeneration: mockSession.entryGeneration,
    };
    mockSpeechSnapshot = {
      draftGeneration: 0,
      turnGeneration: 0,
      status: 'ERROR',
      partialText: '今天在网吧消费10元',
      resultToken: 'result-original',
      hasFreshTurnEvidence: false,
      usingNetworkFallback: false,
      error: {
        code: 'no-speech',
        message: '没有听清有效内容，请靠近麦克风后重试。',
        canRetry: true,
        canUseNetwork: false,
        canDownloadModel: false,
        canOpenSettings: false,
      },
    };
    screen.rerender(<SmartEntryScreen />);
    await screen.findByText('记一笔');

    expect(
      screen.queryByRole('button', { name: '使用已转写文字继续' }),
    ).toBeNull();
    expect(mockedBookkeepingSession.start).not.toHaveBeenCalled();
    expect(mockedBookkeepingSession.dismissCompletion).toHaveBeenCalledWith(
      'completion-after-confirm',
    );
  });

  it('rolls back only its own voice session when result-token consume loses CAS', async () => {
    const { bookkeepingSession: mockedBookkeepingSession } = jest.requireMock(
      '../features/smart-entry/BookkeepingSession',
    ) as {
      bookkeepingSession: {
        discardReviewIfOwned: jest.Mock;
        start: jest.Mock;
      };
    };
    mockedBookkeepingSession.start.mockReturnValue('voice-session-new');
    mockConsumeResult.mockReturnValue(false);
    mockSpeechSnapshot = {
      draftGeneration: 1,
      turnGeneration: 1,
      status: 'ERROR',
      partialText: '今天在网吧消费10元',
      resultToken: 'result-once',
      hasFreshTurnEvidence: true,
      usingNetworkFallback: false,
      error: {
        code: 'no-speech',
        message: '没有听清有效内容。',
        canRetry: true,
        canUseNetwork: false,
        canDownloadModel: false,
        canOpenSettings: false,
      },
    };

    const screen = await render(<SmartEntryScreen />);
    await screen.findByText('记一笔');
    const useResult = screen.getByRole('button', {
      name: '使用已转写文字继续',
    });
    await fireEvent.press(useResult);
    await fireEvent.press(useResult);

    expect(mockedBookkeepingSession.start).toHaveBeenCalledTimes(1);
    expect(mockConsumeResult).toHaveBeenCalledTimes(1);
    expect(mockConsumeResult).toHaveBeenCalledWith('result-once');
    expect(mockedBookkeepingSession.discardReviewIfOwned).toHaveBeenCalledWith(
      'voice-session-new',
      0,
    );
  });

  it.each([
    ['COMMITTED', 1],
    ['ALREADY_COMMITTED', 0],
  ] as const)(
    'records rule usage only for a fresh %s commit',
    async (outcome, expectedCalls) => {
      const { bookkeepingSession: mockedBookkeepingSession } = jest.requireMock(
        '../features/smart-entry/BookkeepingSession',
      ) as {
        bookkeepingSession: {
          persistEditedCandidate: jest.Mock;
        };
      };
      mockSession = reviewingSession();
      mockSession = {
        ...mockSession,
        candidates: mockSession.candidates.map(item => ({
          ...item,
          candidate: matchedRuleCandidate,
        })),
      };
      mockedBookkeepingSession.persistEditedCandidate.mockImplementation(
        async (
          _sessionId: string,
          _candidateId: string,
          writer: (
            candidate: SessionCandidate,
          ) => Promise<'COMMITTED' | 'ALREADY_COMMITTED'>,
        ) => {
          const candidate = mockSession.candidates[0];
          if (candidate === undefined) {
            throw new Error('Expected a session candidate.');
          }
          return { status: 'SAVED', outcome: await writer(candidate) };
        },
      );
      mockPersistEditedSessionCandidate.mockResolvedValue({
        transaction: {},
        wasAlreadySaved: outcome === 'ALREADY_COMMITTED',
      });

      const screen = await render(<SmartEntryScreen />);
      await screen.findByText('确认账单');
      await fireEvent.press(screen.getByRole('button', { name: '确认入账' }));

      expect(mockRepositories.userRules.recordUsage).toHaveBeenCalledTimes(
        expectedCalls,
      );
    },
  );
});
