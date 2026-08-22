const path = require('node:path');

const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

const MERCHANTS = [
  '秋实餐厅',
  '白云茶馆',
  '时光理发店',
  '远山书屋',
  '微笑口腔诊所',
  '蓝图打印店',
  '初见咖啡馆',
  '乐家超市',
  '每日便利店',
  '小满奶茶店',
  '原野家居城',
  '晨读书房',
  '听海酒店',
  '顺达维修中心',
  '山野烧烤店',
  '定格照相馆',
  '春风服装店',
  '极光滑冰馆',
  '洁净洗车行',
  '麦香面包店',
  '清晰眼镜店',
  '康健药房',
  '行者旅行社',
  '新鲜生鲜店',
  '活力健身房',
];
const PEOPLE = [
  '叶澄',
  '程野',
  '许诺',
  '顾言',
  '周星',
  '陆遥',
  '江晨',
  '沈安',
  '林溪',
  '唐乐',
  '苏木',
  '乔伊',
];
const ORGANIZATIONS = [
  '启航信息技术有限公司',
  '山海创意集团',
  '春晖物业有限公司',
  '速运物流集团',
  '希望公益基金会',
  '远峰工业公司',
];
const CITIES = [
  '泰州',
  '盐城',
  '淮安',
  '宿迁',
  '芜湖',
  '蚌埠',
  '阜阳',
  '安庆',
  '株洲',
  '湘潭',
  '岳阳',
  '衡阳',
  '柳州',
  '梧州',
  '北海',
  '钦州',
  '绵阳',
  '德阳',
  '乐山',
  '宜宾',
];
const AMOUNTS = [14, 22, 36, 51, 67, 84, 109, 146, 193, 264, 349];
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
  const id = `cp-accept-v5-${String(state.nextId++).padStart(5, '0')}`;
  return {
    id,
    text,
    split: 'acceptance',
    splitGroup: `acceptance-v5:${scenario}:${id}`,
    scenario,
    difficulty: span === null ? 'ACCEPT_NEGATIVE' : 'ACCEPT_POSITIVE',
    counterparty: span,
    syntheticOnly: true,
    generator: 'codex-authored-acceptance-v5',
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
        `付款凭证对方名称：${merchant}，本次${amount}元`,
        merchant,
        'V5_PARTY_FIELD',
      ),
      row(state, `${amount}元汇给${merchant}`, merchant, 'V5_DIRECT_PAYEE'),
      row(
        state,
        `下午在${merchant}消费${amount}元`,
        merchant,
        'V5_SUFFIX_VENUE',
      ),
      row(
        state,
        `这笔的实际供应商为${merchant}，已付${amount}元`,
        merchant,
        'V5_PROVIDER_FIELD',
      ),
      row(
        state,
        `${merchant}退款${amount}元到账`,
        merchant,
        'V5_REFUND_SOURCE',
      ),
      row(
        state,
        `在${merchant}旁边的小摊买水花${amount}元`,
        undefined,
        'V5_LOCATION_MODIFIER',
      ),
      row(
        state,
        `购买${merchant}优惠券花${amount}元`,
        undefined,
        'V5_BRAND_COUPON',
      ),
      row(
        state,
        `只是咨询${merchant}的价格${amount}元，并未支付`,
        undefined,
        'V5_CONSULT_ONLY',
      ),
      row(
        state,
        `${merchant}上新商品售价${amount}元`,
        undefined,
        'V5_PRICE_MENTION',
      ),
    );
  });

  PEOPLE.forEach((person, index) => {
    const amount = AMOUNTS[(index + 2) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `我已转账给${person}${amount}元`,
        person,
        'V5_PERSON_OUT',
        'PERSON',
      ),
      row(
        state,
        `收到${person}汇来的${amount}元`,
        person,
        'V5_PERSON_IN',
        'PERSON',
      ),
      row(state, `帮${person}交考试费${amount}元`, undefined, 'V5_BENEFICIARY'),
    );
  });

  ORGANIZATIONS.forEach((organization, index) => {
    const amount = 5600 + index * 760;
    rows.push(
      row(
        state,
        `交易对象为${organization}，付款${amount}元`,
        organization,
        'V5_ORGANIZATION_PAYEE',
        'ORGANIZATION',
      ),
      row(
        state,
        `收到${organization}发来的奖金${amount}元`,
        organization,
        'V5_ORGANIZATION_INCOME',
        'ORGANIZATION',
      ),
      row(
        state,
        `${organization}管理的理财产品投入${amount}元`,
        undefined,
        'V5_ORGANIZATION_PRODUCT',
      ),
    );
  });

  CITIES.forEach((origin, index) => {
    const destination = CITIES[(index + 8) % CITIES.length];
    const amount = AMOUNTS[(index + 4) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `票款${amount}元，出发地${origin}，到达地${destination}`,
        undefined,
        'V5_ROUTE_FIELDS',
      ),
      row(
        state,
        `从${origin}机场飞${destination}，机票${amount}元`,
        undefined,
        'V5_AIR_ROUTE',
      ),
      row(
        state,
        `铁路12306已扣${amount}元，路线${origin}-${destination}`,
        '铁路12306',
        'V5_RAIL_PLATFORM',
        'PLATFORM',
      ),
    );
  });

  CHANNELS.forEach((channel, index) => {
    for (let round = 0; round < 4; round += 1) {
      const amount = AMOUNTS[(index + round + 6) % AMOUNTS.length];
      rows.push(
        row(
          state,
          `${channel}完成扣款${amount}元，对方名称未提供`,
          undefined,
          'V5_EMPTY_PARTY_FIELD',
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
    args.output ?? 'data/synthetic/work/counterparty-acceptance-v5',
  );
  const rows = generate();
  const contents = jsonl(rows);
  atomicWrite(path.join(outputDir, 'acceptance.jsonl'), contents);
  const positives = rows.filter(item => item.counterparty !== null).length;
  const manifest = {
    schemaVersion: 1,
    datasetId: 'counterparty-acceptance-v5',
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
