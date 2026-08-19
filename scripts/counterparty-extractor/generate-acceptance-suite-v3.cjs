const path = require('node:path');

const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

const MERCHANTS = [
  '青柠小馆',
  '北岸茶室',
  '六月造型',
  '鲸落书店',
  '山丘牙科',
  '星点图文',
  '茶百道',
  '永辉超市',
  '全家',
  '喜茶',
  '宜家家居',
  '三联书店',
  '海角客栈',
  '飞驰汽修厂',
  '木炭烤肉店',
  '光影摄影馆',
  '海澜之家',
  '冰世界',
  '快洁洗车行',
  '麦香烘焙坊',
  '蓝天眼镜城',
  '邻里药店',
  '远方旅行社',
  '绿洲生鲜',
];

const PEOPLE = [
  '秦朗',
  '沈悦',
  '陆川',
  '顾瑶',
  '白帆',
  '江雪',
  '傅宁',
  '贺鸣',
  '钟灵',
  '夏言',
  '石磊',
  '温晴',
];

const ORGANIZATIONS = [
  '辰光网络有限公司',
  '云帆传媒集团',
  '春江物业服务公司',
  '南星物流公司',
  '青苗教育基金会',
  '华岳制造集团',
];

const CITIES = [
  '宁波',
  '温州',
  '金华',
  '台州',
  '佛山',
  '珠海',
  '东莞',
  '惠州',
  '大理',
  '丽江',
  '遵义',
  '安顺',
  '榆林',
  '宝鸡',
  '咸阳',
  '天水',
  '吉林',
  '牡丹江',
  '齐齐哈尔',
  '佳木斯',
  '唐山',
  '保定',
  '邯郸',
  '秦皇岛',
];

const AMOUNTS = [11, 19, 28, 43, 57, 74, 93, 126, 168, 235, 319, 486];
const PLATFORMS = ['淘宝', '京东', '美团', '饿了么', '携程', '拼多多'];

function makeRow(state, text, counterparty, scenario, kind = 'MERCHANT') {
  let span = null;
  if (counterparty !== undefined) {
    const start = text.indexOf(counterparty);
    if (
      start < 0 ||
      text.indexOf(counterparty, start + counterparty.length) >= 0
    ) {
      throw new Error(`Expected exactly one ${counterparty}: ${text}`);
    }
    span = {
      text: counterparty,
      start,
      end: start + counterparty.length,
      kind,
      specificity: 'NAMED',
    };
  }
  const id = `cp-accept-v3-${String(state.nextId++).padStart(5, '0')}`;
  return {
    id,
    text,
    split: 'acceptance',
    splitGroup: `acceptance-v3:${scenario}:${id}`,
    scenario,
    difficulty: span === null ? 'ACCEPT_NEGATIVE' : 'ACCEPT_POSITIVE',
    counterparty: span,
    syntheticOnly: true,
    generator: 'codex-authored-acceptance-v3',
  };
}

function generate() {
  const rows = [];
  const state = { nextId: 1 };
  MERCHANTS.forEach((merchant, index) => {
    const amount = AMOUNTS[index % AMOUNTS.length];
    const platform = PLATFORMS[index % PLATFORMS.length];
    rows.push(
      makeRow(
        state,
        `POS签购单写着商家名称：${merchant}；应付${amount}元`,
        merchant,
        'V3_STATEMENT_ALIAS',
      ),
      makeRow(
        state,
        `${amount}元已经交给${merchant}了`,
        merchant,
        'V3_REVERSED_PAYEE',
      ),
      makeRow(
        state,
        `午餐去了${merchant}，结账${amount}元`,
        merchant,
        'V3_VENUE',
      ),
      makeRow(
        state,
        `${merchant}收了我${amount}元餐费`,
        merchant,
        'V3_LEADING_RECEIVER',
      ),
      makeRow(
        state,
        `订单平台是${platform}，服务商为${merchant}，支付${amount}元`,
        merchant,
        'V3_SERVICE_ROLE',
      ),
      makeRow(
        state,
        `在${merchant}门口的自动售货机买水花${amount}元`,
        undefined,
        'V3_LOCATION_MODIFIER',
      ),
      makeRow(
        state,
        `收藏了${merchant}的宣传册，标价${amount}元但未购买`,
        undefined,
        'V3_UNCOMPLETED',
      ),
      makeRow(
        state,
        `${merchant}赞助的展览门票标价${amount}元`,
        undefined,
        'V3_SPONSOR_MENTION',
      ),
      makeRow(
        state,
        `购买${merchant}储值卡支付${amount}元`,
        undefined,
        'V3_BRAND_STORED_VALUE',
      ),
    );
  });

  PEOPLE.forEach((person, index) => {
    const amount = AMOUNTS[(index + 4) % AMOUNTS.length];
    rows.push(
      makeRow(
        state,
        `我把${amount}元交给${person}`,
        person,
        'V3_PERSON_OUT',
        'PERSON',
      ),
      makeRow(
        state,
        `${person}转来${amount}元`,
        person,
        'V3_PERSON_IN',
        'PERSON',
      ),
      makeRow(
        state,
        `给${person}订生日蛋糕花${amount}元`,
        undefined,
        'V3_BENEFICIARY',
      ),
      makeRow(
        state,
        `${person}陪我买鞋花${amount}元`,
        undefined,
        'V3_COMPANION',
      ),
    );
  });

  ORGANIZATIONS.forEach((organization, index) => {
    const amount = 4200 + index * 850;
    rows.push(
      makeRow(
        state,
        `银行流水付款单位：${organization}；到账${amount}元`,
        organization,
        'V3_ORGANIZATION_FIELD',
        'ORGANIZATION',
      ),
      makeRow(
        state,
        `${organization}退了${amount}元服务费`,
        organization,
        'V3_ORGANIZATION_REFUND',
        'ORGANIZATION',
      ),
      makeRow(
        state,
        `申购${organization}管理的基金${amount}元`,
        undefined,
        'V3_ORGANIZATION_PRODUCT',
      ),
    );
  });

  CITIES.forEach((origin, index) => {
    const destination = CITIES[(index + 7) % CITIES.length];
    const amount = AMOUNTS[(index + 2) % AMOUNTS.length];
    rows.push(
      makeRow(
        state,
        `${amount}元买了${origin}—${destination}城际列车票`,
        undefined,
        'V3_ROUTE_DASH',
      ),
      makeRow(
        state,
        `从${origin}站上车，${destination}站下车，车费${amount}元`,
        undefined,
        'V3_ROUTE_STATIONS',
      ),
      makeRow(
        state,
        `12306显示已付${amount}元，行程为${origin}至${destination}`,
        '12306',
        'V3_RAIL_PLATFORM',
        'PLATFORM',
      ),
    );
  });

  return rows;
}

function main(argv) {
  const args = parseArgs(argv);
  const outputDir = path.resolve(
    process.cwd(),
    args.output ?? 'data/synthetic/work/counterparty-acceptance-v3',
  );
  const rows = generate();
  const contents = jsonl(rows);
  atomicWrite(path.join(outputDir, 'acceptance.jsonl'), contents);
  const positives = rows.filter(row => row.counterparty !== null).length;
  const manifest = {
    schemaVersion: 1,
    datasetId: 'counterparty-acceptance-v3',
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
