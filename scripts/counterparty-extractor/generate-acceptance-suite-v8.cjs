const path = require('node:path');
const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

const MERCHANTS = [
  '荷塘饭店',
  '林间茶屋',
  '风尚理发店',
  '博闻书局',
  '佳美牙科诊所',
  '速印图文店',
  '晨光咖啡馆',
  '百姓超市',
  '邻家便利店',
  '甜心奶茶店',
  '自然家居城',
  '静思书房',
  '海景宾馆',
  '畅行维修中心',
  '牧场烤肉店',
  '光年摄影馆',
  '素雅服饰店',
  '冰河滑雪馆',
  '风速洗车行',
  '麦穗面包店',
  '明眸眼镜店',
  '济世药房',
  '纵横旅行社',
  '田园生鲜店',
  '元气健身房',
];
const PEOPLE = [
  '安然',
  '毕晨',
  '崔颖',
  '戴维',
  '范宁',
  '龚雪',
  '胡杨',
  '蒋南',
  '柯然',
  '卢静',
  '梅川',
  '倪安',
  '欧阳',
  '裴乐',
  '齐鸣',
];
const ORGANIZATIONS = [
  '海纳智能有限公司',
  '木棉传播集团',
  '宜居物业公司',
  '风行货运公司',
  '星火公益基金会',
  '中岳制造公司',
  '开元咨询集团',
  '知新教育公司',
  '安达服务集团',
  '凌峰科技有限公司',
];
const CITIES = [
  '东营',
  '日照',
  '聊城',
  '滨州',
  '菏泽',
  '龙岩',
  '三明',
  '莆田',
  '南平',
  '宁德',
  '恩施',
  '咸宁',
  '随州',
  '仙桃',
  '潜江',
  '天门',
  '开封',
  '安阳',
  '濮阳',
  '漯河',
  '鹤壁',
  '三门峡',
  '信阳',
  '南阳',
  '济源',
];
const AMOUNTS = [18, 27, 42, 56, 73, 94, 118, 156, 207, 283, 371];
const CHANNELS = ['支付宝', '微信支付', '银行卡'];

function row(state, text, counterparty, scenario, kind = 'MERCHANT') {
  let span = null;
  if (counterparty !== undefined) {
    const start = text.indexOf(counterparty);
    if (
      start < 0 ||
      text.indexOf(counterparty, start + counterparty.length) >= 0
    )
      throw new Error(`Expected one ${counterparty}: ${text}`);
    span = {
      text: counterparty,
      start,
      end: start + counterparty.length,
      kind,
      specificity: 'NAMED',
    };
  }
  const id = `cp-accept-v8-${String(state.nextId++).padStart(5, '0')}`;
  return {
    id,
    text,
    split: 'acceptance',
    splitGroup: `acceptance-v8:${scenario}:${id}`,
    scenario,
    difficulty: span === null ? 'ACCEPT_NEGATIVE' : 'ACCEPT_POSITIVE',
    counterparty: span,
    syntheticOnly: true,
    generator: 'codex-authored-acceptance-v8',
  };
}

function generate() {
  const rows = [];
  const state = { nextId: 1 };
  MERCHANTS.forEach((merchant, index) => {
    const amount = AMOUNTS[index % AMOUNTS.length];
    rows.push(
      row(
        state,
        `支付记录门店为${merchant}，实付${amount}元`,
        merchant,
        'V8_MERCHANT_FIELD',
      ),
      row(state, `把${amount}元支付给${merchant}`, merchant, 'V8_DIRECT_PAYEE'),
      row(
        state,
        `晚上去${merchant}消费${amount}元`,
        merchant,
        'V8_SUFFIX_VENUE',
      ),
      row(
        state,
        `在${merchant}对面摊位购物花${amount}元`,
        undefined,
        'V8_LOCATION_MODIFIER',
      ),
      row(
        state,
        `${merchant}会员卡办理费${amount}元`,
        undefined,
        'V8_BRAND_CARD',
      ),
      row(
        state,
        `原计划在${merchant}消费${amount}元，最后没有消费`,
        undefined,
        'V8_NOT_COMPLETED',
      ),
    );
  });
  PEOPLE.forEach((person, index) => {
    const amount = AMOUNTS[(index + 5) % AMOUNTS.length];
    rows.push(
      row(state, `${amount}元打给${person}`, person, 'V8_PERSON_OUT', 'PERSON'),
      row(
        state,
        `${person}给我打过来${amount}元`,
        person,
        'V8_PERSON_IN',
        'PERSON',
      ),
      row(state, `帮${person}买教材花${amount}元`, undefined, 'V8_BENEFICIARY'),
    );
  });
  ORGANIZATIONS.forEach((organization, index) => {
    const amount = 7200 + index * 610;
    rows.push(
      row(
        state,
        `收款单位：${organization}，付款${amount}元`,
        organization,
        'V8_ORGANIZATION_FIELD',
        'ORGANIZATION',
      ),
      row(
        state,
        `收到${organization}发的工资${amount}元`,
        organization,
        'V8_ORGANIZATION_INCOME',
        'ORGANIZATION',
      ),
      row(
        state,
        `买${organization}债券投入${amount}元`,
        undefined,
        'V8_ORGANIZATION_PRODUCT',
      ),
    );
  });
  CITIES.forEach((origin, index) => {
    const destination = CITIES[(index + 9) % CITIES.length];
    const amount = AMOUNTS[(index + 2) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `${origin}至${destination}动车票花${amount}元`,
        undefined,
        'V8_RAIL_ROUTE',
      ),
      row(
        state,
        `${origin}机场前往${destination}的航班票价${amount}元`,
        undefined,
        'V8_AIR_ROUTE',
      ),
      row(
        state,
        `铁路12306消费${amount}元，${origin}-${destination}`,
        '铁路12306',
        'V8_RAIL_PLATFORM',
        'PLATFORM',
      ),
    );
  });
  CHANNELS.forEach((channel, index) => {
    for (let round = 0; round < 5; round += 1) {
      const amount = AMOUNTS[(index + round + 4) % AMOUNTS.length];
      rows.push(
        row(
          state,
          `${channel}已付${amount}元，账单未显示商户`,
          undefined,
          'V8_CHANNEL_ONLY',
        ),
      );
    }
  });
  return rows;
}

function main(argv) {
  const args = parseArgs(argv);
  const outputDir = path.resolve(
    process.cwd(),
    args.output ?? 'data/synthetic/work/counterparty-acceptance-v8',
  );
  const rows = generate();
  const contents = jsonl(rows);
  atomicWrite(path.join(outputDir, 'acceptance.jsonl'), contents);
  const positives = rows.filter(item => item.counterparty !== null).length;
  const manifest = {
    schemaVersion: 1,
    datasetId: 'counterparty-acceptance-v8',
    syntheticOnly: true,
    rows: rows.length,
    positives,
    negatives: rows.length - positives,
    file: 'acceptance.jsonl',
    sha256: sha256(contents),
    lockedForTraining: true,
    generatedAt: new Date().toISOString(),
  };
  atomicWrite(
    path.join(outputDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
if (require.main === module) main(process.argv.slice(2));
module.exports = { generate };
