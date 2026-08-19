export type CounterpartyCandidateSource =
  | 'EXPLICIT_FIELD'
  | 'DIRECT_PARTY'
  | 'INCOME_PARTY'
  | 'SOURCE_OR_PROVIDER'
  | 'VENUE'
  | 'ARRIVAL_VENUE'
  | 'TRANSACTION_PLATFORM'
  | 'COMPANION_OR_BENEFICIARY'
  | 'PAYMENT_CHANNEL'
  | 'PRODUCT_OR_SERVICE'
  | 'IDENTITY_HINT'
  | 'LEADING_RECEIPT'
  | 'NAMED_SUFFIX';

export type CounterpartyCandidate = {
  text: string;
  start: number;
  end: number;
  source: CounterpartyCandidateSource;
};

const ENTITY_CHARS = String.raw`[\p{Script=Han}A-Za-z0-9·&（）()_-]`;
const CUE_SUFFIX = String.raw`(?=\s*(?:买|购买|购入|吃|喝|消费|支付|付款|收款|转了?|转账|退款|发工资|发薪|看电影|住|订|花了|花(?=\s*\d)|扣款|成功|\d|[¥￥]|元|块|[,，。；;]|$))`;
const DIRECT_SUFFIX = String.raw`(?=\s*(?:了(?=\s*(?:\d|[¥￥]|元|块|[,，。；;]|$))|共(?=\s*(?:\d|[¥￥]))|支付|付款|消费|收款|转了?|转账|退款|打款|结账|成功|\d|[¥￥]|元|块|[,，。；;]|$))`;

const SOURCE_PRIORITY: Record<CounterpartyCandidateSource, number> = {
  EXPLICIT_FIELD: 100,
  DIRECT_PARTY: 95,
  INCOME_PARTY: 95,
  TRANSACTION_PLATFORM: 90,
  SOURCE_OR_PROVIDER: 85,
  VENUE: 75,
  ARRIVAL_VENUE: 75,
  COMPANION_OR_BENEFICIARY: 50,
  PAYMENT_CHANNEL: 40,
  PRODUCT_OR_SERVICE: 35,
  LEADING_RECEIPT: 30,
  NAMED_SUFFIX: 25,
  IDENTITY_HINT: 80,
};

const NON_ENTITY_TERMS = new Set([
  '退款',
  '付款',
  '支付',
  '消费',
  '收款',
  '转账',
  '工资',
  '奖金',
  '扣款',
  '收到',
  '今天',
  '昨天',
  '昨晚',
  '今晚',
  '今早',
  '上午',
  '中午',
  '下午',
  '晚上',
  '刚才',
]);

const PLATFORMS = [
  '铁路12306',
  '12306',
  '淘宝',
  '天猫',
  '京东',
  '拼多多',
  '美团',
  '饿了么',
  '携程',
  '滴滴',
] as const;
const PAYMENT_CHANNELS = [
  '支付宝',
  '微信支付',
  '微信',
  '花呗',
  '银行卡',
  '信用卡',
  '现金',
] as const;
const PRODUCT_PATTERN =
  /动车票|高铁票|火车票|机票|车票|早餐|午餐|晚餐|教材|礼物|股票|基金|债券|保险产品|理财产品|代金券|优惠券|礼品卡|会员卡|储值卡/u;
const EXACT_PRODUCT_PATTERN = new RegExp(
  String.raw`^(?:${PRODUCT_PATTERN.source})$`,
  'u',
);
const FINANCIAL_OR_BRAND_PRODUCT =
  /股票|基金(?!会)|债券|保险产品|理财产品|代金券|优惠券|礼品卡|会员卡|储值卡|联名|周边|证券/u;
const GENERIC_PRODUCT_OR_ACTIVITY = new Set([
  '早餐',
  '早饭',
  '午饭',
  '午餐',
  '晚饭',
  '晚餐',
  '夜宵',
  '水果',
  '火锅',
  '烧烤',
  '烤肉',
  '麻辣烫',
  '打车',
  '地铁',
  '公交',
  '高铁',
  '火车',
  '机票',
  '酒店',
]);
const MERCHANT_SUFFIX =
  /(?:便利店|健身房|旅行社|照相馆|汽修厂|烘焙坊|洗车行|咖啡馆|有限公司|餐厅|餐馆|面馆|酒店|客栈|影城|花店|诊所|牙科|药房|书房|书屋|茶室|生鲜|中心|公司|集团|学校|医院|银行|航空|铁路|超市|商场|平台|店|馆|吧|城)$/u;

function normalizedIdentity(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN');
}

function matchesIdentityHint(
  candidate: CounterpartyCandidate,
  identityHints: ReadonlySet<string>,
): boolean {
  return identityHints.has(normalizedIdentity(candidate.text));
}
function addCandidate(
  target: CounterpartyCandidate[],
  seen: Map<string, number>,
  text: string,
  start: number,
  end: number,
  source: CounterpartyCandidateSource,
): void {
  while (/\s/u.test(text[start] ?? '')) start += 1;
  while (/\s/u.test(text[end - 1] ?? '')) end -= 1;
  const value = text.slice(start, end);
  if (
    value.length < 2 ||
    value.length > 24 ||
    NON_ENTITY_TERMS.has(value) ||
    /^(?:吃|喝)(?!茶室|饭店|餐厅|餐馆|面馆|咖啡)/u.test(value) ||
    /^(?:(?:信息|字段)?(?:为空|未显示|未知|无|空|缺失|未提供)|(?:信息|字段)(?:为空|未显示|未知|无|空|缺失|未提供))$/u.test(
      value,
    ) ||
    (/^\d+(?:\.\d+)?(?:元|块)?$/u.test(value) && value !== '12306') ||
    (source === 'INCOME_PARTY' &&
      /\d|收到|退款|工资|奖金|报销|款项|由/u.test(value))
  ) {
    return;
  }
  const key = `${start}:${end}`;
  const existing = seen.get(key);
  if (existing !== undefined) {
    if (SOURCE_PRIORITY[source] > SOURCE_PRIORITY[target[existing].source]) {
      target[existing].source = source;
    }
    return;
  }
  seen.set(key, target.length);
  target.push({ text: value, start, end, source });
}

function addMatches(
  target: CounterpartyCandidate[],
  seen: Map<string, number>,
  text: string,
  pattern: RegExp,
  source: CounterpartyCandidateSource,
): void {
  for (const match of text.matchAll(pattern)) {
    const value = match[1];
    if (value === undefined || match.index === undefined) continue;
    const relative = match[0].indexOf(value);
    addCandidate(
      target,
      seen,
      text,
      match.index + relative,
      match.index + relative + value.length,
      source,
    );
  }
}

function addLiteral(
  target: CounterpartyCandidate[],
  seen: Map<string, number>,
  text: string,
  value: string,
  source: CounterpartyCandidateSource,
): void {
  let start = text.indexOf(value);
  while (start >= 0) {
    addCandidate(target, seen, text, start, start + value.length, source);
    start = text.indexOf(value, start + value.length);
  }
}

export function generateCounterpartyCandidates(
  text: string,
  identityHints: readonly string[] = [],
): CounterpartyCandidate[] {
  const target: CounterpartyCandidate[] = [];
  const seen = new Map<string, number>();
  const patterns: Array<[RegExp, CounterpartyCandidateSource]> = [
    [
      new RegExp(
        String.raw`(?:商户|商家名称|商家|服务商|供应商|收款方|付款方|付款单位|交易对象|收款单位|收款账户名|交易对方|对方名称|对方户名|店铺|门店)\s*(?:(?:是|为|来自)\s*)?[:：]?\s*(${ENTITY_CHARS}{2,24}?)${CUE_SUFFIX}`,
        'gu',
      ),
      'EXPLICIT_FIELD',
    ],
    [
      new RegExp(
        String.raw`(?:支付给|付款给|付给|交给|汇给|转给|打给|打款给|(?:(?:^|[,，。；;\s]|我\s*)|(?:用|通过)\s*(?:支付宝|微信支付|微信|花呗|银行卡|信用卡)\s*)向(?!我(?:支付|付款|结算|转账|打款)))\s*了?\s*(${ENTITY_CHARS}{2,20}?)${DIRECT_SUFFIX}`,
        'gu',
      ),
      'DIRECT_PARTY',
    ],
    [
      new RegExp(
        String.raw`(?:收到|收了|来自)\s*(${ENTITY_CHARS}{2,20}?)(?=\s*(?:转账|打款|打来(?:的)?|汇来(?:的)?|转来(?:的)?|付款|退款|发的|发来|工资|奖金|[,，。；;]|\d|元|块|$))`,
        'gu',
      ),
      'INCOME_PARTY',
    ],
    [
      new RegExp(
        String.raw`^(${ENTITY_CHARS}{2,20}?)(?=\s*(?:(?:给我)?(?:打过来|打来|打款|转来|汇来|转入|汇入|退了|退款|收了)|向我(?:支付|付款|结算|转账|打款)))`,
        'gu',
      ),
      'INCOME_PARTY',
    ],
    [
      new RegExp(
        String.raw`(?:实际由|由|来自)\s*(${ENTITY_CHARS}{2,20}?)(?=\s*(?:实际\s*)?(?:提供|打来|支付|付款|退款|发放|结算|汇入|转入|到账|[,，。；;]|$))`,
        'gu',
      ),
      'SOURCE_OR_PROVIDER',
    ],
    [
      new RegExp(
        String.raw`(?:去|到)\s*(?:吃|喝)\s*(${ENTITY_CHARS}{2,20}?)${CUE_SUFFIX}`,
        'gu',
      ),
      'VENUE',
    ],
    [
      new RegExp(
        String.raw`(?:在|去)\s*了?\s*(${ENTITY_CHARS}{2,20}?)(?=\s*(?:买|购买|购入|吃|喝|消费|支付|付款|结账|交|看电影|看病|看看|逛|咨询|住|下单|点单|订|花了|花(?=\s*\d)|[,，。；;]|$))`,
        'gu',
      ),
      'VENUE',
    ],
    [
      new RegExp(
        String.raw`(?:在|去)\s*了?\s*(${ENTITY_CHARS}{2,20}?)(?=\s*(?:通过|用)\s*${ENTITY_CHARS}{2,12}\s*(?:消费|支付|付款|结账))`,
        'gu',
      ),
      'VENUE',
    ],
    [
      new RegExp(
        String.raw`到\s*(${ENTITY_CHARS}{2,20}?)(?=\s*(?:买|购买|购入|吃|喝|消费|支付|付款|看电影|看病|住|订|花了|花(?=\s*\d)|[,，。；;]|$))`,
        'gu',
      ),
      'ARRIVAL_VENUE',
    ],
    [
      new RegExp(
        String.raw`(?:给|帮|替|和|跟|与)\s*(${ENTITY_CHARS}{2,8}?)(?=\s*(?:买|购买|交|一起|去|在|吃|喝|看|[,，。；;]|$))`,
        'gu',
      ),
      'COMPANION_OR_BENEFICIARY',
    ],
    [
      new RegExp(
        String.raw`(?:^|[,，。；;]\s*)(${ENTITY_CHARS}{2,20}?)(?=\s*(?:消费|支付|付款|收款|退款|扣款|实付|花了|花(?=\s*\d)|\d+(?:\.\d+)?(?:元|块)))`,
        'gu',
      ),
      'LEADING_RECEIPT',
    ],
    [
      new RegExp(
        String.raw`(?:^(?![在去到给向从买了的于])|[在去到给向从买了的于，。；;：:\s])(${ENTITY_CHARS}{2,20}?(?:店|馆|吧|城|中心|公司|集团|学校|医院|银行|航空|铁路|超市|商场|便利店|平台|餐厅|餐馆|面馆|咖啡|酒店|客栈|影城|花店|诊所|牙科|药房|书房|书屋|健身房|旅行社|照相馆|汽修厂|烘焙坊|洗车行|茶室|生鲜))(?=\s*(?:隔壁|旁边|附近|门口|对面|楼上|楼下|买|购买|购入|吃|喝|消费|支付|付款|结账|花了|花(?=\s*\d)|\d|[,，。；;]|$))`,
        'gu',
      ),
      'NAMED_SUFFIX',
    ],
  ];
  for (const [pattern, source] of patterns) {
    addMatches(target, seen, text, pattern, source);
  }
  for (const platform of PLATFORMS) {
    addLiteral(target, seen, text, platform, 'TRANSACTION_PLATFORM');
  }
  for (const channel of PAYMENT_CHANNELS) {
    addLiteral(target, seen, text, channel, 'PAYMENT_CHANNEL');
  }
  for (const match of text.matchAll(new RegExp(PRODUCT_PATTERN.source, 'gu'))) {
    if (match.index !== undefined) {
      addCandidate(
        target,
        seen,
        text,
        match.index,
        match.index + match[0].length,
        'PRODUCT_OR_SERVICE',
      );
    }
  }
  for (const identityHint of identityHints) {
    const value = identityHint.trim();
    if (value.length > 0) {
      addLiteral(target, seen, text, value, 'IDENTITY_HINT');
    }
  }
  return target.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start) ||
      left.source.localeCompare(right.source),
  );
}

export function hasCounterpartyTransactionEvidence(text: string): boolean {
  const amount =
    /\d+(?:\.\d+)?\s*(?:元|块)/u.test(text) ||
    /(?:花了?|支付|付款|消费|收款|转账|退款|工资|奖金|扣款|实付)\D{0,10}\d+(?:\.\d+)?/u.test(
      text,
    );
  const event =
    /支付|已付|付了|付款|付款方|付给|交给|汇给|消费|收款|收了|收款方|收到|转账|转了|转给|转来|转入|汇来|汇入|打款|打给|打来|打过来|退款|退了|报销|已扣|扣款|扣了|实付|花了|花\s*\d|工资|薪资|薪酬|奖金|买|购买|购入|订房|订了|交.{0,6}费|结账|结算|到账|商户|商家|门店|交易对方|对方户名/u.test(
      text,
    ) ||
    /^[\p{Script=Han}A-Za-z0-9·&（）()_-]{2,24}\s*\d+(?:\.\d+)?\s*(?:元|块)/u.test(
      text,
    );
  const cancelled =
    /(?:原计划|计划|打算|准备|并未|没有|没花钱|取消).*(?:看看|咨询|购买|消费|付款|支付|下单|去)|只是(?:看看|咨询)|(?:没有|并未|没)(?:有)?(?:消费|付款|购买|花钱|下单)/u.test(
      text,
    );
  const laterCompleted =
    /(?:最后|实际|后来|但是)(?![^，。；;]{0,8}(?:没有|没|未|取消))[^，。；;]{0,16}(?:支付|付款|消费|购买|下单|花了|结账)/u.test(
      text,
    );
  return amount && event && !(cancelled && !laterCompleted);
}

function isRouteLocationCandidate(
  text: string,
  candidate: CounterpartyCandidate,
): boolean {
  const routePattern = new RegExp(
    String.raw`从\s*(${ENTITY_CHARS}{2,12}?)\s*到\s*(${ENTITY_CHARS}{2,12}?)(?=\s*(?:买的?|坐|乘|搭|动车|高铁|火车|飞机|出差|旅行|旅游|花了?|消费|支付|付款|实付|结账|扣款|车费|票价|\d|[¥￥]|元|块|[,，。；;]|$))`,
    'gu',
  );
  for (const match of text.matchAll(routePattern)) {
    if (match.index === undefined) continue;
    const origin = match[1];
    const destination = match[2];
    if (origin === undefined || destination === undefined) continue;
    const originRelative = match[0].indexOf(origin);
    const destinationRelative = match[0].indexOf(
      destination,
      originRelative + origin.length,
    );
    for (const [value, relative] of [
      [origin, originRelative],
      [destination, destinationRelative],
    ] as const) {
      if (relative < 0) continue;
      const start = match.index + relative;
      if (candidate.start === start && candidate.end === start + value.length) {
        return true;
      }
    }
  }
  return false;
}

function hardRejected(text: string, candidate: CounterpartyCandidate): boolean {
  const hasStrongTransactionRole = [
    'EXPLICIT_FIELD',
    'DIRECT_PARTY',
    'INCOME_PARTY',
  ].includes(candidate.source);
  if (candidate.source === 'IDENTITY_HINT') {
    const preceding = text.slice(0, candidate.start);
    const following = text.slice(candidate.end);
    const validPrecedingBoundary =
      candidate.start === 0 ||
      /(?:[，。；;：:\s]|在|去|到|吃|喝|给|向|由)$/u.test(preceding);
    const validFollowingBoundary =
      !/^[\p{Script=Han}A-Za-z·&]/u.test(following) ||
      /^(?:花了?|消费|支付|付款|收款|退款|扣款|实付|结账|吃饭|吃了?|用餐|就餐|\d|元|块|[,，。；;]|$)/u.test(
        following,
      );
    if (!validPrecedingBoundary || !validFollowingBoundary) {
      return true;
    }
  }
  if (isRouteLocationCandidate(text, candidate)) {
    return true;
  }
  if (
    !hasStrongTransactionRole &&
    (PAYMENT_CHANNELS.some(channel => channel === candidate.text) ||
      EXACT_PRODUCT_PATTERN.test(candidate.text))
  ) {
    return true;
  }
  if (
    GENERIC_PRODUCT_OR_ACTIVITY.has(candidate.text) &&
    !hasStrongTransactionRole
  ) {
    return true;
  }
  if (
    /(?:隔壁|旁边|附近|门口|对面|楼上|楼下)/u.test(candidate.text) &&
    !hasStrongTransactionRole
  ) {
    return true;
  }
  if (
    candidate.source === 'PAYMENT_CHANNEL' ||
    candidate.source === 'PRODUCT_OR_SERVICE' ||
    candidate.source === 'COMPANION_OR_BENEFICIARY'
  ) {
    return true;
  }
  if (
    FINANCIAL_OR_BRAND_PRODUCT.test(text) &&
    ![
      'EXPLICIT_FIELD',
      'DIRECT_PARTY',
      'INCOME_PARTY',
      'TRANSACTION_PLATFORM',
    ].includes(candidate.source)
  ) {
    return true;
  }
  const following = text.slice(candidate.end);
  if (
    /^(?:隔壁|旁边|附近|门口|对面|楼上|楼下)/u.test(following) &&
    /买|购买|消费|吃|喝|购物/u.test(following) &&
    !hasStrongTransactionRole
  ) {
    return true;
  }
  if (
    candidate.source === 'ARRIVAL_VENUE' &&
    /动车|高铁|火车|飞机|列车|车票|机票|航班|行程|起飞/u.test(text)
  ) {
    return true;
  }
  if (
    (candidate.source === 'LEADING_RECEIPT' ||
      candidate.source === 'NAMED_SUFFIX') &&
    /从.+到.+|(?:坐|乘|搭)(?:动车|高铁|火车|飞机|列车)|动车票|高铁票|火车票|车票|机票|航班|行程|起飞/u.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

export function resolveCounterpartyFromRules(
  text: string,
  identityHints: readonly string[] = [],
): CounterpartyCandidate | undefined {
  if (!hasCounterpartyTransactionEvidence(text)) return undefined;
  const normalizedHints = new Set(
    identityHints
      .map(normalizedIdentity)
      .filter(identity => identity.length > 0),
  );
  const candidates = generateCounterpartyCandidates(text, identityHints).filter(
    candidate => !hardRejected(text, candidate),
  );
  const deterministic = candidates.filter(
    candidate =>
      [
        'EXPLICIT_FIELD',
        'DIRECT_PARTY',
        'INCOME_PARTY',
        'SOURCE_OR_PROVIDER',
        'VENUE',
        'ARRIVAL_VENUE',
        'TRANSACTION_PLATFORM',
        'IDENTITY_HINT',
      ].includes(candidate.source) ||
      ((candidate.source === 'LEADING_RECEIPT' ||
        candidate.source === 'NAMED_SUFFIX') &&
        (MERCHANT_SUFFIX.test(candidate.text) ||
          matchesIdentityHint(candidate, normalizedHints))),
  );
  const providerSources: readonly CounterpartyCandidateSource[] = [
    'EXPLICIT_FIELD',
    'DIRECT_PARTY',
    'INCOME_PARTY',
    'SOURCE_OR_PROVIDER',
    'VENUE',
    'ARRIVAL_VENUE',
  ];
  const withoutShadowedPlatforms = deterministic.filter(candidate => {
    if (candidate.source !== 'TRANSACTION_PLATFORM') return true;
    return !deterministic.some(
      other =>
        other !== candidate &&
        providerSources.includes(other.source) &&
        normalizedIdentity(other.text) !== normalizedIdentity(candidate.text) &&
        (other.end <= candidate.start || other.start >= candidate.end),
    );
  });
  return withoutShadowedPlatforms.sort(
    (left, right) =>
      SOURCE_PRIORITY[right.source] - SOURCE_PRIORITY[left.source] ||
      (right.source === 'TRANSACTION_PLATFORM'
        ? right.text.length - left.text.length
        : left.text.length - right.text.length) ||
      left.start - right.start,
  )[0];
}

export function modelEligibleCounterpartyCandidates(
  text: string,
): CounterpartyCandidate[] {
  if (!hasCounterpartyTransactionEvidence(text)) return [];
  return generateCounterpartyCandidates(text).filter(
    candidate => !hardRejected(text, candidate),
  );
}

export function markedCounterpartyCandidateText(
  text: string,
  candidate: CounterpartyCandidate,
): string {
  const lengthBucket =
    candidate.text.length <= 3
      ? '短'
      : candidate.text.length <= 8
        ? '中'
        : '长';
  const negated =
    /没有(?:消费|付款|购买|花钱)|没(?:有)?(?:消费|付款|购买|花钱)|取消(?:支付|付款|订单)|只是(?:看看|咨询)|但没有/u.test(
      text,
    );
  const route =
    /从.+到.+(?:动车|高铁|火车|飞机|车票|机票)|(?:动车|高铁|火车|飞机)票/u.test(
      text,
    );
  const location =
    /站$/u.test(candidate.text) ||
    /^(?:楼下|附近|旁边|门口|大道|路|街|站)/u.test(text.slice(candidate.end));
  return `${text.slice(0, candidate.start)} 候选开始 ${candidate.text} 候选结束 ${text.slice(candidate.end)} 候选文本 ${candidate.text} 候选来源 ${candidate.source} 候选长度 ${lengthBucket} 交易线索 有 否定交易 ${negated ? '有' : '无'} 行程语境 ${route ? '有' : '无'} 地点修饰 ${location ? '有' : '无'}`
    .replace(/\s+/gu, ' ')
    .trim();
}
