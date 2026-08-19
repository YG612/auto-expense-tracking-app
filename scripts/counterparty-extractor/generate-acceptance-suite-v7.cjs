const path = require('node:path');
const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

const MERCHANTS = [
  '湖心餐厅',
  '清风茶馆',
  '摩登造型店',
  '万卷书店',
  '健齿口腔诊所',
  '飞页打印店',
  '岛屿咖啡馆',
  '丰收超市',
  '随手便利店',
  '甘露饮品店',
  '橡木家居城',
  '拾页书屋',
  '临江酒店',
  '迅捷维修中心',
  '炉边烧烤店',
  '瞬间照相馆',
  '云裳服装店',
  '银河滑冰馆',
  '驰骋洗车行',
  '原麦烘焙店',
  '慧眼眼镜店',
  '同仁药房',
  '漫步旅行社',
  '鲜达生鲜店',
  '跃动健身房',
  '朝露花店',
  '山泉水果店',
  '向阳宠物医院',
  '新星文具店',
  '泊岸民宿店',
];
const PEOPLE = [
  '丁浩',
  '方宁',
  '侯佳',
  '孔明',
  '雷雨',
  '潘悦',
  '邱晨',
  '史航',
  '田野',
  '汪洋',
  '熊安',
  '杨帆',
  '曾晴',
  '朱林',
  '郝然',
];
const ORGANIZATIONS = [
  '远海数据有限公司',
  '森合文化集团',
  '安居物业公司',
  '飞马物流公司',
  '青山公益基金会',
  '宏图制造集团',
  '晴空咨询有限公司',
  '百川教育集团',
  '同城服务公司',
  '新锐科技公司',
];
const CITIES = [
  '淄博',
  '潍坊',
  '临沂',
  '济宁',
  '泰安',
  '枣庄',
  '宜春',
  '萍乡',
  '新余',
  '吉安',
  '十堰',
  '荆州',
  '荆门',
  '黄石',
  '孝感',
  '鄂州',
  '平顶山',
  '洛河',
  '商丘',
  '驻马店',
];
const AMOUNTS = [17, 26, 41, 55, 72, 91, 116, 153, 203, 279, 365];
const CHANNELS = ['支付宝', '微信支付', '信用卡'];

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
  const id = `cp-accept-v7-${String(state.nextId++).padStart(5, '0')}`;
  return {
    id,
    text,
    split: 'acceptance',
    splitGroup: `acceptance-v7:${scenario}:${id}`,
    scenario,
    difficulty: span === null ? 'ACCEPT_NEGATIVE' : 'ACCEPT_POSITIVE',
    counterparty: span,
    syntheticOnly: true,
    generator: 'codex-authored-acceptance-v7',
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
        `交易明细的交易对方是${merchant}，扣款${amount}元`,
        merchant,
        'V7_PARTY_FIELD',
      ),
      row(state, `付给${merchant}共${amount}元`, merchant, 'V7_DIRECT_PAYEE'),
      row(
        state,
        `周末在${merchant}结账${amount}元`,
        merchant,
        'V7_SUFFIX_VENUE',
      ),
      row(
        state,
        `在${merchant}附近另一间商铺购物${amount}元`,
        undefined,
        'V7_LOCATION_MODIFIER',
      ),
      row(
        state,
        `购买${merchant}代金券${amount}元`,
        undefined,
        'V7_BRAND_COUPON',
      ),
      row(
        state,
        `准备到${merchant}付款${amount}元，最终没有付款`,
        undefined,
        'V7_UNFINISHED',
      ),
    );
  });
  PEOPLE.forEach((person, index) => {
    const amount = AMOUNTS[(index + 4) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `给${person}转账${amount}元`,
        person,
        'V7_PERSON_OUT',
        'PERSON',
      ),
      row(
        state,
        `收到${person}打款${amount}元`,
        person,
        'V7_PERSON_IN',
        'PERSON',
      ),
      row(state, `替${person}买课程花${amount}元`, undefined, 'V7_BENEFICIARY'),
    );
  });
  ORGANIZATIONS.forEach((organization, index) => {
    const amount = 6600 + index * 590;
    rows.push(
      row(
        state,
        `对方户名：${organization}，本次${amount}元`,
        organization,
        'V7_ORGANIZATION_FIELD',
        'ORGANIZATION',
      ),
      row(
        state,
        `收到${organization}退款${amount}元`,
        organization,
        'V7_ORGANIZATION_REFUND',
        'ORGANIZATION',
      ),
      row(
        state,
        `购买${organization}发行的基金${amount}元`,
        undefined,
        'V7_ORGANIZATION_PRODUCT',
      ),
    );
  });
  CITIES.forEach((origin, index) => {
    const destination = CITIES[(index + 7) % CITIES.length];
    const amount = AMOUNTS[(index + 3) % AMOUNTS.length];
    rows.push(
      row(
        state,
        `${amount}元买${origin}到${destination}的动车票`,
        undefined,
        'V7_RAIL_ROUTE',
      ),
      row(
        state,
        `${origin}机场飞往${destination}，票价${amount}元`,
        undefined,
        'V7_AIR_ROUTE',
      ),
      row(
        state,
        `12306付款${amount}元，行程${origin}-${destination}`,
        '12306',
        'V7_RAIL_PLATFORM',
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
          `${channel}扣除${amount}元，没有展示交易对象`,
          undefined,
          'V7_CHANNEL_ONLY',
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
    args.output ?? 'data/synthetic/work/counterparty-acceptance-v7',
  );
  const rows = generate();
  const contents = jsonl(rows);
  atomicWrite(path.join(outputDir, 'acceptance.jsonl'), contents);
  const positives = rows.filter(item => item.counterparty !== null).length;
  const manifest = {
    schemaVersion: 1,
    datasetId: 'counterparty-acceptance-v7',
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
