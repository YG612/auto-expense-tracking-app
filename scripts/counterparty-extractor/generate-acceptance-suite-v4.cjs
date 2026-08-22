const path = require('node:path');

const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

const MERCHANTS = [
  '晚风食堂',
  '松果茶屋',
  '简爱发艺',
  '纸飞机书局',
  '皓齿口腔门诊',
  '墨点快印',
  '奈雪的茶',
  '大润发',
  '便利蜂',
  '古茗',
  '迪卡侬',
  '方所书店',
  '云水民宿',
  '极速车坊',
  '烟火料理店',
  '拾色照相馆',
  '太平鸟',
  '雪域冰场',
  '净车堂',
  '面包新语',
  '明亮眼镜',
  '百草堂药房',
];

const PEOPLE = [
  '苏航',
  '唐婉',
  '林昭',
  '楚宁',
  '韩松',
  '乔月',
  '任远',
  '莫凡',
  '陶然',
  '穆青',
  '尹川',
  '黎夏',
];

const ORGANIZATIONS = [
  '星原软件有限公司',
  '海岚广告集团',
  '金桂物业管理公司',
  '迅达供应链公司',
  '晨曦助学基金会',
  '恒川装备集团',
];

const CITIES = [
  '廊坊',
  '沧州',
  '衡水',
  '承德',
  '湖州',
  '衢州',
  '舟山',
  '丽水',
  '中山',
  '江门',
  '肇庆',
  '汕头',
  '曲靖',
  '玉溪',
  '楚雄',
  '普洱',
  '九江',
  '赣州',
  '上饶',
  '景德镇',
];

const AMOUNTS = [13, 21, 34, 49, 63, 81, 105, 142, 187, 258, 336];
const PLATFORMS = ['美团', '淘宝', '京东', '携程', '饿了么'];
const CHANNELS = ['支付宝', '微信支付', '信用卡'];

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
  const id = `cp-accept-v4-${String(state.nextId++).padStart(5, '0')}`;
  return {
    id,
    text,
    split: 'acceptance',
    splitGroup: `acceptance-v4:${scenario}:${id}`,
    scenario,
    difficulty: span === null ? 'ACCEPT_NEGATIVE' : 'ACCEPT_POSITIVE',
    counterparty: span,
    syntheticOnly: true,
    generator: 'codex-authored-acceptance-v4',
  };
}

function generate() {
  const rows = [];
  const state = { nextId: 1 };
  MERCHANTS.forEach((merchant, index) => {
    const amount = AMOUNTS[index % AMOUNTS.length];
    const platform = PLATFORMS[index % PLATFORMS.length];
    rows.push(
      row(
        state,
        `交易详情显示收款账户名为${merchant}，金额${amount}元`,
        merchant,
        'V4_ACCOUNT_FIELD',
      ),
      row(state, `给${merchant}付了${amount}元`, merchant, 'V4_NATURAL_PAYEE'),
      row(
        state,
        `昨晚到${merchant}吃了顿饭，一共${amount}元`,
        merchant,
        'V4_ARRIVAL_VENUE',
      ),
      row(
        state,
        `${platform}订单的实际商家：${merchant}，扣款${amount}元`,
        merchant,
        'V4_PLATFORM_ROLE',
      ),
      row(
        state,
        `退款${amount}元，来自${merchant}`,
        merchant,
        'V4_REFUND_SOURCE',
      ),
      row(
        state,
        `在${merchant}隔壁摊位买水，花${amount}元`,
        undefined,
        'V4_LOCATION_NEIGHBOR',
      ),
      row(
        state,
        `${merchant}会员卡充值${amount}元`,
        undefined,
        'V4_MEMBERSHIP_PRODUCT',
      ),
      row(
        state,
        `计划给${merchant}付${amount}元订金，但尚未支付`,
        undefined,
        'V4_PLANNED_PAYMENT',
      ),
      row(
        state,
        `新闻提到${merchant}获得${amount}万元融资`,
        undefined,
        'V4_NEWS_MENTION',
      ),
    );
  });

  PEOPLE.forEach((person, index) => {
    const amount = AMOUNTS[(index + 3) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `${amount}元已经打给${person}`,
        person,
        'V4_PERSON_OUT',
        'PERSON',
      ),
      row(
        state,
        `${person}给我打款${amount}元`,
        person,
        'V4_PERSON_IN',
        'PERSON',
      ),
      row(
        state,
        `替${person}续健身会员花${amount}元`,
        undefined,
        'V4_BENEFICIARY',
      ),
    );
  });

  ORGANIZATIONS.forEach((organization, index) => {
    const amount = 5100 + index * 720;
    rows.push(
      row(
        state,
        `收款方是${organization}，金额${amount}元`,
        organization,
        'V4_ORGANIZATION_PAYEE',
        'ORGANIZATION',
      ),
      row(
        state,
        `${organization}打来报销款${amount}元`,
        organization,
        'V4_ORGANIZATION_INCOME',
        'ORGANIZATION',
      ),
      row(
        state,
        `买${organization}承保的保险产品${amount}元`,
        undefined,
        'V4_ORGANIZATION_PRODUCT',
      ),
    );
  });

  CITIES.forEach((origin, index) => {
    const destination = CITIES[(index + 6) % CITIES.length];
    const amount = AMOUNTS[(index + 5) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `${amount}元购票，起点${origin}，终点${destination}`,
        undefined,
        'V4_ROUTE_FIELDS',
      ),
      row(
        state,
        `在${origin}机场买飞往${destination}的机票${amount}元`,
        undefined,
        'V4_AIR_ROUTE',
      ),
      row(
        state,
        `铁路12306支付成功${amount}元，${origin}至${destination}`,
        '铁路12306',
        'V4_RAIL_PLATFORM',
        'PLATFORM',
      ),
    );
  });

  CHANNELS.forEach((channel, index) => {
    for (let round = 0; round < 4; round += 1) {
      const amount = AMOUNTS[(index + round + 7) % AMOUNTS.length];
      rows.push(
        row(
          state,
          `${channel}扣款${amount}元，商家信息为空`,
          undefined,
          'V4_CHANNEL_WITHOUT_PARTY',
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
    args.output ?? 'data/synthetic/work/counterparty-acceptance-v4',
  );
  const rows = generate();
  const contents = jsonl(rows);
  atomicWrite(path.join(outputDir, 'acceptance.jsonl'), contents);
  const positives = rows.filter(item => item.counterparty !== null).length;
  const manifest = {
    schemaVersion: 1,
    datasetId: 'counterparty-acceptance-v4',
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
