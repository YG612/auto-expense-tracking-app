const path = require('node:path');
const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

const MERCHANTS = [
  '云岚餐馆',
  '青竹茶室',
  '新锐造型店',
  '拾光书屋',
  '康桥口腔诊所',
  '墨点图文店',
  '北岸咖啡馆',
  '丰收生活超市',
  '转角便利店',
  '初雪甜品店',
  '筑梦家居城',
  '问津书房',
  '远山酒店',
  '迅捷汽修厂',
  '炭火烤肉馆',
  '晴空照相馆',
  '简衣服饰店',
  '飞跃运动馆',
  '清泉洗车行',
  '稻香烘焙坊',
  '清晰眼镜店',
  '仁心大药房',
  '四海旅行社',
  '绿野生鲜店',
  '活力健身房',
  '小岛花店',
  '星幕影城',
  '春风面馆',
  '月桂宾馆',
  '萌友宠物医院',
];
const PEOPLE = [
  '艾青',
  '白露',
  '陈澈',
  '杜衡',
  '方圆',
  '高朗',
  '何川',
  '纪宁',
  '孔明',
  '蓝心',
  '莫凡',
  '宁夏',
  '潘悦',
  '任远',
  '苏禾',
  '唐安',
  '王简',
  '叶舟',
];
const ORGANIZATIONS = [
  '启明数据有限公司',
  '元盛文化集团',
  '嘉禾物业公司',
  '远帆物流公司',
  '青藤公益基金会',
  '华岳设备公司',
  '景元咨询集团',
  '博识教育公司',
  '恒泰服务集团',
  '云图科技有限公司',
  '百川设计公司',
  '新元制造集团',
];
const CITIES = [
  '承德',
  '秦皇岛',
  '保定',
  '邯郸',
  '邢台',
  '大同',
  '长治',
  '晋城',
  '朔州',
  '忻州',
  '运城',
  '临汾',
  '吕梁',
  '赤峰',
  '通辽',
  '鄂尔多斯',
  '呼伦贝尔',
  '巴彦淖尔',
  '乌兰察布',
  '辽阳',
  '盘锦',
  '铁岭',
  '朝阳',
  '葫芦岛',
  '丹东',
];
const AMOUNTS = [16, 25, 39, 53, 68, 87, 109, 143, 196, 264, 358];
const CHANNELS = ['支付宝', '微信支付', '银行卡'];

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
  const id = `cp-accept-v9-${String(state.nextId++).padStart(5, '0')}`;
  return {
    id,
    text,
    split: 'acceptance',
    splitGroup: `acceptance-v9:${scenario}:${id}`,
    scenario,
    difficulty: span === null ? 'ACCEPT_NEGATIVE' : 'ACCEPT_POSITIVE',
    counterparty: span,
    syntheticOnly: true,
    generator: 'codex-authored-acceptance-v9',
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
        `账单显示交易对方：${merchant}，金额${amount}元`,
        merchant,
        'V9_MERCHANT_FIELD',
      ),
      row(state, `我向${merchant}付款${amount}元`, merchant, 'V9_DIRECT_PAYEE'),
      row(
        state,
        `午后去了${merchant}，花了${amount}元`,
        merchant,
        'V9_SUFFIX_VENUE',
      ),
      row(
        state,
        `在${merchant}楼下临时摊买水果花${amount}元`,
        undefined,
        'V9_LOCATION_MODIFIER',
      ),
      row(
        state,
        `买了${merchant}联名代金券，支付${amount}元`,
        undefined,
        'V9_BRAND_PRODUCT',
      ),
      row(
        state,
        `本来准备去${merchant}付款${amount}元，后来取消了支付`,
        undefined,
        'V9_CANCELLED_TRANSACTION',
      ),
    );
  });
  PEOPLE.forEach((person, index) => {
    const amount = AMOUNTS[(index + 4) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `昨晚打款给${person}${amount}元`,
        person,
        'V9_PERSON_OUT',
        'PERSON',
      ),
      row(
        state,
        `收到${person}打来的${amount}元`,
        person,
        'V9_PERSON_IN',
        'PERSON',
      ),
      row(state, `替${person}交培训费${amount}元`, undefined, 'V9_BENEFICIARY'),
    );
  });
  ORGANIZATIONS.forEach((organization, index) => {
    const amount = 6800 + index * 730;
    rows.push(
      row(
        state,
        `付款方：${organization}，金额${amount}元`,
        organization,
        'V9_ORGANIZATION_FIELD',
        'ORGANIZATION',
      ),
      row(
        state,
        `${organization}向我结算${amount}元`,
        organization,
        'V9_ORGANIZATION_INCOME',
        'ORGANIZATION',
      ),
      row(
        state,
        `购入${organization}发行的基金${amount}元`,
        undefined,
        'V9_ORGANIZATION_PRODUCT',
      ),
    );
  });
  CITIES.forEach((origin, index) => {
    const destination = CITIES[(index + 11) % CITIES.length];
    const amount = AMOUNTS[(index + 3) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `从${origin}坐高铁去${destination}，票价${amount}元`,
        undefined,
        'V9_RAIL_ROUTE',
      ),
      row(
        state,
        `预订${origin}飞${destination}的机票花${amount}元`,
        undefined,
        'V9_AIR_ROUTE',
      ),
      row(
        state,
        `在12306购票支付${amount}元，行程${origin}到${destination}`,
        '12306',
        'V9_RAIL_PLATFORM',
        'PLATFORM',
      ),
    );
  });
  CHANNELS.forEach((channel, index) => {
    for (let round = 0; round < 5; round += 1) {
      const amount = AMOUNTS[(index + round + 6) % AMOUNTS.length];
      rows.push(
        row(
          state,
          `${channel}扣款${amount}元，对方名称未提供`,
          undefined,
          'V9_CHANNEL_ONLY',
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
    args.output ?? 'data/synthetic/work/counterparty-acceptance-v9',
  );
  const rows = generate();
  const contents = jsonl(rows);
  atomicWrite(path.join(outputDir, 'acceptance.jsonl'), contents);
  const positives = rows.filter(item => item.counterparty !== null).length;
  const manifest = {
    schemaVersion: 1,
    datasetId: 'counterparty-acceptance-v9',
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
