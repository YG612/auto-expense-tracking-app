const assert = require('node:assert/strict');
const test = require('node:test');

const {
  generateCounterpartyCandidates,
  hasTransactionEvidence,
  markedCandidateText,
} = require('./candidate-generator.cjs');

function texts(value) {
  return generateCounterpartyCandidates(value).map(candidate => candidate.text);
}

test('route locations and the purchased service become candidates, not inferred merchants', () => {
  const candidates = texts('说今天从武汉到上海买的动车票花了270');
  assert.ok(candidates.includes('武汉'));
  assert.ok(candidates.includes('上海'));
  assert.ok(candidates.includes('动车票'));
  assert.ok(!candidates.includes('铁路12306'));
});

test('keeps the full merchant when its name begins with a transaction cue character', () => {
  const candidates = texts('用支付宝付给栖木花店32块');
  assert.ok(candidates.includes('栖木花店'));
});

test('generates the provider alongside platform and channel distractors', () => {
  const candidates = texts('用支付宝在美团上买浮光面馆的早餐，付款32元');
  assert.ok(candidates.includes('支付宝'));
  assert.ok(candidates.includes('美团'));
  assert.ok(candidates.includes('浮光面馆'));
  assert.ok(candidates.includes('早餐'));
});

test('model text marks the exact candidate and includes candidate provenance', () => {
  const candidate = generateCounterpartyCandidates('在青禾面馆吃饭20元').find(
    item => item.text === '青禾面馆',
  );
  assert.ok(candidate);
  const marked = markedCandidateText('在青禾面馆吃饭20元', candidate);
  assert.match(marked, /候选开始 青禾面馆 候选结束/u);
  assert.match(marked, /候选来源/u);
});

test('keeps exact boundaries around aspect words and sentence particles', () => {
  assert.ok(texts('订单由青峦餐厅实际提供服务，结账68元').includes('青峦餐厅'));
  assert.ok(
    !texts('订单由青峦餐厅实际提供服务，结账68元').includes('青峦餐厅实际'),
  );
  assert.ok(texts('刚转给季明了68元').includes('季明'));
  assert.ok(!texts('刚转给季明了68元').includes('季明了'));
  assert.ok(texts('付给青峦餐厅共68元').includes('青峦餐厅'));
  assert.ok(!texts('付给青峦餐厅共68元').includes('青峦餐厅共'));
  assert.ok(texts('周末在青峦餐厅结账68元').includes('青峦餐厅'));
  assert.ok(!texts('周末在青峦餐厅结账68元').includes('青峦餐厅结账68元'));
  assert.ok(
    !generateCounterpartyCandidates('在向阳宠物医院结账68元').some(
      candidate => candidate.source === 'DIRECT_PARTY',
    ),
  );
});

test('finds the actual provider after a platform and leading income parties', () => {
  assert.ok(texts('通过美团在青峦餐厅下单，支付68元').includes('青峦餐厅'));
  assert.ok(texts('季明给我打过来68元').includes('季明'));
  assert.ok(texts('工资6800元由青峦科技公司汇入').includes('青峦科技公司'));
  assert.ok(texts('收到季明汇来的68元').includes('季明'));
  assert.ok(!texts('收到季明汇来的68元').includes('季明汇来的'));
  assert.equal(
    hasTransactionEvidence('使用美团在青峦餐厅点单，付了68元'),
    true,
  );
  assert.equal(hasTransactionEvidence('季明给我汇来68元'), true);
  assert.equal(hasTransactionEvidence('铁路12306已扣68元'), true);
});

test('supports common statement field aliases and natural transfer verbs', () => {
  assert.ok(texts('POS小票商家名称：青峦餐厅，金额68元').includes('青峦餐厅'));
  assert.ok(
    texts('流水付款单位为青峦科技公司，支出6800元').includes('青峦科技公司'),
  );
  assert.ok(texts('我把68元交给季明').includes('季明'));
  assert.ok(texts('季明转来68元').includes('季明'));
  assert.ok(texts('给青峦餐厅付了68元').includes('青峦餐厅'));
  assert.ok(!texts('支付宝扣款68元，商家信息为空').includes('信息为空'));
});

test('handles aspect markers, receiver verbs, and numeric platform names', () => {
  const candidates =
    generateCounterpartyCandidates('午饭去了青峦餐厅，结账68元');
  assert.ok(
    candidates.some(
      candidate =>
        candidate.text === '青峦餐厅' && candidate.source === 'VENUE',
    ),
  );
  assert.equal(hasTransactionEvidence('青峦餐厅收了我68元'), true);
  assert.equal(hasTransactionEvidence('青峦科技公司退了680元'), true);
  assert.ok(texts('12306显示已付68元').includes('12306'));
  assert.ok(!texts('收到退款68元但没有商户').includes('收到'));
  assert.ok(
    !generateCounterpartyCandidates('奖金6800元由青峦科技公司汇入').some(
      candidate =>
        candidate.text === '奖金6800元由青峦科技公司' &&
        candidate.source === 'INCOME_PARTY',
    ),
  );
});

test('keeps the strongest provenance when multiple rules find one span', () => {
  const railway = generateCounterpartyCandidates('铁路12306支付成功68元').find(
    candidate => candidate.text === '铁路12306',
  );
  assert.equal(railway?.source, 'TRANSACTION_PLATFORM');
});

test('distinguishes completed transfers from cancelled spending plans', () => {
  assert.equal(hasTransactionEvidence('94元打给安然'), true);
  assert.equal(hasTransactionEvidence('安然给我打过来94元'), true);
  assert.equal(
    hasTransactionEvidence('原计划在荷塘饭店消费18元，最后没有消费'),
    false,
  );
  assert.equal(
    hasTransactionEvidence('原计划去荷塘饭店，最后还是消费了18元'),
    true,
  );
});

test('does not treat yuan inside an organization name as an amount fragment', () => {
  const candidate = generateCounterpartyCandidates(
    '收到开元咨询集团发的工资10860元',
  ).find(item => item.text === '开元咨询集团');
  assert.equal(candidate?.source, 'INCOME_PARTY');
});

test('does not treat a leading time expression as the incoming party', () => {
  const candidates = generateCounterpartyCandidates('昨晚打款给艾青68元');
  assert.ok(
    candidates.some(
      candidate =>
        candidate.text === '艾青' && candidate.source === 'DIRECT_PARTY',
    ),
  );
  assert.ok(!candidates.some(candidate => candidate.text === '昨晚'));
});

test('rejects missing-value placeholders in explicit counterparty fields', () => {
  for (const text of [
    '支付宝显示支出137元，商户字段缺失',
    '微信支付扣款88元，商家信息未提供',
    '银行卡扣款66元，交易对方为空',
  ]) {
    assert.ok(
      !generateCounterpartyCandidates(text).some(
        candidate => candidate.source === 'EXPLICIT_FIELD',
      ),
    );
  }
});
