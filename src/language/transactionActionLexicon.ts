export const TRANSACTION_ACTION_LEXICON_VERSION = '2026-08-22.1';

export type CanonicalTransactionAction =
  | 'PAY'
  | 'SEND_MONEY'
  | 'RECEIVE_MONEY'
  | 'SPEND'
  | 'PURCHASE'
  | 'REFUND'
  | 'LEND'
  | 'BORROW'
  | 'REPAY'
  | 'TOP_UP';

export type TransactionActionDefinition = Readonly<{
  id: string;
  action: CanonicalTransactionAction;
  aliases: readonly string[];
}>;

/**
 * Versioned surface-action vocabulary shared by parsers and downstream
 * safety gates. Extractors may constrain these tokens with a frame, but must
 * not maintain private copies of the same synonym set.
 */
export const TRANSACTION_ACTION_LEXICON: readonly TransactionActionDefinition[] =
  [
    {
      id: 'action.pay',
      action: 'PAY',
      aliases: ['支付', '付款', '付', '缴', '交'],
    },
    {
      id: 'action.send-money',
      action: 'SEND_MONEY',
      aliases: ['转账', '打款', '汇款', '划款', '转', '发', '打', '汇', '划'],
    },
    {
      id: 'action.receive-money',
      action: 'RECEIVE_MONEY',
      aliases: ['收到', '收款', '到账', '入账', '收'],
    },
    {
      id: 'action.spend',
      action: 'SPEND',
      aliases: ['消费', '扣款', '花'],
    },
    {
      id: 'action.purchase',
      action: 'PURCHASE',
      aliases: ['购买', '下单', '买'],
    },
    {
      id: 'action.refund',
      action: 'REFUND',
      aliases: ['退款', '退回', '退还'],
    },
    {
      id: 'action.lend',
      action: 'LEND',
      aliases: ['借给', '借出'],
    },
    {
      id: 'action.borrow',
      action: 'BORROW',
      aliases: ['借入', '借款', '借'],
    },
    {
      id: 'action.repay',
      action: 'REPAY',
      aliases: ['还款', '还给', '归还', '还'],
    },
    {
      id: 'action.top-up',
      action: 'TOP_UP',
      aliases: ['充值', '储值'],
    },
  ];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function transactionActionTokenSource(
  actions: readonly CanonicalTransactionAction[],
): string {
  const selected = new Set(actions);
  const aliases = TRANSACTION_ACTION_LEXICON.filter(definition =>
    selected.has(definition.action),
  )
    .flatMap(definition => definition.aliases)
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort(
      (left, right) => right.length - left.length || left.localeCompare(right),
    );
  if (aliases.length === 0) {
    throw new Error('交易动作模式至少需要一个动作。');
  }
  return `(?:${aliases.map(escapeRegExp).join('|')})`;
}

export function canonicalActionForToken(
  token: string,
): CanonicalTransactionAction | undefined {
  return TRANSACTION_ACTION_LEXICON.find(definition =>
    definition.aliases.includes(token),
  )?.action;
}
