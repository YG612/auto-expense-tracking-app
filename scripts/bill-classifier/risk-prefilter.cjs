const SPECIAL_FUNDS = [
  ['POSSIBLE_TRANSFER', /转账|转给|划转|提现|账户之间转|转入|转到|存入/u],
  ['POSSIBLE_REFUND', /退款|退费|退回|返还|原路退回|冲正/u],
  ['POSSIBLE_REIMBURSEMENT', /报销/u],
  [
    'POSSIBLE_DEBT_MOVEMENT',
    /还款|还信用卡|还花呗|归还欠款|借款到账|收到借款|借给|借出去/u,
  ],
  [
    'POSSIBLE_STORED_VALUE_RECHARGE',
    /充值|充钱|储值|预付(?:款|卡)?|会员卡|储值卡|充值卡|礼品卡/u,
  ],
];

const TRANSACTION_EVIDENCE =
  /\d|[零〇一二两三四五六七八九十百千万亿]+(?:元|块|角|分)|元|块钱?|支付|消费|扣款|到账|入账|收到|购买|买了|缴纳|结账|房租|工资|奖金|票|费/u;

function prefilterBillText(text) {
  const normalized = String(text).normalize('NFKC').replace(/\s+/gu, '');
  const flags = SPECIAL_FUNDS.filter(([, pattern]) =>
    pattern.test(normalized),
  ).map(([flag]) => flag);
  if (flags.length > 0) {
    return { eligible: false, reason: 'SPECIAL_FUNDS', flags };
  }
  if (!TRANSACTION_EVIDENCE.test(normalized)) {
    return {
      eligible: false,
      reason: 'OOD_NO_TRANSACTION_EVIDENCE',
      flags: [],
    };
  }
  return { eligible: true, reason: 'ELIGIBLE', flags: [] };
}

module.exports = { prefilterBillText };
