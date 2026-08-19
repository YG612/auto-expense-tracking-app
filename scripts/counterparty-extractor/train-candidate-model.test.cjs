const assert = require('node:assert/strict');
const test = require('node:test');

const {
  candidateRows,
  transactionPredictions,
} = require('./train-candidate-model.cjs');

function infer(text) {
  const transaction = {
    id: 'test',
    text,
    scenario: 'TEST',
    difficulty: 'TEST',
    counterparty: null,
  };
  const predictions = candidateRows([transaction], false).map(row => ({
    ...row,
    probabilities: {
      PRIMARY_NAMED: 0.8,
      PRIMARY_GENERIC: 0.1,
      NOT_COUNTERPARTY: 0.1,
    },
  }));
  return transactionPredictions([transaction], predictions)[0];
}

test('route wording cannot become a counterparty through a purchased-object span', () => {
  const result = infer('订苏州开往宁波的列车票，支付119元');
  assert.ok(result.best === undefined || result.best.primaryScore === 0);
});

test('a beneficiary-only purchase is not accepted as the counterparty', () => {
  const result = infer('给季明买体检服务花了119元');
  assert.ok(result.best === undefined || result.best.primaryScore === 0);
});

test('an explicit venue outranks the transaction platform', () => {
  const result = infer('通过美团在青峦餐厅下单，支付68元');
  assert.equal(result.best.candidate.text, '青峦餐厅');
});

test('a named provider after 买 outranks the marketplace platform', () => {
  const result = infer('在美团上买青峦花店的鲜花，支付68元');
  assert.equal(result.best.candidate.text, '青峦花店');
});

test('a bare workplace location is not treated as the merchant', () => {
  const result = infer('公司楼下买咖啡花了32元');
  assert.ok(result.best === undefined || result.best.primaryScore === 0);
});

test('neighboring venues and route airports are location-only', () => {
  const neighbor = infer('在青峦餐厅隔壁摊位买水，花32元');
  assert.ok(neighbor.best === undefined || neighbor.best.primaryScore === 0);
  const otherShop = infer('在青峦餐厅门口另一家店买水，花32元');
  assert.ok(otherShop.best === undefined || otherShop.best.primaryScore === 0);
  const airport = infer('在苏州机场买飞往宁波的机票168元');
  assert.ok(airport.best === undefined || airport.best.primaryScore === 0);
});

test('rail destinations cannot outrank an explicit rail platform', () => {
  const result = infer('在铁路12306买苏州到宁波动车票花168元');
  assert.equal(result.best.candidate.text, '铁路12306');
});

test('an organization paying the user outranks a misleading 向我 candidate', () => {
  const result = infer('青峦科技公司向我结算了6800元');
  assert.equal(result.best.candidate.text, '青峦科技公司');
});
