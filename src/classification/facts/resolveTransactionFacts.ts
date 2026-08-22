import type { TransactionType } from '../../domain/entities';
import {
  canonicalActionForToken,
  transactionActionTokenSource,
  TRANSACTION_ACTION_LEXICON_VERSION,
} from '../../language/transactionActionLexicon';
import {
  accountTypeForToken,
  transactionAccountTokenSource,
} from './accountLexicon';
import type {
  CanonicalTransactionAction,
  MerchantCompatibilityProjection,
  TransactionAccountFact,
  TransactionCounterpartyFact,
  TransactionFactConflict,
  TransactionFactEvidence,
  TransactionFactResolution,
  TransactionFactSpan,
  TransactionPurpose,
} from './types';
import type {
  FundSemantics,
  TransactionEventDirection,
} from '../parsers/transactionEventFacts';

export const TRANSACTION_FACT_RULESET_VERSION = `transaction-facts/${TRANSACTION_ACTION_LEXICON_VERSION}`;

const ENTITY_SOURCE = String.raw`[\p{Script=Han}A-Za-z0-9·&（）()_-]{1,16}?`;
const NUMERIC_SOURCE = String.raw`(?:\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千万]+(?:点[零〇一二两三四五六七八九]{1,2})?)`;
const MONEY_SOURCE = String.raw`(?:[¥￥]\s*)?${NUMERIC_SOURCE}\s*(?:元|块钱?|块)`;
const MONEY_ACTION_SOURCE = transactionActionTokenSource(['PAY', 'SEND_MONEY']);
const ACTION_ASPECT_SOURCE = String.raw`(?:了|过去了?|过去|出去|一下)?`;

const OUTGOING_PARTY_FIRST = new RegExp(
  String.raw`(?:我\s*)?(?:给|向)\s*(${ENTITY_SOURCE})\s*(${MONEY_ACTION_SOURCE})\s*${ACTION_ASPECT_SOURCE}\s*(${MONEY_SOURCE})`,
  'gu',
);
const OUTGOING_ACTION_FIRST = new RegExp(
  String.raw`(?:我\s*)?(${MONEY_ACTION_SOURCE})\s*${ACTION_ASPECT_SOURCE}\s*(${MONEY_SOURCE})\s*(?:给|向)\s*(${ENTITY_SOURCE})(?=\s*(?:[,，。；;]|$))`,
  'gu',
);
const INCOMING_PARTY_FIRST = new RegExp(
  String.raw`(?:^|[,，。；;]\s*)(${ENTITY_SOURCE})\s*(?:给|向)我\s*(${MONEY_ACTION_SOURCE})\s*${ACTION_ASPECT_SOURCE}\s*(${MONEY_SOURCE})`,
  'gu',
);
const BENEFICIARY_FEE = new RegExp(
  String.raw`(?:我\s*)?(?:给|替|帮)\s*(${ENTITY_SOURCE})\s*(交|缴)\s*(?:了\s*)?((?:学费|学杂费|书本费|培训费|报名费))\s*(${MONEY_SOURCE})`,
  'gu',
);
const RED_PACKET_FRAME_DEFINITIONS = [
  {
    ruleId: 'frame.expense.red-packet.party-first',
    pattern: new RegExp(
      String.raw`(?:我\s*)?(?:给|向)\s*(${ENTITY_SOURCE})\s*(发)\s*${ACTION_ASPECT_SOURCE}\s*(红包)\s*(${MONEY_SOURCE})`,
      'dgu',
    ),
    partyCapture: 1,
    actionCapture: 2,
    purposeCapture: 3,
    moneyCapture: 4,
  },
  {
    ruleId: 'frame.expense.red-packet.amount-first',
    pattern: new RegExp(
      String.raw`(?:我\s*)?(?:给|向)\s*(${ENTITY_SOURCE})\s*(发)\s*${ACTION_ASPECT_SOURCE}\s*(${MONEY_SOURCE})\s*(红包)`,
      'dgu',
    ),
    partyCapture: 1,
    actionCapture: 2,
    purposeCapture: 4,
    moneyCapture: 3,
  },
] as const;
const OWN_ACCOUNT_SOURCE = transactionAccountTokenSource();
const INTERNAL_ACCOUNT_TRANSFER = new RegExp(
  String.raw`从\s*(${OWN_ACCOUNT_SOURCE})\s*(转账|转|划款|划|打款|打|汇款|汇)\s*${ACTION_ASPECT_SOURCE}\s*(?:到|入|进)\s*(${OWN_ACCOUNT_SOURCE})\s*(${MONEY_SOURCE})`,
  'gu',
);
const DEBT_FRAME_DEFINITIONS = [
  {
    ruleId: 'frame.debt.lend-out',
    pattern: new RegExp(
      String.raw`(?:我\s*)?(借给)\s*(${ENTITY_SOURCE})\s*(${MONEY_SOURCE})`,
      'dgu',
    ),
    action: 'LEND',
    direction: 'OUTFLOW',
    transactionType: 'LEND_OUT',
    counterpartyRole: 'PAYEE',
  },
  {
    ruleId: 'frame.debt.repayment-out',
    pattern: new RegExp(
      String.raw`(?:我\s*)?(还(?:给)?)\s*(${ENTITY_SOURCE})\s*(${MONEY_SOURCE})`,
      'dgu',
    ),
    action: 'REPAY',
    direction: 'OUTFLOW',
    transactionType: 'REPAYMENT_OUT',
    counterpartyRole: 'PAYEE',
  },
  {
    ruleId: 'frame.debt.borrow-in',
    pattern: new RegExp(
      String.raw`(?:我\s*)?(?:向|从)\s*(${ENTITY_SOURCE})\s*(借)\s*(?:了\s*)?(${MONEY_SOURCE})`,
      'dgu',
    ),
    action: 'BORROW',
    direction: 'INFLOW',
    transactionType: 'BORROW_IN',
    counterpartyRole: 'PAYER',
    actionCapture: 2,
    partyCapture: 1,
  },
  {
    ruleId: 'frame.debt.repayment-in',
    pattern: new RegExp(
      String.raw`(?:^|[,，。；;]\s*)(${ENTITY_SOURCE})\s*(还(?:给)?)我\s*(${MONEY_SOURCE})`,
      'dgu',
    ),
    action: 'REPAY',
    direction: 'INFLOW',
    transactionType: 'REPAYMENT_IN',
    counterpartyRole: 'PAYER',
    actionCapture: 2,
    partyCapture: 1,
  },
] as const;

const INVALID_EXTERNAL_PARTY =
  /^(?:(?:我|自己|本人)(?:自己)?|微信|微信支付|支付宝|花呗|银行卡|信用卡|现金|付款|支付|转账|打款|汇款|商户|商家|对方)$/u;

type ResolvedFrame = Readonly<{
  ruleId: string;
  action: TransactionFactEvidence<CanonicalTransactionAction>;
  direction: TransactionFactEvidence<
    Exclude<TransactionEventDirection, 'UNKNOWN'>
  >;
  fundSemantics: TransactionFactEvidence<FundSemantics>;
  transactionType?: TransactionFactEvidence<TransactionType>;
  counterparty?: TransactionCounterpartyFact;
  purpose?: TransactionFactEvidence<TransactionPurpose>;
  sourceAccount?: TransactionAccountFact;
  targetAccount?: TransactionAccountFact;
  money: TransactionFactSpan;
  merchantProjection: MerchantCompatibilityProjection;
}>;

type IndexedRegExpMatch = RegExpMatchArray & {
  indices?: Array<[number, number] | undefined>;
};

function span(start: number, text: string): TransactionFactSpan {
  return { start, end: start + text.length, text };
}

function capturedSpan(
  match: RegExpMatchArray,
  captured: string,
  fromRelative = 0,
): TransactionFactSpan | undefined {
  if (match.index === undefined) return undefined;
  const relative = match[0].indexOf(captured, fromRelative);
  return relative < 0 ? undefined : span(match.index + relative, captured);
}

function indexedCapturedSpan(
  match: RegExpMatchArray,
  capture: number,
): TransactionFactSpan | undefined {
  const range = (match as IndexedRegExpMatch).indices?.[capture];
  const text = match[capture];
  return range === undefined || text === undefined
    ? undefined
    : { start: range[0], end: range[1], text };
}

function evidence<T>(
  value: T,
  factSpan: TransactionFactSpan,
  ruleId: string,
): TransactionFactEvidence<T> {
  return {
    value,
    span: factSpan,
    ruleId,
    certainty: 'EXPLICIT',
  };
}

function externalParty(
  text: string,
  factSpan: TransactionFactSpan,
  role: 'PAYER' | 'PAYEE',
  ruleId: string,
): TransactionCounterpartyFact | undefined {
  const normalized = text.trim();
  if (
    normalized.length === 0 ||
    INVALID_EXTERNAL_PARTY.test(normalized) ||
    /[元块钱角分\d]/u.test(normalized)
  ) {
    return undefined;
  }
  return {
    text: normalized,
    span: factSpan,
    role,
    kind: 'EXTERNAL_PARTY',
    ruleId,
    certainty: 'EXPLICIT',
  };
}

function semanticsForAction(action: CanonicalTransactionAction): {
  type: TransactionType;
  fundSemantics: FundSemantics;
} {
  return action === 'SEND_MONEY'
    ? { type: 'TRANSFER', fundSemantics: 'TRANSFER' }
    : { type: 'EXPENSE', fundSemantics: 'PURCHASE' };
}

function outgoingPartyFirstFrames(text: string): ResolvedFrame[] {
  const frames: ResolvedFrame[] = [];
  for (const match of text.matchAll(OUTGOING_PARTY_FIRST)) {
    const partyText = match[1];
    const actionText = match[2];
    const moneyText = match[3];
    const action = canonicalActionForToken(actionText);
    if (action === undefined) continue;
    const partySpan = capturedSpan(match, partyText);
    const actionSpan = capturedSpan(
      match,
      actionText,
      (partySpan?.end ?? match.index ?? 0) - (match.index ?? 0),
    );
    const moneySpan = capturedSpan(
      match,
      moneyText,
      (actionSpan?.end ?? match.index ?? 0) - (match.index ?? 0),
    );
    if (
      partySpan === undefined ||
      actionSpan === undefined ||
      moneySpan === undefined
    ) {
      continue;
    }
    const ruleId = `frame.outgoing.party-first.${action.toLowerCase()}`;
    const counterparty = externalParty(partyText, partySpan, 'PAYEE', ruleId);
    if (counterparty === undefined) continue;
    const semantics = semanticsForAction(action);
    frames.push({
      ruleId,
      action: evidence(action, actionSpan, ruleId),
      direction: evidence('OUTFLOW', actionSpan, ruleId),
      fundSemantics: evidence(semantics.fundSemantics, actionSpan, ruleId),
      transactionType: evidence(semantics.type, actionSpan, ruleId),
      counterparty,
      money: moneySpan,
      merchantProjection: 'COUNTERPARTY',
    });
  }
  return frames;
}

function outgoingActionFirstFrames(text: string): ResolvedFrame[] {
  const frames: ResolvedFrame[] = [];
  for (const match of text.matchAll(OUTGOING_ACTION_FIRST)) {
    const actionText = match[1];
    const moneyText = match[2];
    const partyText = match[3];
    const action = canonicalActionForToken(actionText);
    if (action === undefined) continue;
    const actionSpan = capturedSpan(match, actionText);
    const moneySpan = capturedSpan(
      match,
      moneyText,
      (actionSpan?.end ?? match.index ?? 0) - (match.index ?? 0),
    );
    const partySpan = capturedSpan(
      match,
      partyText,
      (moneySpan?.end ?? match.index ?? 0) - (match.index ?? 0),
    );
    if (
      partySpan === undefined ||
      actionSpan === undefined ||
      moneySpan === undefined
    ) {
      continue;
    }
    const ruleId = `frame.outgoing.action-first.${action.toLowerCase()}`;
    const counterparty = externalParty(partyText, partySpan, 'PAYEE', ruleId);
    if (counterparty === undefined) continue;
    const semantics = semanticsForAction(action);
    frames.push({
      ruleId,
      action: evidence(action, actionSpan, ruleId),
      direction: evidence('OUTFLOW', actionSpan, ruleId),
      fundSemantics: evidence(semantics.fundSemantics, actionSpan, ruleId),
      transactionType: evidence(semantics.type, actionSpan, ruleId),
      counterparty,
      money: moneySpan,
      merchantProjection: 'COUNTERPARTY',
    });
  }
  return frames;
}

function incomingPartyFirstFrames(text: string): ResolvedFrame[] {
  const frames: ResolvedFrame[] = [];
  for (const match of text.matchAll(INCOMING_PARTY_FIRST)) {
    const partyText = match[1];
    const actionText = match[2];
    const moneyText = match[3];
    const action = canonicalActionForToken(actionText);
    if (action === undefined) continue;
    const partySpan = capturedSpan(match, partyText);
    const actionSpan = capturedSpan(
      match,
      actionText,
      (partySpan?.end ?? match.index ?? 0) - (match.index ?? 0),
    );
    const moneySpan = capturedSpan(
      match,
      moneyText,
      (actionSpan?.end ?? match.index ?? 0) - (match.index ?? 0),
    );
    if (
      partySpan === undefined ||
      actionSpan === undefined ||
      moneySpan === undefined
    ) {
      continue;
    }
    const ruleId = `frame.incoming.party-first.${action.toLowerCase()}`;
    const counterparty = externalParty(partyText, partySpan, 'PAYER', ruleId);
    if (counterparty === undefined) continue;
    frames.push({
      ruleId,
      action: evidence('RECEIVE_MONEY', actionSpan, ruleId),
      direction: evidence('INFLOW', actionSpan, ruleId),
      fundSemantics: evidence('TRANSFER', actionSpan, ruleId),
      counterparty,
      money: moneySpan,
      merchantProjection: 'COUNTERPARTY',
    });
  }
  return frames;
}

function beneficiaryFeeFrames(text: string): ResolvedFrame[] {
  const frames: ResolvedFrame[] = [];
  for (const match of text.matchAll(BENEFICIARY_FEE)) {
    const beneficiaryText = match[1];
    const actionText = match[2];
    const feeText = match[3];
    const moneyText = match[4];
    const beneficiarySpan = capturedSpan(match, beneficiaryText);
    const actionSpan = capturedSpan(
      match,
      actionText,
      (beneficiarySpan?.end ?? match.index ?? 0) - (match.index ?? 0),
    );
    const feeSpan = capturedSpan(
      match,
      feeText,
      (actionSpan?.end ?? match.index ?? 0) - (match.index ?? 0),
    );
    const moneySpan = capturedSpan(
      match,
      moneyText,
      (feeSpan?.end ?? match.index ?? 0) - (match.index ?? 0),
    );
    if (
      beneficiarySpan === undefined ||
      actionSpan === undefined ||
      feeSpan === undefined ||
      moneySpan === undefined
    ) {
      continue;
    }
    const ruleId = 'frame.expense.beneficiary-fee';
    frames.push({
      ruleId,
      action: evidence('PAY', actionSpan, ruleId),
      direction: evidence('OUTFLOW', actionSpan, ruleId),
      fundSemantics: evidence('PURCHASE', actionSpan, ruleId),
      transactionType: evidence('EXPENSE', actionSpan, ruleId),
      counterparty: {
        text: beneficiaryText,
        span: beneficiarySpan,
        role: 'BENEFICIARY',
        kind: 'EXTERNAL_PARTY',
        ruleId,
        certainty: 'EXPLICIT',
      },
      purpose: evidence('TUITION_FEE', feeSpan, ruleId),
      money: moneySpan,
      merchantProjection: 'SUPPRESS_LEGACY',
    });
  }
  return frames;
}

function redPacketFrames(text: string): ResolvedFrame[] {
  const frames: ResolvedFrame[] = [];
  for (const definition of RED_PACKET_FRAME_DEFINITIONS) {
    for (const match of text.matchAll(definition.pattern)) {
      const partySpan = indexedCapturedSpan(match, definition.partyCapture);
      const actionSpan = indexedCapturedSpan(match, definition.actionCapture);
      const purposeSpan = indexedCapturedSpan(match, definition.purposeCapture);
      const moneySpan = indexedCapturedSpan(match, definition.moneyCapture);
      const partyText = match[definition.partyCapture];
      if (
        partySpan === undefined ||
        actionSpan === undefined ||
        purposeSpan === undefined ||
        moneySpan === undefined ||
        partyText === undefined
      ) {
        continue;
      }
      const counterparty = externalParty(
        partyText,
        partySpan,
        'PAYEE',
        definition.ruleId,
      );
      if (counterparty === undefined) continue;
      frames.push({
        ruleId: definition.ruleId,
        action: evidence('SEND_MONEY', actionSpan, definition.ruleId),
        direction: evidence('OUTFLOW', actionSpan, definition.ruleId),
        fundSemantics: evidence('PURCHASE', actionSpan, definition.ruleId),
        transactionType: evidence('EXPENSE', actionSpan, definition.ruleId),
        counterparty,
        purpose: evidence('RED_PACKET', purposeSpan, definition.ruleId),
        money: moneySpan,
        merchantProjection: 'COUNTERPARTY',
      });
    }
  }
  return frames;
}

function internalAccountTransferFrames(text: string): ResolvedFrame[] {
  const frames: ResolvedFrame[] = [];
  for (const match of text.matchAll(INTERNAL_ACCOUNT_TRANSFER)) {
    const sourceAccountText = match[1];
    const actionText = match[2];
    const targetAccountText = match[3];
    const moneyText = match[4];
    const sourceAccountType = accountTypeForToken(sourceAccountText);
    const targetAccountType = accountTypeForToken(targetAccountText);
    const sourceSpan = capturedSpan(match, sourceAccountText);
    const actionSpan = capturedSpan(
      match,
      actionText,
      sourceAccountText.length,
    );
    const targetSpan = capturedSpan(
      match,
      targetAccountText,
      (actionSpan?.end ?? match.index ?? 0) - (match.index ?? 0),
    );
    const moneySpan = capturedSpan(
      match,
      moneyText,
      (targetSpan?.end ?? match.index ?? 0) - (match.index ?? 0),
    );
    if (
      sourceAccountType === undefined ||
      targetAccountType === undefined ||
      sourceSpan === undefined ||
      actionSpan === undefined ||
      targetSpan === undefined ||
      moneySpan === undefined
    ) {
      continue;
    }
    const ruleId = 'frame.transfer.internal-account';
    frames.push({
      ruleId,
      action: evidence('SEND_MONEY', actionSpan, ruleId),
      direction: evidence('INTERNAL_TRANSFER', actionSpan, ruleId),
      fundSemantics: evidence('TRANSFER', actionSpan, ruleId),
      transactionType: evidence('TRANSFER', actionSpan, ruleId),
      sourceAccount: {
        accountType: sourceAccountType,
        span: sourceSpan,
        role: 'SOURCE',
        ruleId,
        certainty: 'EXPLICIT',
      },
      targetAccount: {
        accountType: targetAccountType,
        span: targetSpan,
        role: 'TARGET',
        ruleId,
        certainty: 'EXPLICIT',
      },
      money: moneySpan,
      merchantProjection: 'SUPPRESS_LEGACY',
    });
  }
  return frames;
}

function debtFrames(text: string): ResolvedFrame[] {
  const frames: ResolvedFrame[] = [];
  for (const definition of DEBT_FRAME_DEFINITIONS) {
    for (const match of text.matchAll(definition.pattern)) {
      const actionCapture =
        'actionCapture' in definition ? definition.actionCapture : 1;
      const partyCapture =
        'partyCapture' in definition ? definition.partyCapture : 2;
      const actionSpan = indexedCapturedSpan(match, actionCapture);
      const partySpan = indexedCapturedSpan(match, partyCapture);
      const moneySpan = indexedCapturedSpan(match, 3);
      const partyText = match[partyCapture];
      if (
        actionSpan === undefined ||
        partySpan === undefined ||
        moneySpan === undefined ||
        partyText === undefined
      ) {
        continue;
      }
      const counterparty = externalParty(
        partyText,
        partySpan,
        definition.counterpartyRole,
        definition.ruleId,
      );
      if (counterparty === undefined) continue;
      frames.push({
        ruleId: definition.ruleId,
        action: evidence(definition.action, actionSpan, definition.ruleId),
        direction: evidence(
          definition.direction,
          actionSpan,
          definition.ruleId,
        ),
        fundSemantics: evidence('DEBT', actionSpan, definition.ruleId),
        transactionType: evidence(
          definition.transactionType,
          actionSpan,
          definition.ruleId,
        ),
        counterparty,
        money: moneySpan,
        merchantProjection: 'COUNTERPARTY',
      });
    }
  }
  return frames;
}

function frameKey(frame: ResolvedFrame): string {
  return [
    frame.direction.value,
    frame.action.value,
    frame.counterparty?.role ?? 'NONE',
    frame.counterparty?.span.start ?? -1,
    frame.counterparty?.span.end ?? -1,
    frame.money.start,
    frame.money.end,
    frame.sourceAccount?.accountType ?? 'NO_SOURCE_ACCOUNT',
    frame.targetAccount?.accountType ?? 'NO_TARGET_ACCOUNT',
  ].join(':');
}

function distinctFrames(text: string): ResolvedFrame[] {
  const seen = new Set<string>();
  return [
    ...internalAccountTransferFrames(text),
    ...debtFrames(text),
    ...beneficiaryFeeFrames(text),
    ...redPacketFrames(text),
    ...incomingPartyFirstFrames(text),
    ...outgoingPartyFirstFrames(text),
    ...outgoingActionFirstFrames(text),
  ].filter(frame => {
    const key = frameKey(frame);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emptyResolution(
  status: 'NO_MATCH' | 'AMBIGUOUS' | 'ABSTAINED',
  conflicts: readonly TransactionFactConflict[] = [],
): TransactionFactResolution {
  return {
    rulesetVersion: TRANSACTION_FACT_RULESET_VERSION,
    status,
    moneyRanges: [],
    evidence: [],
    conflicts,
    merchantProjection: 'NONE',
  };
}

export function resolveTransactionFacts(
  text: string,
): TransactionFactResolution {
  const frames = distinctFrames(text);
  if (frames.length === 0) return emptyResolution('NO_MATCH');
  if (frames.length > 1) {
    return emptyResolution('AMBIGUOUS', [
      {
        code: 'MULTIPLE_EVENT_FRAMES',
        message: '同一分句匹配到多个资金事件框架，无法安全确定字段归属。',
        ruleIds: frames.map(frame => frame.ruleId),
      },
    ]);
  }

  const frame = frames[0];
  const factEvidence: TransactionFactEvidence<unknown>[] = [
    frame.action,
    frame.direction,
    frame.fundSemantics,
    ...(frame.transactionType === undefined ? [] : [frame.transactionType]),
  ];
  return {
    rulesetVersion: TRANSACTION_FACT_RULESET_VERSION,
    status: 'RESOLVED',
    action: frame.action,
    direction: frame.direction,
    fundSemantics: frame.fundSemantics,
    transactionType: frame.transactionType,
    counterparty: frame.counterparty,
    purpose: frame.purpose,
    sourceAccount: frame.sourceAccount,
    targetAccount: frame.targetAccount,
    moneyRanges: [frame.money],
    evidence: [
      ...factEvidence,
      ...(frame.counterparty === undefined
        ? []
        : [
            evidence(
              frame.counterparty.text,
              frame.counterparty.span,
              frame.counterparty.ruleId,
            ),
          ]),
      ...(frame.purpose === undefined ? [] : [frame.purpose]),
      ...(frame.sourceAccount === undefined
        ? []
        : [
            evidence(
              frame.sourceAccount.accountType,
              frame.sourceAccount.span,
              frame.sourceAccount.ruleId,
            ),
          ]),
      ...(frame.targetAccount === undefined
        ? []
        : [
            evidence(
              frame.targetAccount.accountType,
              frame.targetAccount.span,
              frame.targetAccount.ruleId,
            ),
          ]),
    ],
    conflicts: [],
    merchantProjection: frame.merchantProjection,
  };
}
