const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');

const POOLS = {
  train: {
    merchants: [
      '青禾面馆',
      '云栖书屋',
      '松风咖啡',
      '明湖药房',
      '北辰影城',
      '春晓花店',
      '拾光烘焙店',
      '山海便利店',
      '稻香餐馆',
      '微光眼镜店',
      '长乐茶馆',
      '白鹭酒店',
      '新叶文具店',
      '清泉水果店',
      '星河健身房',
      '暖阳宠物医院',
      '远帆旅行社',
      '知味小吃店',
      '安康诊所',
      '蓝湾超市',
      '风铃洗衣店',
      '嘉木家居城',
      '麦田照相馆',
      '晨露生鲜店',
    ],
    people: [
      '张强',
      '李敏',
      '王磊',
      '陈静',
      '刘洋',
      '赵倩',
      '周航',
      '吴桐',
      '孙悦',
      '郑凯',
      '何安',
      '高宁',
    ],
    organizations: [
      '东湖科技有限公司',
      '远山设计集团',
      '明德培训学校',
      '海川物业公司',
      '青云航空公司',
      '安澜保险公司',
    ],
    cities: [
      '武汉',
      '上海',
      '北京',
      '广州',
      '成都',
      '西安',
      '长沙',
      '南京',
      '杭州',
      '合肥',
      '南昌',
      '郑州',
    ],
  },
  validation: {
    merchants: [
      '竹影餐厅',
      '南风书店',
      '月白咖啡馆',
      '康宁药店',
      '金桥影院',
      '鹿鸣酒店',
      '花屿超市',
      '木棉洗衣店',
    ],
    people: ['林森', '唐雨', '许舟', '宋佳', '冯晨', '邓琳'],
    organizations: ['瀚海咨询有限公司', '博雅教育集团', '新港物业公司'],
    cities: ['天津', '济南', '青岛', '沈阳', '大连', '太原', '石家庄', '苏州'],
  },
  frozenTest: {
    merchants: [
      '浮光面馆',
      '听雨书房',
      '原野咖啡',
      '仁心药房',
      '银杏影城',
      '泊舟酒店',
      '谷雨生鲜店',
      '栖木花店',
      '半夏诊所',
      '长空健身房',
      '小满便利店',
      '晴川照相馆',
    ],
    people: ['蒋峰', '韩梅', '曹宇', '彭月', '潘虹', '董川', '叶青', '袁野'],
    organizations: [
      '凌云数据有限公司',
      '启明研究院',
      '丰泽物业集团',
      '远望航空公司',
    ],
    cities: [
      '福州',
      '厦门',
      '泉州',
      '昆明',
      '贵阳',
      '重庆',
      '兰州',
      '银川',
      '哈尔滨',
      '长春',
    ],
  },
};

const AMOUNTS = [12, 18, 25, 32, 46, 58, 79, 108, 136, 199, 270, 358];
const ITEMS = [
  '早餐',
  '咖啡',
  '牛奶',
  '感冒药',
  '书',
  '电影票',
  '鲜花',
  '眼镜',
  '晚饭',
  '宠物药品',
];
const CHANNELS = ['支付宝', '微信支付', '信用卡', '银行卡'];
const PLATFORMS = ['淘宝', '京东', '美团', '饿了么', '携程'];
const TIMES = ['今天', '昨天晚上', '周一中午', '刚才', '这个月'];

function occurrence(text, value) {
  const start = text.indexOf(value);
  if (start < 0 || text.indexOf(value, start + value.length) >= 0) {
    throw new Error(
      `Counterparty must occur exactly once: ${value} in ${text}`,
    );
  }
  return { text: value, start, end: start + value.length };
}

function makeRow(state, options) {
  const id = `cp-${options.split}-${String(state.nextId++).padStart(6, '0')}`;
  const counterparty =
    options.counterparty === undefined
      ? null
      : {
          ...occurrence(options.text, options.counterparty),
          kind: options.kind ?? 'MERCHANT',
          specificity: options.specificity ?? 'NAMED',
        };
  return {
    id,
    text: options.text,
    split: options.split,
    splitGroup: options.splitGroup,
    scenario: options.scenario,
    difficulty: options.difficulty ?? 'STANDARD',
    counterparty,
    syntheticOnly: true,
    generator: 'codex-authored-deterministic-v1',
  };
}

function add(
  rows,
  state,
  split,
  splitGroup,
  scenario,
  text,
  counterparty,
  extra = {},
) {
  rows.push(
    makeRow(state, {
      split,
      splitGroup,
      scenario,
      text,
      counterparty,
      ...extra,
    }),
  );
}

function merchantRows(rows, state, split, pool, rounds) {
  pool.merchants.forEach((merchant, merchantIndex) => {
    for (let round = 0; round < rounds; round += 1) {
      const amount = AMOUNTS[(merchantIndex + round) % AMOUNTS.length];
      const item = ITEMS[(merchantIndex * 3 + round) % ITEMS.length];
      const channel = CHANNELS[(merchantIndex + round) % CHANNELS.length];
      const platform = PLATFORMS[(merchantIndex + round) % PLATFORMS.length];
      const city = pool.cities[(merchantIndex + round) % pool.cities.length];
      const otherCity =
        pool.cities[(merchantIndex + round + 3) % pool.cities.length];
      const time = TIMES[(merchantIndex + round) % TIMES.length];
      const group = `merchant:${merchant}`;
      add(
        rows,
        state,
        split,
        group,
        'VENUE_PURCHASE',
        `${time}在${merchant}买${item}花了${amount}元`,
        merchant,
      );
      add(
        rows,
        state,
        split,
        group,
        'DIRECT_PAYEE_WITH_CHANNEL',
        `用${channel}付给${merchant}${amount}块`,
        merchant,
        { difficulty: 'HARD_MULTI_ENTITY' },
      );
      add(
        rows,
        state,
        split,
        group,
        'EXPLICIT_MERCHANT_FIELD',
        `交易提醒，商户：${merchant}，实付${amount}元`,
        merchant,
      );
      add(
        rows,
        state,
        split,
        group,
        'LEADING_RECEIPT',
        `${merchant}消费${amount}元`,
        merchant,
      );
      add(
        rows,
        state,
        split,
        group,
        'LOCATION_AND_MERCHANT',
        `${time}到${city}出差，在${merchant}花了${amount}元`,
        merchant,
        { difficulty: 'HARD_LOCATION' },
      );
      add(
        rows,
        state,
        split,
        group,
        'ROUTE_THEN_MERCHANT',
        `从${city}到${otherCity}后去${merchant}吃饭花${amount}元`,
        merchant,
        { difficulty: 'HARD_LOCATION' },
      );
      add(
        rows,
        state,
        split,
        group,
        'PLATFORM_AND_PROVIDER',
        `在${platform}上买${merchant}的${item}，付款${amount}元`,
        merchant,
        { difficulty: 'HARD_MULTI_ENTITY' },
      );
      add(
        rows,
        state,
        split,
        group,
        'NEGATED_MERCHANT',
        `不是去${platform}，最后在${merchant}买的${item}${amount}元`,
        merchant,
        { difficulty: 'HARD_NEGATION' },
      );
      add(
        rows,
        state,
        split,
        group,
        'BRAND_AS_PRODUCT',
        `网上买了${merchant}联名杯，花了${amount}元`,
        undefined,
        { difficulty: 'HARD_BRAND_PRODUCT' },
      );
      add(
        rows,
        state,
        split,
        group,
        'BRAND_AS_SECURITY',
        `今天买${merchant}股票投入${amount}元`,
        undefined,
        { difficulty: 'HARD_BRAND_PRODUCT' },
      );
      add(
        rows,
        state,
        split,
        group,
        'MENTION_ONLY',
        `听说${merchant}在${city}开了新店`,
        undefined,
        { difficulty: 'HARD_NO_TRANSACTION' },
      );
    }
  });
}

function personRows(rows, state, split, pool, rounds) {
  pool.people.forEach((person, index) => {
    for (let round = 0; round < rounds; round += 1) {
      const amount = AMOUNTS[(index + round + 4) % AMOUNTS.length];
      const merchant = pool.merchants[(index + round) % pool.merchants.length];
      const city = pool.cities[(index + round) % pool.cities.length];
      const group = `person:${person}`;
      add(
        rows,
        state,
        split,
        group,
        'PERSON_TRANSFER_OUT',
        `给${person}转了${amount}元`,
        person,
        { kind: 'PERSON' },
      );
      add(
        rows,
        state,
        split,
        group,
        'PERSON_TRANSFER_IN',
        `收到${person}转账${amount}元`,
        person,
        { kind: 'PERSON' },
      );
      add(
        rows,
        state,
        split,
        group,
        'BENEFICIARY_NOT_PARTY',
        `帮${person}在${merchant}买药花了${amount}元`,
        merchant,
        { difficulty: 'HARD_BENEFICIARY' },
      );
      add(
        rows,
        state,
        split,
        group,
        'COMPANION_NOT_PARTY',
        `和${person}在${city}吃饭一共${amount}元`,
        undefined,
        { difficulty: 'HARD_COMPANION' },
      );
    }
  });
}

function organizationRows(rows, state, split, pool, rounds) {
  pool.organizations.forEach((organization, index) => {
    for (let round = 0; round < rounds; round += 1) {
      const amount = (index + round + 5) * 1000;
      const group = `organization:${organization}`;
      add(
        rows,
        state,
        split,
        group,
        'SALARY_SOURCE',
        `收到${organization}发的工资${amount}元`,
        organization,
        { kind: 'ORGANIZATION' },
      );
      add(
        rows,
        state,
        split,
        group,
        'ORGANIZATION_REFUND',
        `${organization}退款${AMOUNTS[(index + round) % AMOUNTS.length]}元到账`,
        organization,
        { kind: 'ORGANIZATION' },
      );
      add(
        rows,
        state,
        split,
        group,
        'ORGANIZATION_SECURITY',
        `买了${organization}发行的债券${amount}元`,
        undefined,
        { difficulty: 'HARD_BRAND_PRODUCT' },
      );
      add(
        rows,
        state,
        split,
        group,
        'EMPLOYER_MENTION_ONLY',
        `${organization}通知下月调整工资`,
        undefined,
        { difficulty: 'HARD_NO_TRANSACTION' },
      );
    }
  });
}

function routeAndGenericRows(rows, state, split, pool, rounds) {
  for (let index = 0; index < pool.cities.length; index += 1) {
    for (let round = 0; round < rounds; round += 1) {
      const origin = pool.cities[index];
      const destination = pool.cities[(index + round + 1) % pool.cities.length];
      if (origin === destination) continue;
      const amount = AMOUNTS[(index + round + 8) % AMOUNTS.length];
      const person = pool.people[(index + round) % pool.people.length];
      const group = `route:${origin}:${destination}`;
      add(
        rows,
        state,
        split,
        group,
        'ROUTE_TICKET_NO_PARTY',
        `说今天从${origin}到${destination}买的动车票花了${amount}`,
        undefined,
        { difficulty: 'HARD_ROUTE_LOCATION' },
      );
      add(
        rows,
        state,
        split,
        group,
        'CHANNEL_ONLY_TICKET',
        `用支付宝买了${origin}到${destination}的高铁票${amount}元`,
        undefined,
        { difficulty: 'HARD_CHANNEL' },
      );
      add(
        rows,
        state,
        split,
        group,
        'PERSON_AND_ROUTE',
        `帮${person}买${origin}到${destination}的火车票${amount}元`,
        undefined,
        { difficulty: 'HARD_BENEFICIARY' },
      );
      add(
        rows,
        state,
        split,
        group,
        'EXPLICIT_RAIL_PLATFORM',
        `在铁路12306买${origin}到${destination}动车票花${amount}元`,
        '铁路12306',
        { difficulty: 'HARD_LOCATION' },
      );
    }
  }
  const generic = ['商场', '超市', '便利店', '公司', '学校', '医院', '房东'];
  generic.forEach((value, index) => {
    const amount = AMOUNTS[index % AMOUNTS.length];
    const scenario =
      value === '公司' ? 'GENERIC_INCOME_SOURCE' : 'GENERIC_COUNTERPARTY';
    const text =
      value === '公司'
        ? `公司发了奖金${amount}元`
        : `在${value}付款${amount}元`;
    add(rows, state, split, `generic:${value}`, scenario, text, value, {
      kind: value === '公司' ? 'ORGANIZATION' : 'MERCHANT',
      specificity: 'GENERIC',
      difficulty: 'BROAD_GENERIC',
    });
  });
  PLATFORMS.forEach((platform, index) => {
    const amount = AMOUNTS[(index + 2) % AMOUNTS.length];
    add(
      rows,
      state,
      split,
      `platform:${platform}`,
      'PLATFORM_ONLY',
      `${platform}买日用品花了${amount}元`,
      platform,
      { kind: 'PLATFORM' },
    );
  });
}

function structuralDiversityRows(rows, state, split, pool) {
  const merchantTemplates = {
    train: [
      (merchant, amount) => [`这笔${amount}元是在${merchant}付的`, merchant],
      (merchant, amount) => [
        `账单收款单位为${merchant}，金额${amount}元`,
        merchant,
      ],
      (merchant, amount) => [
        `通过银行卡向${merchant}结账${amount}元`,
        merchant,
      ],
      (merchant, amount) => [
        `订单实际由${merchant}提供，实付${amount}元`,
        merchant,
      ],
      (merchant, amount) => [`在${merchant}交了服务费${amount}元`, merchant],
    ],
    validation: [
      (merchant, amount) => [`${amount}块钱最后付到了${merchant}`, merchant],
      (merchant, amount) => [
        `交易对方是${merchant}，扣款${amount}元`,
        merchant,
      ],
      (merchant, amount) => [
        `微信只是渠道，向${merchant}付款${amount}元`,
        merchant,
      ],
      (merchant, amount) => [
        `本单服务商来自${merchant}，已支付${amount}元`,
        merchant,
      ],
      (merchant, amount) => [`去${merchant}交费用${amount}元`, merchant],
    ],
    frozenTest: [
      (merchant, amount) => [
        `消费凭证写的门店是${merchant}，合计${amount}元`,
        merchant,
      ],
      (merchant, amount) => [
        `对方户名：${merchant}，已付${amount}元`,
        merchant,
      ],
      (merchant, amount) => [
        `花呗扣了${amount}元，实际收款方为${merchant}`,
        merchant,
      ],
      (merchant, amount) => [
        `这项服务由${merchant}提供，已支付${amount}元`,
        merchant,
      ],
      (merchant, amount) => [`在${merchant}交挂号费${amount}元`, merchant],
    ],
  };
  const noTransactionTemplates = {
    train: [
      merchant => `去${merchant}看看但没有消费`,
      merchant => `在${merchant}咨询价格，最后没买`,
      merchant => `${merchant}附近散步，没有付款`,
    ],
    validation: [
      merchant => `只是到${merchant}逛了一圈，没花钱`,
      merchant => `${merchant}今天开业，打算以后去看看`,
      merchant => `路过${merchant}门口，并未购买`,
    ],
    frozenTest: [
      merchant => `原计划去${merchant}，后来取消了`,
      merchant => `问了${merchant}的价格但没有下单`,
      merchant => `${merchant}在装修，今天没有营业`,
    ],
  };
  pool.merchants.forEach((merchant, index) => {
    const amount = AMOUNTS[(index * 5 + 3) % AMOUNTS.length];
    for (const template of merchantTemplates[split]) {
      const [text, counterparty] = template(merchant, amount);
      add(
        rows,
        state,
        split,
        `structure-positive:${split}:${merchant}`,
        'STRUCTURAL_POSITIVE',
        text,
        counterparty,
        { difficulty: 'HARD_STRUCTURAL_DIVERSITY' },
      );
    }
    for (const template of noTransactionTemplates[split]) {
      add(
        rows,
        state,
        split,
        `structure-no-event:${split}:${merchant}`,
        'STRUCTURAL_NO_TRANSACTION',
        template(merchant),
        undefined,
        { difficulty: 'HARD_NO_TRANSACTION' },
      );
    }
  });

  pool.people.forEach((person, index) => {
    const amount = AMOUNTS[(index + 6) % AMOUNTS.length];
    const item = ITEMS[(index + 2) % ITEMS.length];
    const positiveText =
      split === 'train'
        ? `${amount}元转到了${person}那里`
        : split === 'validation'
          ? `给${person}${amount}元`
          : `这笔${amount}元的对方户名是${person}`;
    add(
      rows,
      state,
      split,
      `structure-person-positive:${split}:${person}`,
      'STRUCTURAL_PERSON_PARTY',
      positiveText,
      person,
      { kind: 'PERSON', difficulty: 'HARD_STRUCTURAL_DIVERSITY' },
    );
    const beneficiaryText =
      split === 'train'
        ? `给${person}买${item}花了${amount}元`
        : split === 'validation'
          ? `替${person}订了电影票${amount}元`
          : `帮${person}交报名费${amount}元`;
    add(
      rows,
      state,
      split,
      `structure-person-beneficiary:${split}:${person}`,
      'STRUCTURAL_BENEFICIARY',
      beneficiaryText,
      undefined,
      { difficulty: 'HARD_BENEFICIARY' },
    );
  });

  pool.organizations.forEach((organization, index) => {
    const amount = (index + 4) * 1200;
    const text =
      split === 'train'
        ? `奖金由${organization}发放，共${amount}元`
        : split === 'validation'
          ? `${organization}向我结算了${amount}元`
          : `收到一笔${amount}元款项，付款方：${organization}`;
    add(
      rows,
      state,
      split,
      `structure-organization:${split}:${organization}`,
      'STRUCTURAL_ORGANIZATION_PARTY',
      text,
      organization,
      { kind: 'ORGANIZATION', difficulty: 'HARD_STRUCTURAL_DIVERSITY' },
    );
  });

  pool.cities.forEach((city, index) => {
    const destination = pool.cities[(index + 2) % pool.cities.length];
    if (destination === city) return;
    const amount = AMOUNTS[(index + 9) % AMOUNTS.length];
    const text =
      split === 'train'
        ? `在${city}站买去${destination}的火车票${amount}元`
        : split === 'validation'
          ? `${city}东站出的票，终点${destination}，花${amount}元`
          : `从${city}机场飞到${destination}，机票${amount}元`;
    add(
      rows,
      state,
      split,
      `structure-station:${split}:${city}:${destination}`,
      'STRUCTURAL_LOCATION_NOT_PARTY',
      text,
      undefined,
      { difficulty: 'HARD_ROUTE_LOCATION' },
    );
  });
}

function roleBoundaryRows(rows, state, split, pool) {
  const providerTemplates = {
    train: [
      (merchant, platform, amount) =>
        `此笔订单由${merchant}实际提供，${platform}扣款${amount}元`,
      (merchant, platform, amount) =>
        `经${platform}在${merchant}点单，合计${amount}元`,
    ],
    validation: [
      (merchant, platform, amount) =>
        `服务实际来自${merchant}，经${platform}支付${amount}元`,
      (merchant, platform, amount) =>
        `借助${platform}在${merchant}下单，实付${amount}元`,
    ],
    frozenTest: [
      (merchant, platform, amount) =>
        `本次消费由${merchant}实际提供，已经付款${amount}元`,
      (merchant, platform, amount) =>
        `使用${platform}在${merchant}点单，付了${amount}元`,
    ],
  };
  pool.merchants.forEach((merchant, index) => {
    const amount = AMOUNTS[(index + 7) % AMOUNTS.length];
    const platform = PLATFORMS[index % PLATFORMS.length];
    for (const template of providerTemplates[split]) {
      add(
        rows,
        state,
        split,
        `role-provider:${split}:${merchant}`,
        'ROLE_PROVIDER_BOUNDARY',
        template(merchant, platform, amount),
        merchant,
        { difficulty: 'HARD_ROLE_BOUNDARY' },
      );
    }

    add(
      rows,
      state,
      split,
      `role-brand-pass:${split}:${merchant}`,
      'ROLE_BRAND_PRODUCT_NEGATIVE',
      `购买${merchant}储值卡支付${amount}元`,
      undefined,
      { difficulty: 'HARD_BRAND_PRODUCT' },
    );
  });

  pool.people.forEach((person, index) => {
    const amount = AMOUNTS[(index + 3) % AMOUNTS.length];
    const outbound =
      split === 'train'
        ? `刚向${person}转了${amount}元`
        : split === 'validation'
          ? `把钱转给${person}了，金额${amount}元`
          : `已付给${person}${amount}元`;
    add(
      rows,
      state,
      split,
      `role-person-out:${split}:${person}`,
      'ROLE_PERSON_OUTBOUND',
      outbound,
      person,
      { kind: 'PERSON', difficulty: 'HARD_ROLE_BOUNDARY' },
    );
    const inbound =
      split === 'train'
        ? `${person}给我转来${amount}元`
        : split === 'validation'
          ? `${person}给我打款${amount}元`
          : `${person}给我汇来${amount}元`;
    add(
      rows,
      state,
      split,
      `role-person-in:${split}:${person}`,
      'ROLE_PERSON_INBOUND',
      inbound,
      person,
      { kind: 'PERSON', difficulty: 'HARD_ROLE_BOUNDARY' },
    );
    add(
      rows,
      state,
      split,
      `role-beneficiary-only:${split}:${person}`,
      'ROLE_BENEFICIARY_ONLY',
      `替${person}买体检项目付款${amount}元`,
      undefined,
      { difficulty: 'HARD_BENEFICIARY' },
    );
  });

  pool.organizations.forEach((organization, index) => {
    const amount = 4800 + index * 650;
    const income =
      split === 'train'
        ? `薪酬${amount}元由${organization}转入`
        : split === 'validation'
          ? `工资到账${amount}元，来自${organization}`
          : `奖金${amount}元由${organization}汇入`;
    add(
      rows,
      state,
      split,
      `role-organization-income:${split}:${organization}`,
      'ROLE_ORGANIZATION_INCOME',
      income,
      organization,
      { kind: 'ORGANIZATION', difficulty: 'HARD_ROLE_BOUNDARY' },
    );
    add(
      rows,
      state,
      split,
      `role-organization-product:${split}:${organization}`,
      'ROLE_ORGANIZATION_PRODUCT',
      `投入${organization}推出的基金${amount}元`,
      undefined,
      { difficulty: 'HARD_BRAND_PRODUCT' },
    );
  });

  pool.cities.forEach((origin, index) => {
    const destination = pool.cities[(index + 4) % pool.cities.length];
    if (destination === origin) return;
    const amount = AMOUNTS[(index + 5) % AMOUNTS.length];
    add(
      rows,
      state,
      split,
      `role-route-wording:${split}:${origin}:${destination}`,
      'ROLE_ROUTE_NOT_PARTY',
      `订${origin}开往${destination}的列车票，支付${amount}元`,
      undefined,
      { difficulty: 'HARD_ROUTE_LOCATION' },
    );
  });
}

function frozenChallengeRows(rows, state) {
  const split = 'frozenTest';
  const named = [
    ['收款方：暮云餐厅，金额88元', '暮云餐厅', 'MERCHANT'],
    ['付款通知，商户：青石药店，成功扣款46元', '青石药店', 'MERCHANT'],
    ['我用支付宝向禾木书店付款79元', '禾木书店', 'MERCHANT'],
    ['晚舟酒店退款358元已经到账', '晚舟酒店', 'MERCHANT'],
    [
      '收到星海制造有限公司打来的工资9000元',
      '星海制造有限公司',
      'ORGANIZATION',
    ],
    ['房租已经转给周叔1500元', '周叔', 'PERSON'],
    ['收到顾宁打款200元', '顾宁', 'PERSON'],
    ['通过携程在泊云酒店订房花了358元', '泊云酒店', 'MERCHANT'],
    ['替小赵在春山诊所交了挂号费25元', '春山诊所', 'MERCHANT'],
    ['到了宁波以后去三江面馆吃饭花了58元', '三江面馆', 'MERCHANT'],
    ['美团订单实际由落霞餐馆提供，支付108元', '落霞餐馆', 'MERCHANT'],
    ['微信只是付款方式，钱付给了清风花店32元', '清风花店', 'MERCHANT'],
    ['不是淘宝店，线下在见山书屋买书79元', '见山书屋', 'MERCHANT'],
    ['中国铁路退款270元到账', '中国铁路', 'ORGANIZATION'],
    ['公司报销款由远景建筑集团打来199元', '远景建筑集团', 'ORGANIZATION'],
    ['在铁路12306订了去桂林的动车票270元', '铁路12306', 'PLATFORM'],
  ];
  named.forEach(([text, counterparty, kind], index) =>
    add(
      rows,
      state,
      split,
      `challenge:positive:${index}`,
      'OUT_OF_TEMPLATE_POSITIVE',
      text,
      counterparty,
      { kind, difficulty: 'HARD_OUT_OF_TEMPLATE' },
    ),
  );

  const negatives = [
    '今天从桂林到南宁买动车票花了270元',
    '在上海虹桥站买了去杭州的高铁票79元',
    '支付宝账单显示动车票扣款270元',
    '给孩子买药花了46元',
    '和顾宁在昆明吃饭一共108元',
    '买了暮云餐厅的礼品卡88元',
    '青石药店股票今天涨了不少',
    '准备去禾木书店看看但没有消费',
    '公司楼下买咖啡花了25元',
    '房东让我去超市看看价格',
    '美团骑手通知餐已经送到',
    '收到退款270元但通知没有写商户',
    '武汉到上海的票是帮小赵买的，花270元',
    '用微信支付交了学费2000元',
    '从星巴克大道打车到瑞幸路花了32元',
    '新闻说晚舟酒店集团准备发行债券',
  ];
  negatives.forEach((text, index) =>
    add(
      rows,
      state,
      split,
      `challenge:negative:${index}`,
      'OUT_OF_TEMPLATE_NEGATIVE',
      text,
      undefined,
      { difficulty: 'HARD_OUT_OF_TEMPLATE' },
    ),
  );
}

function validate(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`Duplicate id: ${row.id}`);
    ids.add(row.id);
    if (row.counterparty !== null) {
      const { start, end, text } = row.counterparty;
      if (row.text.slice(start, end) !== text) {
        throw new Error(`Invalid span in ${row.id}`);
      }
    }
  }
}

function generate() {
  const rows = [];
  const state = { nextId: 1 };
  for (const [split, pool] of Object.entries(POOLS)) {
    const rounds = split === 'train' ? 5 : split === 'validation' ? 3 : 4;
    merchantRows(rows, state, split, pool, rounds);
    personRows(rows, state, split, pool, rounds);
    organizationRows(rows, state, split, pool, rounds);
    routeAndGenericRows(rows, state, split, pool, Math.max(2, rounds - 1));
    structuralDiversityRows(rows, state, split, pool);
    roleBoundaryRows(rows, state, split, pool);
  }
  frozenChallengeRows(rows, state);
  validate(rows);
  return rows;
}

function main(argv) {
  const args = parseArgs(argv);
  const root = process.cwd();
  const outputDir = path.resolve(
    root,
    args.output ?? 'data/synthetic/work/counterparty-v1',
  );
  const rows = generate();
  const files = {};
  for (const split of ['train', 'validation', 'frozenTest']) {
    const contents = jsonl(rows.filter(row => row.split === split));
    const file = `${split}.jsonl`;
    atomicWrite(path.join(outputDir, file), contents);
    files[split] = {
      file,
      rows: rows.filter(row => row.split === split).length,
      sha256: sha256(contents),
    };
  }
  const manifest = {
    schemaVersion: 1,
    datasetId: 'counterparty-synthetic-v1',
    syntheticOnly: true,
    generatedAt: new Date().toISOString(),
    definition:
      '原文中直接收取用户资金、向用户支付资金，或直接提供商品/服务的一方；只标连续原文跨度，不补全名称。',
    files,
    hardNegativeScenarios: [
      'HARD_ROUTE_LOCATION',
      'HARD_BRAND_PRODUCT',
      'HARD_CHANNEL',
      'HARD_BENEFICIARY',
      'HARD_COMPANION',
      'HARD_MULTI_ENTITY',
      'HARD_NEGATION',
      'HARD_NO_TRANSACTION',
    ],
  };
  atomicWrite(
    path.join(outputDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { generate };
