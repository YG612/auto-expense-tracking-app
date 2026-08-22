const path = require('node:path');
const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

const MERCHANTS = [
  '河畔餐馆',
  '竹林茶室',
  '新潮发型店',
  '知行书店',
  '爱牙口腔诊所',
  '快捷文印店',
  '日光咖啡馆',
  '惠民超市',
  '街角便利店',
  '清甜饮品店',
  '木森家居城',
  '墨香书屋',
  '望月酒店',
  '安捷维修中心',
  '炭火烧烤店',
  '流年摄影馆',
  '青禾服装店',
  '星光滑冰馆',
  '一路洗车行',
  '谷物烘焙店',
  '视界眼镜店',
  '仁和药房',
  '云游旅行社',
  '四季生鲜店',
];
const PEOPLE = [
  '姜海',
  '宋云',
  '梁秋',
  '杜若',
  '魏明',
  '谢雨',
  '马超',
  '罗兰',
  '余音',
  '薛平',
  '孟然',
  '贺秋',
];
const ORGANIZATIONS = [
  '蓝海数字科技有限公司',
  '青峰品牌集团',
  '和美物业服务公司',
  '畅达运输公司',
  '暖阳慈善基金会',
  '华星机械集团',
];
const CITIES = [
  '南通',
  '镇江',
  '连云港',
  '马鞍山',
  '黄山',
  '滁州',
  '郴州',
  '常德',
  '益阳',
  '永州',
  '百色',
  '河池',
  '泸州',
  '广元',
  '遂宁',
  '南充',
  '焦作',
  '新乡',
  '许昌',
  '周口',
];
const AMOUNTS = [15, 24, 39, 53, 69, 87, 112, 149, 197, 271, 356];
const CHANNELS = ['支付宝', '微信支付', '现金'];

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
  const id = `cp-accept-v6-${String(state.nextId++).padStart(5, '0')}`;
  return {
    id,
    text,
    split: 'acceptance',
    splitGroup: `acceptance-v6:${scenario}:${id}`,
    scenario,
    difficulty: span === null ? 'ACCEPT_NEGATIVE' : 'ACCEPT_POSITIVE',
    counterparty: span,
    syntheticOnly: true,
    generator: 'codex-authored-acceptance-v6',
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
        `电子账单收款单位为${merchant}，支出${amount}元`,
        merchant,
        'V6_PAYEE_FIELD',
      ),
      row(state, `向${merchant}打款${amount}元`, merchant, 'V6_DIRECT_PAYEE'),
      row(
        state,
        `下班去${merchant}付款${amount}元`,
        merchant,
        'V6_SUFFIX_VENUE',
      ),
      row(
        state,
        `本单服务商：${merchant}；实付${amount}元`,
        merchant,
        'V6_PROVIDER_FIELD',
      ),
      row(
        state,
        `${merchant}退款给我${amount}元`,
        merchant,
        'V6_REFUND_SOURCE',
      ),
      row(
        state,
        `在${merchant}门口另一家店买东西花${amount}元`,
        undefined,
        'V6_LOCATION_MODIFIER',
      ),
      row(
        state,
        `买了${merchant}礼品卡${amount}元`,
        undefined,
        'V6_BRAND_CARD',
      ),
      row(
        state,
        `打算去${merchant}消费${amount}元，后来取消`,
        undefined,
        'V6_CANCELLED',
      ),
      row(
        state,
        `${merchant}招聘岗位月薪${amount}元`,
        undefined,
        'V6_JOB_MENTION',
      ),
    );
  });
  PEOPLE.forEach((person, index) => {
    const amount = AMOUNTS[(index + 3) % AMOUNTS.length];
    rows.push(
      row(state, `${amount}元转给${person}`, person, 'V6_PERSON_OUT', 'PERSON'),
      row(
        state,
        `${person}给我转来${amount}元`,
        person,
        'V6_PERSON_IN',
        'PERSON',
      ),
      row(
        state,
        `给${person}买报名材料花${amount}元`,
        undefined,
        'V6_BENEFICIARY',
      ),
    );
  });
  ORGANIZATIONS.forEach((organization, index) => {
    const amount = 6100 + index * 830;
    rows.push(
      row(
        state,
        `付款方为${organization}，入账${amount}元`,
        organization,
        'V6_ORGANIZATION_PAYER',
        'ORGANIZATION',
      ),
      row(
        state,
        `薪资由${organization}发放，共${amount}元`,
        organization,
        'V6_ORGANIZATION_INCOME',
        'ORGANIZATION',
      ),
      row(
        state,
        `申购${organization}发行的债券${amount}元`,
        undefined,
        'V6_ORGANIZATION_PRODUCT',
      ),
    );
  });
  CITIES.forEach((origin, index) => {
    const destination = CITIES[(index + 5) % CITIES.length];
    const amount = AMOUNTS[(index + 4) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `航班${origin}至${destination}票价${amount}元`,
        undefined,
        'V6_AIR_ROUTE',
      ),
      row(
        state,
        `从${origin}站乘高铁到${destination}站，票款${amount}元`,
        undefined,
        'V6_RAIL_ROUTE',
      ),
      row(
        state,
        `铁路12306扣款${amount}元，${origin}前往${destination}`,
        '铁路12306',
        'V6_RAIL_PLATFORM',
        'PLATFORM',
      ),
    );
  });
  CHANNELS.forEach((channel, index) => {
    for (let round = 0; round < 4; round += 1) {
      const amount = AMOUNTS[(index + round + 5) % AMOUNTS.length];
      rows.push(
        row(
          state,
          `${channel}支付${amount}元，收款方缺失`,
          undefined,
          'V6_EMPTY_FIELD',
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
    args.output ?? 'data/synthetic/work/counterparty-acceptance-v6',
  );
  const rows = generate();
  const contents = jsonl(rows);
  atomicWrite(path.join(outputDir, 'acceptance.jsonl'), contents);
  const positives = rows.filter(item => item.counterparty !== null).length;
  const manifest = {
    schemaVersion: 1,
    datasetId: 'counterparty-acceptance-v6',
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
