import type {
  Account,
  AccountType,
  Category,
  Merchant,
  RuleType,
  TransactionType,
  UserRule,
} from '../../domain/entities';
import type { CandidateAlternative } from '../types';
import { normalizeChineseTransactionText } from '../normalizers/normalizeText';

export type AccountRecognition = {
  accountKey?: AccountType;
  targetAccountKey?: AccountType;
  accountIdHint?: string;
  explicit: boolean;
};

export type TypeRecognition = {
  type: TransactionType;
  explicit: boolean;
  risk?: 'RECHARGE' | 'SPECIAL';
};

export type MerchantRecognition = {
  merchantRawName?: string;
  personalRecipient: boolean;
  broadMerchant: boolean;
};

export type RuleRecognition = {
  matched: boolean;
  type?: TransactionType;
  categoryKey?: string;
  subcategoryKey?: string;
  accountKey?: AccountType;
  categoryIdHint?: string;
  subcategoryIdHint?: string;
  accountIdHint?: string;
  ruleId?: string;
  ruleType?: RuleType;
  rulePattern?: string;
  rulePriority?: number;
  learnedFromCorrections?: boolean;
};

export type MerchantDictionaryRecognition = RuleRecognition & {
  merchantIdHint?: string;
  merchantRawName?: string;
};

export type CategoryRecognition = {
  categoryKey?: string;
  subcategoryKey?: string;
  explicit: boolean;
  alternatives: CandidateAlternative[];
  ambiguityReasons: string[];
};

type AccountAlias = {
  key: AccountType;
  pattern: RegExp;
};

const ACCOUNT_ALIASES: readonly AccountAlias[] = [
  { key: 'WECHAT', pattern: /微信|微信支付/gu },
  { key: 'ALIPAY', pattern: /支付宝/gu },
  { key: 'CREDIT_CARD', pattern: /信用卡/gu },
  { key: 'BANK_CARD', pattern: /银行卡|储蓄卡|借记卡/gu },
  { key: 'HUABEI', pattern: /花呗/gu },
  { key: 'CASH', pattern: /现金/gu },
] as const;

type IndexedAccount = { key: AccountType; index: number };

function indexedAccounts(text: string): IndexedAccount[] {
  return ACCOUNT_ALIASES.flatMap(alias =>
    [...text.matchAll(alias.pattern)].flatMap(match =>
      match.index === undefined ? [] : [{ key: alias.key, index: match.index }],
    ),
  ).sort((left, right) => left.index - right.index);
}

function accountIdForKey(
  key: AccountType | undefined,
  accounts: readonly Account[],
): string | undefined {
  return key === undefined
    ? undefined
    : accounts.find(account => account.type === key)?.id;
}

export function recognizeAccounts(
  text: string,
  accounts: readonly Account[] = [],
): AccountRecognition {
  const matches = indexedAccounts(text);
  if (matches.length === 0) {
    return { explicit: false };
  }

  const fromIndex = text.indexOf('从');
  const toIndex = Math.max(text.indexOf('到'), text.indexOf('转入'));
  const transferIndex = Math.max(
    text.indexOf('转'),
    text.indexOf('提'),
    text.indexOf('存'),
  );

  if (fromIndex >= 0 && transferIndex > fromIndex && toIndex > transferIndex) {
    const source = [...matches]
      .reverse()
      .find(match => match.index > fromIndex && match.index < toIndex);
    const target = matches.find(match => match.index > toIndex);
    if (source !== undefined || target !== undefined) {
      return {
        accountKey: source?.key,
        targetAccountKey: target?.key,
        accountIdHint: accountIdForKey(source?.key, accounts),
        explicit: true,
      };
    }
  }

  if (/转入|转到|提现到|存入/u.test(text) && matches.length === 1) {
    return { targetAccountKey: matches[0].key, explicit: true };
  }

  return {
    accountKey: matches[0].key,
    accountIdHint: accountIdForKey(matches[0].key, accounts),
    explicit: true,
  };
}

export function recognizeTransactionType(text: string): TypeRecognition {
  if (/退款|退货.*到账|原路退回|取消订单.*返还|退回款/u.test(text)) {
    return { type: 'REFUND', explicit: true, risk: 'SPECIAL' };
  }
  if (/报销/u.test(text)) {
    return { type: 'REIMBURSEMENT', explicit: true, risk: 'SPECIAL' };
  }
  if (/朋友.*还(?:我|钱)|还我|还钱给我|归还给我/u.test(text)) {
    return { type: 'REPAYMENT_IN', explicit: true, risk: 'SPECIAL' };
  }
  if (/信用卡还款|花呗还款|还信用卡|还花呗|还给/u.test(text)) {
    return { type: 'REPAYMENT_OUT', explicit: true, risk: 'SPECIAL' };
  }
  if (/借给|借出去/u.test(text)) {
    return { type: 'LEND_OUT', explicit: true, risk: 'SPECIAL' };
  }
  if (/借入|向.+借|借了.+(?:元|块)/u.test(text)) {
    return { type: 'BORROW_IN', explicit: true, risk: 'SPECIAL' };
  }
  if (
    /从.+(?:转|提|存).+(?:到|入)|账户之间转|转入|转到|提现到|存入/u.test(text)
  ) {
    return { type: 'TRANSFER', explicit: true };
  }
  if (
    /收到工资|发工资|工资到账|奖学金到账|兼职收入|收到奖金|项目补助到账/u.test(
      text,
    )
  ) {
    return { type: 'INCOME', explicit: true };
  }
  if (/充值/u.test(text)) {
    return { type: 'EXPENSE', explicit: true, risk: 'RECHARGE' };
  }
  if (
    /花了|买了?|付了?|支付|消费|扣款|订了|交了|打车|坐(?:高铁|火车|地铁|公交)/u.test(
      text,
    )
  ) {
    return { type: 'EXPENSE', explicit: true };
  }

  return { type: 'EXPENSE', explicit: false };
}

const KNOWN_MERCHANTS = [
  '淘宝',
  '天猫',
  '京东',
  '拼多多',
  '美团',
  '饿了么',
  '滴滴',
  '瑞幸',
  '星巴克',
  '库迪',
] as const;

const NON_MERCHANT_LEADING_TERMS = new Set([
  '早餐',
  '早饭',
  '午饭',
  '午餐',
  '晚饭',
  '晚餐',
  '夜宵',
  '水果',
  '打车',
  '地铁',
  '公交',
  '高铁',
  '火车',
  '机票',
  '酒店',
  '房租',
  '水费',
  '电费',
  '燃气',
  '话费',
  '工资',
  '奖金',
  '退款',
  '报销',
  '还款',
  '充值',
]);

function inferredMerchant(text: string): string | undefined {
  const leading =
    /^([\p{Script=Han}A-Za-z0-9·&]{2,20}?)(?=(?:花了|消费|支付|买了?)?\s*\d+(?:\.\d+)?(?:元|块)?(?:[,，。.]|$))/u.exec(
      text,
    )?.[1];
  const located =
    /(?:在|去)([\p{Script=Han}A-Za-z0-9·&]{2,20})(?=花了|消费|支付|买)/u.exec(
      text,
    )?.[1];
  const candidate = leading ?? located;
  return candidate === undefined || NON_MERCHANT_LEADING_TERMS.has(candidate)
    ? undefined
    : candidate;
}

export function recognizeMerchant(text: string): MerchantRecognition {
  const known = KNOWN_MERCHANTS.find(name => text.includes(name));
  const personal = /个人收款码|个人码/u.test(text);
  const recipient =
    /(?:支付给|付给|转给|给)\s*([\p{Script=Han}]{2,4})(?=\d|元|块|,|\.|$)/u.exec(
      text,
    );
  const merchantRawName = known ?? recipient?.[1] ?? inferredMerchant(text);

  return {
    merchantRawName,
    personalRecipient: personal || recipient !== null,
    broadMerchant:
      /便利店/u.test(text) ||
      merchantRawName === '淘宝' ||
      merchantRawName === '天猫' ||
      merchantRawName === '京东' ||
      merchantRawName === '拼多多',
  };
}

function resolveCategory(
  categoryId: string | undefined,
  subcategoryId: string | undefined,
  categories: readonly Category[],
): Pick<
  RuleRecognition,
  'categoryKey' | 'subcategoryKey' | 'categoryIdHint' | 'subcategoryIdHint'
> {
  const selectedCategory =
    categoryId === undefined
      ? undefined
      : categories.find(category => category.id === categoryId);
  const selectedSubcategory =
    subcategoryId === undefined
      ? undefined
      : categories.find(category => category.id === subcategoryId);
  const effectiveSubcategory =
    selectedSubcategory ??
    (selectedCategory?.parentId === undefined ? undefined : selectedCategory);
  const effectiveCategory =
    effectiveSubcategory === undefined
      ? selectedCategory
      : categories.find(
          category => category.id === effectiveSubcategory.parentId,
        );

  return {
    categoryKey: effectiveCategory?.systemKey,
    subcategoryKey: effectiveSubcategory?.systemKey,
    categoryIdHint: effectiveCategory?.id,
    subcategoryIdHint: effectiveSubcategory?.id,
  };
}

function ruleMatches(rule: UserRule, text: string, merchant?: string): boolean {
  const pattern = normalizeChineseTransactionText(rule.pattern)
    .trim()
    .toLocaleLowerCase('zh-CN');
  if (pattern.length === 0) {
    return false;
  }
  if (rule.ruleType === 'MERCHANT') {
    return (
      normalizeChineseTransactionText(merchant ?? '')
        .trim()
        .toLocaleLowerCase('zh-CN') === pattern
    );
  }
  if (rule.ruleType !== 'KEYWORD' && rule.ruleType !== 'TEXT_PATTERN') {
    return false;
  }
  return normalizeChineseTransactionText(text)
    .toLocaleLowerCase('zh-CN')
    .includes(pattern);
}

function ruleOriginRank(rule: UserRule): number {
  return rule.origin === 'LEARNED_MERCHANT' ? 1 : 2;
}

function ruleTypeRank(ruleType: RuleType): number {
  if (ruleType === 'MERCHANT') {
    return 5;
  }
  if (ruleType === 'KEYWORD') {
    return 4;
  }
  if (ruleType === 'TEXT_PATTERN') {
    return 3;
  }
  return ruleType === 'ACCOUNT' ? 2 : 1;
}

export function applyExistingUserRules(
  text: string,
  merchant: string | undefined,
  rules: readonly UserRule[] = [],
  categories: readonly Category[] = [],
  accounts: readonly Account[] = [],
): RuleRecognition {
  const rule = [...rules]
    .filter(item => item.enabled && ruleMatches(item, text, merchant))
    .sort(
      (left, right) =>
        ruleOriginRank(right) - ruleOriginRank(left) ||
        right.priority - left.priority ||
        ruleTypeRank(right.ruleType) - ruleTypeRank(left.ruleType) ||
        right.pattern.length - left.pattern.length ||
        left.id.localeCompare(right.id),
    )[0];
  if (rule === undefined) {
    return { matched: false };
  }

  const category = resolveCategory(
    rule.categoryId,
    rule.subcategoryId,
    categories,
  );
  const account =
    rule.accountId === undefined
      ? undefined
      : accounts.find(item => item.id === rule.accountId);
  return {
    matched: true,
    type: rule.transactionType,
    ...category,
    accountKey: account?.type,
    accountIdHint: account?.id,
    ruleId: rule.id,
    ruleType: rule.ruleType,
    rulePattern: rule.pattern,
    rulePriority: rule.priority,
    learnedFromCorrections: rule.origin === 'LEARNED_MERCHANT',
  };
}

function merchantMatchLength(merchant: Merchant, text: string): number {
  const normalized = text.toLocaleLowerCase('zh-CN');
  return Math.max(
    0,
    ...[merchant.canonicalName, merchant.normalizedName, ...merchant.aliases]
      .map(value => value.trim().toLocaleLowerCase('zh-CN'))
      .filter(value => value.length > 0)
      .filter(value => normalized.includes(value))
      .map(value => value.length),
  );
}

export function applyMerchantDictionary(
  text: string,
  merchants: readonly Merchant[] = [],
  categories: readonly Category[] = [],
): MerchantDictionaryRecognition {
  const ranked = merchants
    .map(merchant => ({ merchant, score: merchantMatchLength(merchant, text) }))
    .filter(item => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.merchant.canonicalName.length -
          left.merchant.canonicalName.length ||
        left.merchant.id.localeCompare(right.merchant.id),
    );
  const best = ranked[0];
  if (best === undefined || ranked[1]?.score === best.score) {
    return { matched: false };
  }
  const merchant = best.merchant;

  return {
    matched: true,
    ...resolveCategory(
      merchant.defaultCategoryId,
      merchant.defaultSubcategoryId,
      categories,
    ),
    merchantIdHint: merchant.id,
    merchantRawName: merchant.canonicalName,
  };
}

type KeywordCategoryRule = {
  pattern: RegExp;
  categoryKey: string;
  subcategoryKey?: string;
  explicit: boolean;
};

const EXPENSE_CATEGORY_RULES: readonly KeywordCategoryRule[] = [
  {
    pattern: /早饭|早餐/u,
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.breakfast',
    explicit: true,
  },
  {
    pattern: /午饭|午餐|中午吃饭/u,
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.lunch',
    explicit: true,
  },
  {
    pattern: /晚饭|晚餐/u,
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.dinner',
    explicit: true,
  },
  {
    pattern: /夜宵|宵夜/u,
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.late_night_snack',
    explicit: true,
  },
  {
    pattern: /外卖|点餐|送餐/u,
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.delivery',
    explicit: true,
  },
  {
    pattern: /奶茶|咖啡/u,
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.coffee_tea',
    explicit: true,
  },
  {
    pattern: /瑞幸|星巴克|库迪/u,
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.coffee_tea',
    explicit: false,
  },
  {
    pattern: /饮料|果汁|可乐/u,
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.drinks',
    explicit: true,
  },
  {
    pattern: /水果/u,
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.fruit',
    explicit: true,
  },
  {
    pattern: /买菜|蔬菜|菜市场/u,
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.groceries',
    explicit: true,
  },
  {
    pattern: /吃饭|餐厅|饭店|面馆|火锅/u,
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.other',
    explicit: true,
  },
  {
    pattern: /打车|出租车|网约车/u,
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.taxi',
    explicit: true,
  },
  {
    pattern: /滴滴/u,
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.taxi',
    explicit: false,
  },
  {
    pattern: /地铁/u,
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.metro',
    explicit: true,
  },
  {
    pattern: /公交/u,
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.bus',
    explicit: true,
  },
  {
    pattern: /高铁|火车|动车/u,
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.train',
    explicit: true,
  },
  {
    pattern: /飞机|机票/u,
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.flight',
    explicit: true,
  },
  {
    pattern: /共享单车/u,
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.shared_bike',
    explicit: true,
  },
  {
    pattern: /加油/u,
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.fuel',
    explicit: true,
  },
  {
    pattern: /停车/u,
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.parking',
    explicit: true,
  },
  {
    pattern: /高速费|过路费/u,
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.toll',
    explicit: true,
  },
  {
    pattern: /酒店|宾馆/u,
    categoryKey: 'expense.travel',
    subcategoryKey: 'expense.travel.hotel',
    explicit: true,
  },
  {
    pattern: /民宿/u,
    categoryKey: 'expense.travel',
    subcategoryKey: 'expense.travel.homestay',
    explicit: true,
  },
  {
    pattern: /景点|门票/u,
    categoryKey: 'expense.travel',
    subcategoryKey: 'expense.travel.attraction_ticket',
    explicit: true,
  },
  {
    pattern: /淘宝|天猫|京东|拼多多|网购/u,
    categoryKey: 'expense.shopping',
    subcategoryKey: 'expense.shopping.online',
    explicit: false,
  },
  {
    pattern: /房租|租房/u,
    categoryKey: 'expense.housing',
    subcategoryKey: 'expense.housing.rent',
    explicit: true,
  },
  {
    pattern: /电费/u,
    categoryKey: 'expense.housing',
    subcategoryKey: 'expense.housing.electricity',
    explicit: true,
  },
  {
    pattern: /水费/u,
    categoryKey: 'expense.housing',
    subcategoryKey: 'expense.housing.water',
    explicit: true,
  },
  {
    pattern: /燃气/u,
    categoryKey: 'expense.housing',
    subcategoryKey: 'expense.housing.gas',
    explicit: true,
  },
  {
    pattern: /书|教材/u,
    categoryKey: 'expense.education',
    subcategoryKey: 'expense.education.books',
    explicit: true,
  },
  {
    pattern: /课程|培训/u,
    categoryKey: 'expense.education',
    subcategoryKey: 'expense.education.courses',
    explicit: true,
  },
  {
    pattern: /电影/u,
    categoryKey: 'expense.entertainment',
    subcategoryKey: 'expense.entertainment.movies',
    explicit: true,
  },
  {
    pattern: /游戏/u,
    categoryKey: 'expense.entertainment',
    subcategoryKey: 'expense.entertainment.games',
    explicit: true,
  },
  {
    pattern: /健身/u,
    categoryKey: 'expense.entertainment',
    subcategoryKey: 'expense.entertainment.fitness',
    explicit: true,
  },
  {
    pattern: /药|买药/u,
    categoryKey: 'expense.healthcare',
    subcategoryKey: 'expense.healthcare.medicine',
    explicit: true,
  },
  {
    pattern: /医院|门诊|看病/u,
    categoryKey: 'expense.healthcare',
    subcategoryKey: 'expense.healthcare.outpatient',
    explicit: true,
  },
  {
    pattern: /话费/u,
    categoryKey: 'expense.communication',
    subcategoryKey: 'expense.communication.phone_bill',
    explicit: true,
  },
  {
    pattern: /红包/u,
    categoryKey: 'expense.social',
    subcategoryKey: 'expense.social.red_packet',
    explicit: true,
  },
] as const;

export function recognizeCategory(
  text: string,
  type: TransactionType,
): CategoryRecognition {
  if (type === 'REIMBURSEMENT') {
    return {
      categoryKey: 'income.reimbursement',
      explicit: true,
      alternatives: [],
      ambiguityReasons: ['报销回款建议关联原支出，请确认'],
    };
  }
  if (type === 'REFUND') {
    return {
      categoryKey: 'income.refund',
      explicit: true,
      alternatives: [],
      ambiguityReasons: ['退款建议关联原支出，请确认'],
    };
  }
  if (type === 'INCOME') {
    const incomeKey = /工资/u.test(text)
      ? 'income.salary'
      : /奖金/u.test(text)
        ? 'income.bonus'
        : /奖学金/u.test(text)
          ? 'income.scholarship'
          : /兼职/u.test(text)
            ? 'income.part_time'
            : /项目补助/u.test(text)
              ? 'income.project_grant'
              : undefined;
    return {
      categoryKey: incomeKey,
      explicit: incomeKey !== undefined,
      alternatives: [],
      ambiguityReasons: [],
    };
  }
  if (type !== 'EXPENSE') {
    return { explicit: false, alternatives: [], ambiguityReasons: [] };
  }

  if (/充值/u.test(text)) {
    return {
      explicit: false,
      alternatives: [
        {
          label: '手机话费',
          categoryKey: 'expense.communication',
          subcategoryKey: 'expense.communication.phone_bill',
        },
        {
          label: '公交卡',
          categoryKey: 'expense.transport',
          subcategoryKey: 'expense.transport.bus',
        },
        {
          label: '游戏充值',
          categoryKey: 'expense.entertainment',
          subcategoryKey: 'expense.entertainment.games',
        },
        {
          label: '饭卡',
          categoryKey: 'expense.food',
          subcategoryKey: 'expense.food.other',
        },
        { label: '账户转账', type: 'TRANSFER' },
      ],
      ambiguityReasons: ['“充值”可能对应多种消费或账户转账'],
    };
  }

  if (/便利店/u.test(text)) {
    return {
      explicit: false,
      alternatives: [
        {
          label: '零食',
          categoryKey: 'expense.food',
          subcategoryKey: 'expense.food.snacks',
        },
        {
          label: '饮料',
          categoryKey: 'expense.food',
          subcategoryKey: 'expense.food.drinks',
        },
        {
          label: '早餐',
          categoryKey: 'expense.food',
          subcategoryKey: 'expense.food.breakfast',
        },
        {
          label: '日用品',
          categoryKey: 'expense.shopping',
          subcategoryKey: 'expense.shopping.daily_supplies',
        },
      ],
      ambiguityReasons: ['便利店商品类型不明确'],
    };
  }

  const rule = EXPENSE_CATEGORY_RULES.find(item => item.pattern.test(text));
  return {
    categoryKey: rule?.categoryKey,
    subcategoryKey: rule?.subcategoryKey,
    explicit: rule?.explicit ?? false,
    alternatives: [],
    ambiguityReasons: [],
  };
}

export function inferProjectAndTags(text: string): {
  projectName?: string;
  tags: string[];
} {
  const explicit = /([\p{Script=Han}]{2,6})(旅行|旅游|出差)/u.exec(text);
  if (explicit !== null) {
    const place = explicit[1].replace(/^(?:去|在)/u, '');
    const kind = explicit[2];
    return {
      projectName: `${place}${kind}`,
      tags: [kind === '出差' ? '出差' : '旅行'],
    };
  }

  const destination =
    /(?:去|在)([\p{Script=Han}]{2,4})(?=住|坐|玩|旅游|旅行)/u.exec(text);
  return destination === null
    ? { tags: [] }
    : { projectName: `${destination[1]}旅行`, tags: ['旅行'] };
}

export function hasExplicitTransactionCue(text: string): boolean {
  return /花了|买了?|付了?|支付|消费|扣款|订了|交了|转|退款|到账|报销|还款|还我|借给|打车|坐/u.test(
    text,
  );
}
