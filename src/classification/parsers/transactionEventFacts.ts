import type { TransactionType } from '../../domain/entities';

export type SettlementState =
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PLANNED'
  | 'QUOTED'
  | 'REPORTED'
  | 'UNKNOWN';

export type TransactionActor = 'SELF' | 'OTHER' | 'MERCHANT' | 'UNKNOWN';
export type TransactionParticipant = 'SELF' | 'OTHER' | 'MERCHANT' | 'UNKNOWN';

export type TransactionEventDirection =
  'INFLOW' | 'OUTFLOW' | 'INTERNAL_TRANSFER' | 'UNKNOWN';

export type FundSemantics =
  | 'PURCHASE'
  | 'INCOME'
  | 'REFUND'
  | 'TRANSFER'
  | 'DEBT'
  | 'DEPOSIT'
  | 'PREAUTH'
  | 'TOP_UP'
  | 'UNKNOWN';

export const TRANSACTION_EVENT_REASON_CODES = [
  'USER_REJECTED_RECORDING',
  'SETTLEMENT_FAILED',
  'SETTLEMENT_CANCELLED',
  'SETTLEMENT_PLANNED',
  'SETTLEMENT_QUOTED',
  'SETTLEMENT_REPORTED',
  'COUNTERFACTUAL_EVENT',
  'NON_TRANSACTION_SNAPSHOT',
  'DIRECTION_UNKNOWN',
] as const;

export type TransactionEventReasonCode =
  (typeof TRANSACTION_EVENT_REASON_CODES)[number];

export type TransactionEventBlockingReason = {
  code: TransactionEventReasonCode;
  message: string;
};

export type TransactionEventFacts = {
  settlementState: SettlementState;
  actor: TransactionActor;
  payer: TransactionParticipant;
  payee: TransactionParticipant;
  ledgerOwner: 'SELF';
  direction: TransactionEventDirection;
  fundSemantics: FundSemantics;
  blockingReasons: TransactionEventBlockingReason[];
};

const FAILED_EVENT =
  /(?:退款|报销|还款|付款|支付|扣款|转账|交易|收入|收到|到账|入账|收款).{0,8}(?:失败|未成功|被拒)|(?:失败|未成功|被拒).{0,8}(?:退款|报销|还款|付款|支付|扣款|转账|交易|收入|收到|到账|入账|收款)|(?:没(?:有)?|未|尚未)(?:(?:在|去).{0,20})?(?:买|花|付|付款|支付|消费|扣款|收到|到账|入账|收款)/u;
const CANCELLED_EVENT =
  /(?:退款|报销|还款|付款|支付|扣款|转账|交易|收入|收到|到账|入账|收款).{0,8}(?:取消|撤销)|(?:取消|撤销).{0,8}(?:退款|报销|还款|付款|支付|扣款|转账|交易|收入|收到|到账|入账|收款)|(?:收到|到账|入账|收款成功).{0,24}(?:退回|退还|撤回|冲正)/u;
const COUNTERFACTUAL_EVENT =
  /(?:差点|险些|几乎|本来|原本).{0,16}(?:花|付|支付|消费|扣款|买|购买|交|转账|收到|到账)|要不是.{0,24}(?:就|会).{0,12}(?:花|付|支付|消费|买)/u;
const PLANNED_EVENT =
  /(?:(?:计划|准备|打算|预计|考虑|如果|可能会|待会(?:儿)?|将要|提醒我).{0,28}(?:去|买|购买|花|付|支付|消费|退款|报销|还款|转账|收到|到账|入账|收款|交|缴|早餐|午饭|晚饭|打车|酒店|房租)|(?:本来|原本)?想(?:去|在|买|购买|花|付|支付|消费|收到|到账|入账|收款)|(?:明天|后天|下周|下个月).{0,16}(?:买|花|付|支付|消费|交|缴|还款|转账))/u;
const UNCERTAIN_EVENT =
  /(?:(?:是否|有没有|有没|会不会|能否|可否|等(?:到)?|待).{0,20}(?:收到|到账|入账|收款)|(?:收到|到账|入账|收款).{0,20}(?:了吗|了没|没有|吗|么|[?]))/u;
const QUOTED_EVENT =
  /(?:报价|询价|要价|估价|标价|售价(?:是|为)?|价格(?:是|为)?|需要多少钱|多少钱(?:可以|能)?(?:买|做))/u;
const REPORTED_EVENT =
  /(?:朋友|同事|同学|家人|亲戚|他|她|别人|商家|客户).{0,10}(?:说|表示|告诉我|提到|声称|称).{0,28}(?:花|付|支付|消费|扣款|买|购买|交|转账|收入|收到|到账|入账|收款)|(?:听说|据说).{0,28}(?:花|付|支付|消费|买|收入|收到|到账)/u;
const OTHER_ACTOR_EVENT =
  /^(?:朋友|同事|同学|家人|亲戚|他|她|别人).{0,12}(?:花|付|支付|消费|买|购买|交)(?:了)?/u;
const NON_TRANSACTION_SNAPSHOT =
  /^(?:我的)?(?:预算|余额|额度|信用卡账单|花呗账单|账单金额|应还金额|可用余额)(?:是|为|有|剩余|还有|共计|总计)?\s*[¥￥]?\s*(?:\d|[零〇一二两三四五六七八九十百千万])/u;
const COMPLETED_ACTION =
  /花了|买了|购买了|付了|支付成功|消费了|扣款成功|交了|缴了|赚了|挣了|已到账|到账了|已入账|收到了|收款成功|退款到账|退回到账|已还|还了/u;
const USER_REJECTED_RECORDING =
  /(?:不要|别|不用|无需)(?:再)?(?:记|记录|记账|入账)|取消(?:这笔)?记账|撤销(?:这笔)?(?:记录|记账)/u;

const INTERNAL_TRANSFER =
  /(?:从.+(?:转|提|存).+(?:到|入)|账户之间转|从(?:微信|支付宝|银行卡|储蓄卡|信用卡|现金).{0,12}(?:到|转入|存入)(?:微信|支付宝|银行卡|储蓄卡|信用卡|现金))/u;
const OUTFLOW_DIRECTION =
  /(?:我)?转给(?!我)|(?:我)?(?:给|向).{0,16}(?:发工资|发薪|转|还|支付|付款|交|缴)|(?:发|代发)(?:员工|职工|工人|同事)?.{0,8}(?:工资|薪资|薪水)|花了?|买了?|购买|付了?|支付|消费|扣款|交了?|缴了?|借给|借出|还给/u;
const INFLOW_DIRECTION =
  /(?:转|退|还|打款|汇款)给我|给我(?:转|退|还|打款|汇款)|我(?:收到|收了)|(?:收到|到账|入账|收款成功)|(?:工资|薪资|薪水|奖金|收入).{0,8}(?:到账|入账)/u;
const AMBIGUOUS_DIRECTION =
  /^(?:微信|支付宝|现金)?(?:红包|转账)\s*[¥￥]?\s*(?:\d|[零〇一二两三四五六七八九十百千万])/u;

function settlementState(text: string): {
  state: SettlementState;
  reason?: TransactionEventBlockingReason;
} {
  if (USER_REJECTED_RECORDING.test(text)) {
    return {
      state: 'CANCELLED',
      reason: {
        code: 'USER_REJECTED_RECORDING',
        message: '已按你的要求忽略这段文字，不会生成账目。',
      },
    };
  }
  if (FAILED_EVENT.test(text)) {
    return {
      state: 'FAILED',
      reason: {
        code: 'SETTLEMENT_FAILED',
        message: '这段文字描述的是失败或尚未完成的交易，未生成账目。',
      },
    };
  }
  if (CANCELLED_EVENT.test(text)) {
    return {
      state: 'CANCELLED',
      reason: {
        code: 'SETTLEMENT_CANCELLED',
        message: '这段文字描述的是已取消、撤销或冲正的交易，未生成账目。',
      },
    };
  }
  if (COUNTERFACTUAL_EVENT.test(text)) {
    return {
      state: 'UNKNOWN',
      reason: {
        code: 'COUNTERFACTUAL_EVENT',
        message: '这段文字描述的是反事实或差点发生的交易，未生成账目。',
      },
    };
  }
  if (PLANNED_EVENT.test(text) || UNCERTAIN_EVENT.test(text)) {
    return {
      state: 'PLANNED',
      reason: {
        code: 'SETTLEMENT_PLANNED',
        message: '这段文字描述的是计划、提醒或尚待确认的交易，未生成账目。',
      },
    };
  }
  if (QUOTED_EVENT.test(text) && !COMPLETED_ACTION.test(text)) {
    return {
      state: 'QUOTED',
      reason: {
        code: 'SETTLEMENT_QUOTED',
        message: '报价或价格信息不代表交易已经完成，未生成账目。',
      },
    };
  }
  if (REPORTED_EVENT.test(text) || OTHER_ACTOR_EVENT.test(text)) {
    return {
      state: 'REPORTED',
      reason: {
        code: 'SETTLEMENT_REPORTED',
        message: '这段文字描述的是他人的交易或转述，不会记入你的账本。',
      },
    };
  }
  if (NON_TRANSACTION_SNAPSHOT.test(text)) {
    return {
      state: 'UNKNOWN',
      reason: {
        code: 'NON_TRANSACTION_SNAPSHOT',
        message: '预算、余额或账单快照不代表一笔已完成交易，未生成账目。',
      },
    };
  }
  return { state: 'COMPLETED' };
}

function counterpartyFor(text: string): TransactionParticipant {
  if (/商家|店家|平台|公司|单位|医院|学校|餐厅|酒店|超市/u.test(text)) {
    return 'MERCHANT';
  }
  if (
    /朋友|同事|同学|家人|亲戚|员工|职工|工人|孩子|老王|老李|老张|对方|他|她|别人/u.test(
      text,
    )
  ) {
    return 'OTHER';
  }
  return 'UNKNOWN';
}

function actorFor(
  text: string,
  state: SettlementState,
  direction: TransactionEventDirection,
): TransactionActor {
  if (state === 'REPORTED' || OTHER_ACTOR_EVENT.test(text)) return 'OTHER';
  if (direction === 'OUTFLOW' || direction === 'INTERNAL_TRANSFER') {
    return 'SELF';
  }
  if (direction === 'INFLOW') return counterpartyFor(text);
  if (/我|我的|给我|向我/u.test(text)) return 'SELF';
  return 'UNKNOWN';
}

function participantsFor(
  text: string,
  direction: TransactionEventDirection,
): Pick<TransactionEventFacts, 'payer' | 'payee' | 'ledgerOwner'> {
  const counterparty = counterpartyFor(text);
  if (direction === 'OUTFLOW') {
    return { payer: 'SELF', payee: counterparty, ledgerOwner: 'SELF' };
  }
  if (direction === 'INFLOW') {
    return { payer: counterparty, payee: 'SELF', ledgerOwner: 'SELF' };
  }
  if (direction === 'INTERNAL_TRANSFER') {
    return { payer: 'SELF', payee: 'SELF', ledgerOwner: 'SELF' };
  }
  return { payer: 'UNKNOWN', payee: 'UNKNOWN', ledgerOwner: 'SELF' };
}

function directionFor(text: string): TransactionEventDirection {
  if (INTERNAL_TRANSFER.test(text)) return 'INTERNAL_TRANSFER';
  if (INFLOW_DIRECTION.test(text)) return 'INFLOW';
  if (OUTFLOW_DIRECTION.test(text)) return 'OUTFLOW';
  return 'UNKNOWN';
}

function fundSemanticsFor(
  text: string,
  direction: TransactionEventDirection,
): FundSemantics {
  if (/预授权|冻结/u.test(text)) return 'PREAUTH';
  if (/押金|保证金|定金/u.test(text)) return 'DEPOSIT';
  if (/充值|储值/u.test(text)) return 'TOP_UP';
  if (/退款|退回|退还|冲正/u.test(text)) return 'REFUND';
  if (/借给|借出|借入|借款|还款|还给|还我/u.test(text)) return 'DEBT';
  if (/转账|转给|转入|转到|打款|汇款|提现|存入/u.test(text)) {
    return 'TRANSFER';
  }
  if (/工资|薪资|薪水|奖金|收入|赚|挣|到账|收款/u.test(text)) {
    return direction === 'OUTFLOW' ? 'UNKNOWN' : 'INCOME';
  }
  if (
    /花|买|购买|付|支付|消费|扣款|交|缴|早餐|午饭|晚饭|打车|房租/u.test(text)
  ) {
    return 'PURCHASE';
  }
  return 'UNKNOWN';
}

export function analyzeTransactionEventFacts(
  text: string,
): TransactionEventFacts {
  const settlement = settlementState(text);
  const direction = directionFor(text);
  const blockingReasons =
    settlement.reason === undefined ? [] : [settlement.reason];
  if (
    settlement.state === 'COMPLETED' &&
    direction === 'UNKNOWN' &&
    AMBIGUOUS_DIRECTION.test(text)
  ) {
    blockingReasons.push({
      code: 'DIRECTION_UNKNOWN',
      message: '无法确定这笔资金是收入还是支出，请明确收款或付款方向。',
    });
  }
  return {
    settlementState: settlement.state,
    actor: actorFor(text, settlement.state, direction),
    ...participantsFor(text, direction),
    direction,
    fundSemantics: fundSemanticsFor(text, direction),
    blockingReasons,
  };
}

export function directionFromTransactionType(
  type: TransactionType | undefined,
): TransactionEventDirection {
  if (type === 'TRANSFER') return 'INTERNAL_TRANSFER';
  if (
    type === 'INCOME' ||
    type === 'REFUND' ||
    type === 'BORROW_IN' ||
    type === 'REPAYMENT_IN' ||
    type === 'REIMBURSEMENT'
  ) {
    return 'INFLOW';
  }
  if (type === 'EXPENSE' || type === 'LEND_OUT' || type === 'REPAYMENT_OUT') {
    return 'OUTFLOW';
  }
  return 'UNKNOWN';
}

export function resolveTransactionEventFacts(
  facts: TransactionEventFacts,
  text: string,
  type: TransactionType | undefined,
): TransactionEventFacts {
  const direction =
    facts.direction === 'UNKNOWN' &&
    !facts.blockingReasons.some(reason => reason.code === 'DIRECTION_UNKNOWN')
      ? directionFromTransactionType(type)
      : facts.direction;
  return {
    ...facts,
    direction,
    actor: actorFor(text, facts.settlementState, direction),
    ...participantsFor(text, direction),
  };
}
