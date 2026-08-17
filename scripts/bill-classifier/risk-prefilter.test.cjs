const assert = require('node:assert/strict');
const test = require('node:test');

const { prefilterBillText } = require('./risk-prefilter.cjs');

test('prefilter rejects special-fund movements before category inference', () => {
  for (const text of [
    '给朋友转账200元',
    '商家退款到账',
    '公司报销款收到',
    '归还信用卡欠款',
    '公交卡储值充值',
  ]) {
    assert.equal(prefilterBillText(text).eligible, false, text);
  }
});

test('prefilter rejects non-transaction OOD and keeps ordinary bills eligible', () => {
  assert.deepEqual(prefilterBillText('提醒我明早带雨伞'), {
    eligible: false,
    reason: 'OOD_NO_TRANSACTION_EVIDENCE',
    flags: [],
  });
  assert.equal(prefilterBillText('午饭支付28.50元').eligible, true);
  assert.equal(prefilterBillText('工资到账8500元').eligible, true);
});
