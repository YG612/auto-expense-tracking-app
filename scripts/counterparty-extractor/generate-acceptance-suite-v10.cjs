const path = require('node:path');
const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

const MERCHANT_PREFIXES = [
  '松风',
  '栖霞',
  '白鹭',
  '映月',
  '听雨',
  '暖阳',
  '星河',
  '知味',
  '木槿',
  '清欢',
  '若水',
  '微光',
  '锦书',
  '南枝',
  '云帆',
  '拾翠',
  '长青',
  '秋实',
  '澄明',
  '乐活',
  '花间',
  '原野',
  '朝露',
  '和悦',
  '青禾',
];
const MERCHANT_SUFFIXES = [
  '餐厅',
  '茶室',
  '理发店',
  '书屋',
  '诊所',
  '咖啡馆',
  '超市',
  '便利店',
  '酒店',
  '汽修厂',
  '花店',
  '影城',
  '面馆',
  '药房',
  '健身房',
];
const MERCHANTS = MERCHANT_PREFIXES.map(
  (prefix, index) =>
    `${prefix}${MERCHANT_SUFFIXES[index % MERCHANT_SUFFIXES.length]}`,
);
const PEOPLE = [
  '赵清',
  '钱宇',
  '孙禾',
  '李沐',
  '周岚',
  '吴桐',
  '郑言',
  '王悦',
  '冯远',
  '陈星',
  '褚安',
  '卫宁',
  '蒋舟',
  '沈秋',
  '韩青',
];
const ORGANIZATIONS = [
  '瑞元信息有限公司',
  '山海传媒集团',
  '安居物业公司',
  '捷达运输公司',
  '晨星公益基金会',
  '鼎新工业公司',
  '汇元顾问集团',
  '求真教育公司',
  '康宁服务集团',
  '极光软件有限公司',
];
const CITIES = [
  '盐城',
  '扬州',
  '镇江',
  '泰州',
  '宿迁',
  '嘉兴',
  '湖州',
  '绍兴',
  '金华',
  '衢州',
  '舟山',
  '台州',
  '丽水',
  '芜湖',
  '蚌埠',
  '淮南',
  '马鞍山',
  '淮北',
  '铜陵',
  '安庆',
  '黄山',
  '滁州',
  '阜阳',
  '宿州',
  '六安',
];
const AMOUNTS = [14, 22, 36, 49, 65, 82, 103, 137, 188, 251, 346];

function row(state, text, counterparty, scenario, kind = 'MERCHANT') {
  let span = null;
  if (counterparty !== undefined) {
    const start = text.indexOf(counterparty);
    if (
      start < 0 ||
      text.indexOf(counterparty, start + counterparty.length) >= 0
    ) {
      throw new Error(`Expected one ${counterparty}: ${text}`);
    }
    span = {
      text: counterparty,
      start,
      end: start + counterparty.length,
      kind,
      specificity: 'NAMED',
    };
  }
  const id = `cp-accept-v10-${String(state.nextId++).padStart(5, '0')}`;
  return {
    id,
    text,
    split: 'acceptance',
    splitGroup: `acceptance-v10:${scenario}:${id}`,
    scenario,
    difficulty: span === null ? 'ACCEPT_NEGATIVE' : 'ACCEPT_POSITIVE',
    counterparty: span,
    syntheticOnly: true,
    generator: 'codex-authored-acceptance-v10',
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
        `电子回单商家名称为${merchant}，支出${amount}元`,
        merchant,
        'V10_MERCHANT_FIELD',
      ),
      row(
        state,
        `通过微信向${merchant}支付了${amount}元`,
        merchant,
        'V10_DIRECT_PAYEE',
      ),
      row(
        state,
        `这笔订单由${merchant}提供，结账${amount}元`,
        merchant,
        'V10_PROVIDER',
      ),
      row(
        state,
        `在${merchant}门口流动摊消费${amount}元`,
        undefined,
        'V10_LOCATION_MODIFIER',
      ),
      row(
        state,
        `购买${merchant}礼品卡充值${amount}元`,
        undefined,
        'V10_BRAND_PRODUCT',
      ),
      row(
        state,
        `打算在${merchant}下单${amount}元但并未付款`,
        undefined,
        'V10_NOT_PAID',
      ),
    );
  });
  PEOPLE.forEach((person, index) => {
    const amount = AMOUNTS[(index + 2) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `我转给${person}了${amount}元`,
        person,
        'V10_PERSON_OUT',
        'PERSON',
      ),
      row(
        state,
        `${person}向我付款${amount}元`,
        person,
        'V10_PERSON_IN',
        'PERSON',
      ),
      row(
        state,
        `给${person}买礼物花${amount}元`,
        undefined,
        'V10_BENEFICIARY',
      ),
    );
  });
  ORGANIZATIONS.forEach((organization, index) => {
    const amount = 7500 + index * 640;
    rows.push(
      row(
        state,
        `收款账户名为${organization}，支付${amount}元`,
        organization,
        'V10_ORGANIZATION_FIELD',
        'ORGANIZATION',
      ),
      row(
        state,
        `工资${amount}元由${organization}汇入`,
        organization,
        'V10_ORGANIZATION_INCOME',
        'ORGANIZATION',
      ),
      row(
        state,
        `买入${organization}股票${amount}元`,
        undefined,
        'V10_ORGANIZATION_PRODUCT',
      ),
    );
  });
  CITIES.forEach((origin, index) => {
    const destination = CITIES[(index + 13) % CITIES.length];
    const amount = AMOUNTS[(index + 5) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `坐动车从${origin}到${destination}花了${amount}元`,
        undefined,
        'V10_RAIL_ROUTE',
      ),
      row(
        state,
        `从${origin}机场起飞去${destination}，机票${amount}元`,
        undefined,
        'V10_AIR_ROUTE',
      ),
      row(
        state,
        `铁路12306已扣${amount}元，车次${origin}至${destination}`,
        '铁路12306',
        'V10_RAIL_PLATFORM',
        'PLATFORM',
      ),
    );
  });
  ['支付宝', '微信支付', '银行卡'].forEach((channel, index) => {
    for (let round = 0; round < 5; round += 1) {
      const amount = AMOUNTS[(index + round + 7) % AMOUNTS.length];
      rows.push(
        row(
          state,
          `${channel}显示支出${amount}元，商户字段缺失`,
          undefined,
          'V10_CHANNEL_ONLY',
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
    args.output ?? 'data/synthetic/work/counterparty-acceptance-v10',
  );
  const rows = generate();
  const contents = jsonl(rows);
  atomicWrite(path.join(outputDir, 'acceptance.jsonl'), contents);
  const positives = rows.filter(item => item.counterparty !== null).length;
  const manifest = {
    schemaVersion: 1,
    datasetId: 'counterparty-acceptance-v10',
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
