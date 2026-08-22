const ENTITY_CHARS = String.raw`[\p{Script=Han}A-Za-z0-9·&（）()_-]`;

const CHANNELS = [
  '微信支付',
  '支付宝',
  '微信',
  '花呗',
  '银行卡',
  '信用卡',
  '现金',
];

const PLATFORMS = [
  '淘宝',
  '天猫',
  '京东',
  '拼多多',
  '美团',
  '饿了么',
  '携程',
  '铁路12306',
  '12306',
  '滴滴',
];

const PRODUCTS_AND_SERVICES = [
  '动车票',
  '高铁票',
  '火车票',
  '机票',
  '电影票',
  '演唱会票',
  '咖啡',
  '牛奶',
  '早餐',
  '午饭',
  '晚饭',
  '药品',
  '感冒药',
  '股票',
  '基金',
  '代金券',
  '礼品卡',
  '联名杯',
  '会员卡',
  '储值卡',
  '保险产品',
  '理财产品',
  '房租',
];

const GENERIC_COUNTERPARTIES = [
  '商场',
  '超市',
  '便利店',
  '公司',
  '学校',
  '医院',
  '房东',
];

const CUE_SUFFIX = String.raw`(?=\s*(?:买|购买|购入|吃|喝|消费|支付|付款|收款|转了?|转账|退款|发工资|发薪|看电影|住|订|花了|花(?=\s*\d)|扣款|成功|\d|[¥￥]|元|块|[,，。；;]|$))`;
const DIRECT_PARTY_SUFFIX = String.raw`(?=\s*(?:了(?=\s*(?:\d|[¥￥]|元|块|[,，。；;]|$))|共(?=\s*(?:\d|[¥￥]))|支付|付款|消费|收款|转了?|转账|退款|打款|结账|成功|\d|[¥￥]|元|块|[,，。；;]|$))`;

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

const SOURCE_PRIORITY = {
  EXPLICIT_FIELD: 100,
  DIRECT_PARTY: 95,
  INCOME_PARTY: 95,
  TRANSACTION_PLATFORM: 90,
  SOURCE_OR_PROVIDER: 85,
  VENUE: 75,
  ARRIVAL_VENUE: 75,
  PURCHASED_NAMED_OBJECT: 70,
  GENERIC_COUNTERPARTY: 65,
  ROUTE_ORIGIN: 55,
  ROUTE_DESTINATION: 55,
  COMPANION_OR_BENEFICIARY: 50,
  PAYMENT_CHANNEL: 40,
  PRODUCT_OR_SERVICE: 35,
  LEADING_RECEIPT: 30,
  NAMED_SUFFIX: 25,
  ENTITY_SUFFIX_BOUNDARY: 20,
  ENTITY_SUFFIX_SPAN: 10,
};

function addCandidate(target, seen, text, start, end, source) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start
  ) {
    return;
  }
  let normalizedStart = start;
  let normalizedEnd = end;
  while (/\s/u.test(text[normalizedStart] ?? '')) normalizedStart += 1;
  while (/\s/u.test(text[normalizedEnd - 1] ?? '')) normalizedEnd -= 1;
  const value = text.slice(normalizedStart, normalizedEnd);
  if (
    value.length < 2 ||
    value.length > 24 ||
    (/^\d+(?:\.\d+)?(?:元|块)?$/u.test(value) && value !== '12306') ||
    NON_ENTITY_TERMS.has(value) ||
    /^(?:(?:信息|字段)?(?:为空|未显示|未知|无|空|缺失|未提供)|(?:信息|字段)(?:为空|未显示|未知|无|空|缺失|未提供))$/u.test(
      value,
    ) ||
    (source === 'INCOME_PARTY' &&
      /\d|收到|退款|工资|奖金|报销|款项|由/u.test(value)) ||
    !new RegExp(ENTITY_CHARS, 'u').test(value)
  ) {
    return;
  }
  const key = `${normalizedStart}:${normalizedEnd}`;
  const existingIndex = seen.get(key);
  if (existingIndex !== undefined) {
    const existing = target[existingIndex];
    if (
      (SOURCE_PRIORITY[source] ?? 0) > (SOURCE_PRIORITY[existing.source] ?? 0)
    ) {
      existing.source = source;
    }
    return;
  }
  seen.set(key, target.length);
  target.push({
    text: value,
    start: normalizedStart,
    end: normalizedEnd,
    source,
  });
}

function addCapturedMatches(target, seen, text, pattern, source) {
  for (const match of text.matchAll(pattern)) {
    const captured = match[1];
    if (captured === undefined || match.index === undefined) continue;
    const offset = match[0].indexOf(captured);
    addCandidate(
      target,
      seen,
      text,
      match.index + offset,
      match.index + offset + captured.length,
      source,
    );
  }
}

function addLexiconMatches(target, seen, text, values, source) {
  for (const value of values) {
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(value, from);
      if (index < 0) break;
      addCandidate(target, seen, text, index, index + value.length, source);
      from = index + Math.max(1, value.length);
    }
  }
}

function addSuffixSpanCandidates(target, seen, text) {
  const suffixPattern =
    /(?:便利店|健身房|旅行社|照相馆|咖啡馆|有限公司|诊所|药房|书店|书屋|书房|餐厅|餐馆|面馆|咖啡|酒店|影城|花店|中心|公司|集团|学校|医院|银行|航空|铁路|超市|商场|平台|店|馆|吧|城|站)/gu;
  const boundaries = [
    '购买',
    '购入',
    '收到',
    '来自',
    '在',
    '去',
    '到',
    '给',
    '向',
    '从',
    '买',
    '了',
    '的',
    '于',
    '上',
    '，',
    '。',
    '；',
    ';',
    '：',
    ':',
    ' ',
  ];
  for (const match of text.matchAll(suffixPattern)) {
    if (match.index === undefined) continue;
    const end = match.index + match[0].length;
    const searchStart = Math.max(0, end - 24);
    const prefix = text.slice(searchStart, end);
    let boundaryEnd = -1;
    for (const boundary of boundaries) {
      const index = prefix.lastIndexOf(boundary);
      if (index >= 0)
        boundaryEnd = Math.max(boundaryEnd, index + boundary.length);
    }
    if (boundaryEnd >= 0 && searchStart + boundaryEnd < end) {
      addCandidate(
        target,
        seen,
        text,
        searchStart + boundaryEnd,
        end,
        'ENTITY_SUFFIX_BOUNDARY',
      );
    }
    const maximum = Math.min(8, end);
    for (let length = 2; length <= maximum; length += 1) {
      const start = end - length;
      const value = text.slice(start, end);
      if (new RegExp(`^${ENTITY_CHARS}+$`, 'u').test(value)) {
        addCandidate(target, seen, text, start, end, 'ENTITY_SUFFIX_SPAN');
      }
    }
  }
}

function generateCounterpartyCandidates(text) {
  const candidates = [];
  const seen = new Map();
  const explicitField = new RegExp(
    String.raw`(?:商户|商家名称|商家|服务商|供应商|收款方|付款方|付款单位|交易对象|收款单位|收款账户名|交易对方|对方名称|对方户名|店铺|门店)\s*(?:(?:是|为|来自)\s*)?[:：]?\s*(${ENTITY_CHARS}{2,24}?)${CUE_SUFFIX}`,
    'gu',
  );
  const directParty = new RegExp(
    String.raw`(?:支付给|付款给|付给|交给|汇给|转给|打给|打款给|(?:(?:^|[,，。；;\s]|我\s*)|(?:用|通过)\s*(?:支付宝|微信支付|微信|花呗|银行卡|信用卡)\s*)向(?!我(?:支付|付款|结算|转账|打款)))\s*了?\s*(${ENTITY_CHARS}{2,20}?)${DIRECT_PARTY_SUFFIX}`,
    'gu',
  );
  const simpleGiveParty = new RegExp(
    String.raw`(?<!付)(?<!款)(?<!转)(?<!打)给\s*(${ENTITY_CHARS}{2,20}?)(?=\s*(?:转了?|转账|付款|支付))`,
    'gu',
  );
  const giveThenPayParty = new RegExp(
    String.raw`(?<!付)(?<!款)(?<!转)(?<!打)给\s*(${ENTITY_CHARS}{2,20}?)(?=\s*付了)`,
    'gu',
  );
  const simpleGiveAmountParty = new RegExp(
    String.raw`(?<!付)(?<!款)(?<!转)(?<!打)给\s*((?:(?!转|付|支|买|花)[\p{Script=Han}]){2,4}?)(?=\s*\d+(?:\.\d+)?(?:元|块))`,
    'gu',
  );
  const incomeParty = new RegExp(
    String.raw`(?:收到|收了|来自)\s*(${ENTITY_CHARS}{2,20}?)(?=\s*(?:转账|打款|打来(?:的)?|汇来(?:的)?|转来(?:的)?|付款|退款|发的|发来|工资|奖金|[,，。；;]|\d|元|块|$))`,
    'gu',
  );
  const leadingIncomeParty = new RegExp(
    String.raw`^(${ENTITY_CHARS}{2,20}?)(?=\s*(?:(?:给我)?(?:打过来|打来|打款|转来|汇来|转入|汇入|退了|退款|收了)|向我(?:支付|付款|结算|转账|打款)))`,
    'gu',
  );
  const sourceOrProvider = new RegExp(
    String.raw`(?:实际由|由|来自)\s*(${ENTITY_CHARS}{2,20}?)(?=\s*(?:实际\s*)?(?:提供|打来|支付|付款|退款|发放|结算|汇入|转入|到账|[,，。；;]|$))`,
    'gu',
  );
  const transferDestination = new RegExp(
    String.raw`(?:转到|转入)\s*了?\s*(${ENTITY_CHARS}{2,12}?)(?=\s*(?:那里|账户|卡里|[,，。；;]|$))`,
    'gu',
  );
  const venue = new RegExp(
    String.raw`(?:在|去)\s*了?\s*(${ENTITY_CHARS}{2,20}?)(?=\s*(?:买|购买|购入|吃|喝|消费|支付|付款|结账|交|看电影|看病|看看|逛|咨询|住|下单|点单|订|花了|花(?=\s*\d)|[,，。；;]|$))`,
    'gu',
  );
  const arrivalVenue = new RegExp(
    String.raw`到\s*(${ENTITY_CHARS}{2,20}?)(?=\s*(?:买|购买|购入|吃|喝|消费|支付|付款|看电影|看病|住|订|花了|花(?=\s*\d)|[,，。；;]|$))`,
    'gu',
  );
  const purchasedNamedObject = new RegExp(
    String.raw`(?:买|购买|购入|订(?!单))\s*了?\s*(${ENTITY_CHARS}{2,20}?)(?=\s*(?:的|提供|销售|花了|花(?=\s*\d)|支付|付款|\d+(?:\.\d+)?(?:元|块)|[,，。；;]|$))`,
    'gu',
  );
  const routeOrigin = new RegExp(
    String.raw`从\s*(${ENTITY_CHARS}{2,12}?)(?=\s*到)`,
    'gu',
  );
  const routeDestination = new RegExp(
    String.raw`到\s*(${ENTITY_CHARS}{2,12}?)(?=\s*(?:买的?|坐|乘|搭|动车|高铁|火车|飞机|出差|旅行|旅游|[,，。；;]|$))`,
    'gu',
  );
  const companionOrBeneficiary = new RegExp(
    String.raw`(?:给|帮|替|和|跟|与)\s*(${ENTITY_CHARS}{2,8}?)(?=\s*(?:买|购买|交|一起|去|在|吃|喝|看|[,，。；;]|$))`,
    'gu',
  );
  const leadingReceipt = new RegExp(
    String.raw`(?:^|[,，。；;]\s*)(${ENTITY_CHARS}{2,20}?)(?=\s*(?:消费|支付|付款|收款|退款|扣款|实付|花了|花(?=\s*\d)|\d+(?:\.\d+)?(?:元|块)))`,
    'gu',
  );
  const namedSuffix = new RegExp(
    String.raw`(?:^|[在去到给向从买了的于，。；;：:\s])(${ENTITY_CHARS}{2,20}?(?:店|馆|吧|城|中心|公司|集团|学校|医院|银行|航空|铁路|超市|商场|便利店|平台))`,
    'gu',
  );

  addCapturedMatches(candidates, seen, text, explicitField, 'EXPLICIT_FIELD');
  addCapturedMatches(candidates, seen, text, directParty, 'DIRECT_PARTY');
  addCapturedMatches(candidates, seen, text, simpleGiveParty, 'DIRECT_PARTY');
  addCapturedMatches(candidates, seen, text, giveThenPayParty, 'DIRECT_PARTY');
  addCapturedMatches(
    candidates,
    seen,
    text,
    simpleGiveAmountParty,
    'DIRECT_PARTY',
  );
  addCapturedMatches(candidates, seen, text, incomeParty, 'INCOME_PARTY');
  addCapturedMatches(
    candidates,
    seen,
    text,
    leadingIncomeParty,
    'INCOME_PARTY',
  );
  addCapturedMatches(
    candidates,
    seen,
    text,
    sourceOrProvider,
    'SOURCE_OR_PROVIDER',
  );
  addCapturedMatches(
    candidates,
    seen,
    text,
    transferDestination,
    'DIRECT_PARTY',
  );
  addCapturedMatches(candidates, seen, text, venue, 'VENUE');
  addCapturedMatches(candidates, seen, text, arrivalVenue, 'ARRIVAL_VENUE');
  addCapturedMatches(
    candidates,
    seen,
    text,
    purchasedNamedObject,
    'PURCHASED_NAMED_OBJECT',
  );
  addCapturedMatches(candidates, seen, text, routeOrigin, 'ROUTE_ORIGIN');
  addCapturedMatches(
    candidates,
    seen,
    text,
    routeDestination,
    'ROUTE_DESTINATION',
  );
  addCapturedMatches(
    candidates,
    seen,
    text,
    companionOrBeneficiary,
    'COMPANION_OR_BENEFICIARY',
  );
  addCapturedMatches(candidates, seen, text, leadingReceipt, 'LEADING_RECEIPT');
  addCapturedMatches(candidates, seen, text, namedSuffix, 'NAMED_SUFFIX');
  addSuffixSpanCandidates(candidates, seen, text);
  addLexiconMatches(candidates, seen, text, CHANNELS, 'PAYMENT_CHANNEL');
  addLexiconMatches(candidates, seen, text, PLATFORMS, 'TRANSACTION_PLATFORM');
  addLexiconMatches(
    candidates,
    seen,
    text,
    PRODUCTS_AND_SERVICES,
    'PRODUCT_OR_SERVICE',
  );
  addLexiconMatches(
    candidates,
    seen,
    text,
    GENERIC_COUNTERPARTIES,
    'GENERIC_COUNTERPARTY',
  );

  return candidates.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start) ||
      left.source.localeCompare(right.source),
  );
}

function hasTransactionEvidence(text) {
  const amount =
    /\d+(?:\.\d+)?\s*(?:元|块)/u.test(text) ||
    /(?:花了?|支付|付款|消费|收款|转账|退款|工资|奖金|扣款|实付)\D{0,10}\d+(?:\.\d+)?/u.test(
      text,
    );
  const event =
    /支付|已付|付了|付款|付款方|付给|交给|汇给|消费|收款|收了|收款方|收到|转账|转了|转给|转来|转入|汇来|汇入|打款|打给|打来|打过来|退款|退了|报销|已扣|扣款|扣了|实付|花了|花\s*\d|工资|薪资|薪酬|奖金|买|购买|购入|订房|订了|交.{0,6}费|结账|结算|到账|商户|商家|门店|交易对方|对方户名/u.test(
      text,
    );
  const cancellationCue =
    /(?:原计划|计划|打算|准备|并未|没有|没花钱|取消).*(?:看看|咨询|购买|消费|付款|支付|下单|去)|只是(?:看看|咨询)|(?:没有|并未|没)(?:有)?(?:消费|付款|购买|花钱|下单)/u.test(
      text,
    );
  const completedAfterCancellation =
    /(?:最后|实际|后来|但是)(?![^，。；;]{0,8}(?:没有|没|未|取消))[^，。；;]{0,16}(?:支付|付款|消费|购买|下单|花了|结账)/u.test(
      text,
    );
  const cancelledWithoutCompletedEvent =
    cancellationCue && !completedAfterCancellation;
  return amount && event && !cancelledWithoutCompletedEvent;
}

function markedCandidateText(text, candidate) {
  const lengthBucket =
    candidate.text.length <= 3
      ? '短'
      : candidate.text.length <= 8
        ? '中'
        : '长';
  const hasTransactionCue = hasTransactionEvidence(text);
  const hasNegatedEvent =
    /没有(?:消费|付款|购买|花钱)|没(?:有)?(?:消费|付款|购买|花钱)|取消(?:支付|付款|订单)|只是(?:看看|咨询)|但没有/u.test(
      text,
    );
  const routeContext =
    /从.+到.+(?:动车|高铁|火车|飞机|车票|机票)|(?:动车|高铁|火车|飞机)票/u.test(
      text,
    );
  const locationModifier =
    /站$/u.test(candidate.text) ||
    /^(?:楼下|附近|旁边|门口|大道|路|街|站)/u.test(text.slice(candidate.end));
  return `${text.slice(0, candidate.start)} 候选开始 ${candidate.text} 候选结束 ${text.slice(candidate.end)} 候选文本 ${candidate.text} 候选来源 ${candidate.source} 候选长度 ${lengthBucket} 交易线索 ${hasTransactionCue ? '有' : '无'} 否定交易 ${hasNegatedEvent ? '有' : '无'} 行程语境 ${routeContext ? '有' : '无'} 地点修饰 ${locationModifier ? '有' : '无'}`
    .replace(/\s+/gu, ' ')
    .trim();
}

module.exports = {
  generateCounterpartyCandidates,
  hasTransactionEvidence,
  markedCandidateText,
};
