const path = require('node:path');

const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

const MERCHANTS = [
  '暮色食堂',
  '栖迟茶舍',
  '半岛理发店',
  '拾贝水族馆',
  '橙子口腔',
  '云端打印社',
  '小鹿茶',
  '盒马鲜生',
  '罗森',
  'CoCo都可',
  '7-ELEVEN',
  'MUJI无印良品',
  '一页书房',
  '四季民宿',
  '晨星维修中心',
  '阿布烧烤',
  '十月摄影',
  '江南布衣',
  '万象滑冰场',
  '海豚洗车',
];

const PEOPLE = [
  '马骏',
  '谢楠',
  '梁辰',
  '罗佳',
  '余欢',
  '魏然',
  '薛宁',
  '杜飞',
  '孟夏',
  '乔安',
];

const ORGANIZATIONS = [
  '北斗智能科技有限公司',
  '澄海文化集团',
  '新城社区服务中心',
  '长江航运公司',
  '万木公益基金会',
];

const CITIES = [
  '无锡',
  '常州',
  '嘉兴',
  '绍兴',
  '烟台',
  '威海',
  '洛阳',
  '开封',
  '桂林',
  '南宁',
  '海口',
  '三亚',
  '乌鲁木齐',
  '西宁',
  '呼和浩特',
  '包头',
  '宜昌',
  '襄阳',
  '徐州',
  '扬州',
];

const AMOUNTS = [9, 16, 23, 37, 52, 68, 86, 119, 157, 246, 388, 520];
const ITEMS = [
  '早餐',
  '衣服',
  '洗车',
  '剪发',
  '打印资料',
  '体检',
  '晚餐',
  '鲜花',
];

function row(state, text, counterparty, scenario, difficulty, options = {}) {
  const id = `cp-accept-v2-${String(state.nextId++).padStart(5, '0')}`;
  let span = null;
  if (counterparty !== undefined) {
    const start = text.indexOf(counterparty);
    if (
      start < 0 ||
      text.indexOf(counterparty, start + counterparty.length) >= 0
    ) {
      throw new Error(`Expected one occurrence of ${counterparty}: ${text}`);
    }
    span = {
      text: counterparty,
      start,
      end: start + counterparty.length,
      kind: options.kind ?? 'MERCHANT',
      specificity: options.specificity ?? 'NAMED',
    };
  }
  return {
    id,
    text,
    split: 'acceptance',
    splitGroup: `acceptance:${scenario}:${id}`,
    scenario,
    difficulty,
    counterparty: span,
    syntheticOnly: true,
    generator: 'codex-authored-acceptance-v2',
  };
}

function generate() {
  const rows = [];
  const state = { nextId: 1 };
  MERCHANTS.forEach((merchant, index) => {
    const amount = AMOUNTS[index % AMOUNTS.length];
    const item = ITEMS[index % ITEMS.length];
    const platform = ['美团', '淘宝', '京东', '携程'][index % 4];
    const positives = [
      [
        `电子回单上的交易对方为${merchant}，${amount}元`,
        'ACCEPT_EXPLICIT_FIELD',
      ],
      [`银行卡付给${merchant}${amount}块钱`, 'ACCEPT_DIRECT_PAYEE'],
      [`刚刚在${merchant}买了${item}，一共${amount}元`, 'ACCEPT_VENUE'],
      [`这单由${merchant}实际提供服务，已经结账${amount}元`, 'ACCEPT_PROVIDER'],
      [
        `通过${platform}在${merchant}下单，最终支付${amount}元`,
        'ACCEPT_PLATFORM_PROVIDER',
      ],
    ];
    for (const [text, scenario] of positives) {
      rows.push(row(state, text, merchant, scenario, 'ACCEPT_POSITIVE'));
    }
    const negatives = [
      [
        `打算周末去${merchant}，预算${amount}元，但还没消费`,
        'ACCEPT_HYPOTHETICAL',
      ],
      [`买了一张${merchant}礼品卡${amount}元`, 'ACCEPT_BRAND_PRODUCT'],
      [`看到${merchant}招聘信息，月薪${amount}元`, 'ACCEPT_MENTION_ONLY'],
    ];
    for (const [text, scenario] of negatives) {
      rows.push(row(state, text, undefined, scenario, 'ACCEPT_NEGATIVE'));
    }
  });

  PEOPLE.forEach((person, index) => {
    const amount = AMOUNTS[(index + 4) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `刚把${amount}元转给${person}了`,
        person,
        'ACCEPT_PERSON_OUT',
        'ACCEPT_POSITIVE',
        { kind: 'PERSON' },
      ),
      row(
        state,
        `${person}给我打过来${amount}元`,
        person,
        'ACCEPT_PERSON_IN',
        'ACCEPT_POSITIVE',
        { kind: 'PERSON' },
      ),
      row(
        state,
        `给${person}买体检套餐花${amount}元`,
        undefined,
        'ACCEPT_BENEFICIARY',
        'ACCEPT_NEGATIVE',
      ),
      row(
        state,
        `跟${person}一起看电影，总票价${amount}元`,
        undefined,
        'ACCEPT_COMPANION',
        'ACCEPT_NEGATIVE',
      ),
    );
  });

  ORGANIZATIONS.forEach((organization, index) => {
    const amount = 3600 + index * 700;
    rows.push(
      row(
        state,
        `本月薪资${amount}元由${organization}汇入`,
        organization,
        'ACCEPT_ORGANIZATION_INCOME',
        'ACCEPT_POSITIVE',
        { kind: 'ORGANIZATION' },
      ),
      row(
        state,
        `${organization}发行的理财产品投入${amount}元`,
        undefined,
        'ACCEPT_ORGANIZATION_PRODUCT',
        'ACCEPT_NEGATIVE',
      ),
    );
  });

  CITIES.forEach((origin, index) => {
    const destination = CITIES[(index + 5) % CITIES.length];
    const amount = AMOUNTS[(index + 7) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `买${origin}开往${destination}的动车二等座，票价${amount}元`,
        undefined,
        'ACCEPT_ROUTE',
        'ACCEPT_NEGATIVE',
      ),
      row(
        state,
        `在${origin}南站取了去${destination}的票，支付${amount}元`,
        undefined,
        'ACCEPT_STATION',
        'ACCEPT_NEGATIVE',
      ),
      row(
        state,
        `铁路12306扣款${amount}元，行程${origin}至${destination}`,
        '铁路12306',
        'ACCEPT_RAIL_PLATFORM',
        'ACCEPT_POSITIVE',
        { kind: 'PLATFORM' },
      ),
    );
  });

  return rows;
}

function main(argv) {
  const args = parseArgs(argv);
  const outputDir = path.resolve(
    process.cwd(),
    args.output ?? 'data/synthetic/work/counterparty-acceptance-v2',
  );
  const rows = generate();
  const contents = jsonl(rows);
  atomicWrite(path.join(outputDir, 'acceptance.jsonl'), contents);
  const positives = rows.filter(item => item.counterparty !== null).length;
  const manifest = {
    schemaVersion: 1,
    datasetId: 'counterparty-acceptance-v2',
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
