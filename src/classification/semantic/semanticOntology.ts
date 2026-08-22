import type {
  SemanticConceptDefinition,
  SemanticRiskDefinition,
} from './types';

export const PASTRY_FOOD_PATTERN =
  /鲜花饼|月饼|蛋糕|绿豆糕|桂花糕|马蹄糕|发糕|年糕|桃酥|蛋黄酥|凤梨酥|老婆饼|太阳饼|青团|麻薯|曲奇|威化|沙琪玛|糕点|点心/u;

export const PREPARED_FOOD_PATTERN =
  /包子|馒头|花卷|饺子|馄饨|烧麦|寿司|汉堡|披萨|三明治|沙拉|米线|米粉|螺蛳粉|酸辣粉|炒饭|盖饭|便当|炒面|汤面|煎饼|烧饼|手抓饼|肉夹馍/u;

export const FOOD_VOUCHER_PATTERN = /代金券|优惠券|兑换券|餐券|礼券/u;

const venue = (
  definition: Omit<
    SemanticConceptDefinition,
    'kind' | 'role' | 'proposalKind' | 'baseScore'
  >,
): SemanticConceptDefinition => ({
  ...definition,
  kind: 'VENUE',
  role: 'CONSUMPTION_VENUE',
  proposalKind: 'VENUE_DEFAULT',
  baseScore: 300,
});

const item = (
  definition: Omit<
    SemanticConceptDefinition,
    'kind' | 'role' | 'proposalKind' | 'baseScore'
  >,
): SemanticConceptDefinition => ({
  ...definition,
  kind: 'ITEM',
  role: 'PURCHASED_ITEM',
  proposalKind: 'EXPLICIT_ITEM',
  baseScore: 500,
});

const service = (
  definition: Omit<
    SemanticConceptDefinition,
    'kind' | 'role' | 'proposalKind' | 'baseScore'
  >,
): SemanticConceptDefinition => ({
  ...definition,
  kind: 'SERVICE',
  role: 'PAID_SERVICE',
  proposalKind: 'EXPLICIT_SERVICE',
  baseScore: 520,
});

const activity = (
  definition: Omit<
    SemanticConceptDefinition,
    'kind' | 'role' | 'proposalKind' | 'baseScore'
  >,
): SemanticConceptDefinition => ({
  ...definition,
  kind: 'ACTIVITY',
  role: 'CONSUMPTION_ACTIVITY',
  proposalKind: 'EXPLICIT_ACTIVITY',
  baseScore: 480,
});

/**
 * Concepts deliberately describe meaning instead of app screens. Stable ledger
 * category keys remain the output contract, while aliases can grow independently.
 */
export const SEMANTIC_CATEGORY_ONTOLOGY: readonly SemanticConceptDefinition[] =
  [
    venue({
      id: 'venue.internet_cafe',
      label: '网吧/网咖',
      aliases: [/网吧/u, /网咖/u, /电竞馆/u, /电竞网咖/u],
      categoryKey: 'expense.entertainment',
      subcategoryKey: 'expense.entertainment.games',
    }),
    venue({
      id: 'venue.ktv',
      label: 'KTV',
      aliases: [/ktv/iu, /量贩式(?:ktv|歌厅)/iu, /歌厅/u],
      categoryKey: 'expense.entertainment',
      subcategoryKey: 'expense.entertainment.ktv',
    }),
    venue({
      id: 'venue.cinema',
      label: '影院',
      aliases: [/电影院/u, /影院/u, /影城/u],
      categoryKey: 'expense.entertainment',
      subcategoryKey: 'expense.entertainment.movies',
    }),
    venue({
      id: 'venue.arcade',
      label: '电玩城/游戏厅',
      aliases: [/电玩城/u, /游戏厅/u, /街机厅/u],
      categoryKey: 'expense.entertainment',
      subcategoryKey: 'expense.entertainment.games',
    }),
    venue({
      id: 'venue.board_game',
      label: '桌游/棋牌场所',
      aliases: [/桌游(?:店|吧|馆)/u, /棋牌室/u, /麻将馆/u],
      categoryKey: 'expense.entertainment',
      subcategoryKey: 'expense.entertainment.board_games',
    }),
    venue({
      id: 'venue.gym',
      label: '健身场所',
      aliases: [/健身房/u, /健身馆/u, /瑜伽馆/u, /游泳馆/u],
      categoryKey: 'expense.entertainment',
      subcategoryKey: 'expense.entertainment.fitness',
    }),
    venue({
      id: 'venue.restaurant',
      label: '餐饮场所',
      aliases: [/沙县小吃/u, /小吃店/u, /餐厅/u, /餐馆/u, /饭馆/u, /饭店/u],
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.other',
    }),
    venue({
      id: 'venue.medical_facility',
      label: '医疗场所',
      aliases: [/医院/u, /诊所/u, /门诊部/u],
      categoryKey: 'expense.healthcare',
      subcategoryKey: 'expense.healthcare.outpatient',
    }),
    venue({
      id: 'venue.bookstore',
      label: '书店',
      aliases: [/书店/u, /图书城/u],
      categoryKey: 'expense.education',
      subcategoryKey: 'expense.education.books',
    }),

    item({
      id: 'item.drink',
      label: '饮料',
      aliases: [
        /矿泉水/u,
        /纯净水/u,
        /瓶(?:装)?水/u,
        /水(?!果|费|电|表|管|龙头)/u,
        /饮料/u,
        /可乐/u,
        /雪碧/u,
        /果汁/u,
        /咖啡/u,
        /奶茶/u,
      ],
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.drinks',
    }),
    item({
      id: 'item.grocery_dairy',
      label: '奶类食材',
      aliases: [/牛奶/u, /酸奶/u, /奶粉/u],
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.groceries',
    }),
    item({
      id: 'item.snack',
      label: '零食',
      aliases: [/泡面/u, /方便面/u, /零食/u, /薯片/u, /饼干/u, /爆米花/u],
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.snacks',
    }),
    item({
      id: 'item.pastry',
      label: '糕点点心',
      aliases: [PASTRY_FOOD_PATTERN],
      excludedContextAny: [FOOD_VOUCHER_PATTERN],
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.snacks',
    }),
    item({
      id: 'item.prepared_food',
      label: '即食餐点',
      aliases: [PREPARED_FOOD_PATTERN],
      excludedContextAny: [FOOD_VOUCHER_PATTERN],
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.other',
    }),
    item({
      id: 'item.electronics',
      label: '数码产品',
      aliases: [
        /鼠标/u,
        /键盘/u,
        /耳机/u,
        /充电器/u,
        /数据线/u,
        /u盘/iu,
        /硬盘/u,
        /显卡/u,
        /显示器/u,
        /电脑/u,
        /手机/u,
        /平板(?:电脑)?/u,
      ],
      categoryKey: 'expense.shopping',
      subcategoryKey: 'expense.shopping.electronics',
    }),
    item({
      id: 'item.medicine',
      label: '药品',
      aliases: [/药品/u, /药片/u, /感冒药/u, /退烧药/u, /处方药/u],
      categoryKey: 'expense.healthcare',
      subcategoryKey: 'expense.healthcare.medicine',
    }),
    item({
      id: 'item.book',
      label: '书籍',
      aliases: [/教材/u, /课本/u, /书籍/u, /图书/u],
      categoryKey: 'expense.education',
      subcategoryKey: 'expense.education.books',
    }),

    service({
      id: 'service.taxi',
      label: '打车服务',
      aliases: [/打车/u, /网约车/u, /出租车/u, /滴滴(?:打车|出行)?/u],
      categoryKey: 'expense.transport',
      subcategoryKey: 'expense.transport.taxi',
    }),
    service({
      id: 'service.bus',
      label: '公交服务',
      aliases: [/公交(?:车|费|票)?/u],
      categoryKey: 'expense.transport',
      subcategoryKey: 'expense.transport.bus',
    }),
    service({
      id: 'service.metro',
      label: '地铁服务',
      aliases: [/地铁(?:费|票)?/u],
      categoryKey: 'expense.transport',
      subcategoryKey: 'expense.transport.metro',
    }),
    service({
      id: 'service.hotel',
      label: '住宿服务',
      aliases: [/住酒店/u, /订酒店/u, /酒店住宿/u, /住民宿/u, /订民宿/u],
      categoryKey: 'expense.travel',
      subcategoryKey: 'expense.travel.hotel',
    }),
    service({
      id: 'service.medical_visit',
      label: '就医服务',
      aliases: [/看病/u, /挂号/u, /门诊/u, /就医/u],
      categoryKey: 'expense.healthcare',
      subcategoryKey: 'expense.healthcare.outpatient',
    }),
    service({
      id: 'service.course',
      label: '课程培训',
      aliases: [/课程/u, /培训班/u, /补习班/u, /网课/u],
      categoryKey: 'expense.education',
      subcategoryKey: 'expense.education.courses',
    }),
    service({
      id: 'service.printing',
      label: '打印复印',
      aliases: [/打印/u, /复印/u],
      categoryKey: 'expense.education',
      subcategoryKey: 'expense.education.printing',
    }),

    activity({
      id: 'activity.internet_cafe',
      label: '上网/电竞活动',
      aliases: [/上网/u, /包夜/u, /开黑/u, /电竞/u],
      requiredContextAny: [
        /网吧/u,
        /网咖/u,
        /电竞(?:馆|网咖)?/u,
        /网费/u,
        /机位/u,
        /开黑/u,
      ],
      excludedContextAny: [
        /手机上网/u,
        /上网流量/u,
        /宽带/u,
        /流量包/u,
        /酒店[^，。；]{0,8}包夜/u,
      ],
      categoryKey: 'expense.entertainment',
      subcategoryKey: 'expense.entertainment.games',
    }),
    activity({
      id: 'activity.singing',
      label: '唱歌/K歌',
      aliases: [/唱歌/u, /k歌/iu],
      categoryKey: 'expense.entertainment',
      subcategoryKey: 'expense.entertainment.ktv',
    }),
    activity({
      id: 'activity.movie',
      label: '观影',
      aliases: [/看电影/u, /观影/u],
      categoryKey: 'expense.entertainment',
      subcategoryKey: 'expense.entertainment.movies',
    }),
    activity({
      id: 'activity.game',
      label: '游戏',
      aliases: [/打游戏/u, /玩游戏/u, /玩街机/u],
      categoryKey: 'expense.entertainment',
      subcategoryKey: 'expense.entertainment.games',
    }),
    activity({
      id: 'activity.fitness',
      label: '运动健身',
      aliases: [/健身/u, /游泳/u, /瑜伽/u],
      categoryKey: 'expense.entertainment',
      subcategoryKey: 'expense.entertainment.fitness',
    }),
  ] as const;

export const SEMANTIC_TRANSACTION_RISKS: readonly SemanticRiskDefinition[] = [
  {
    id: 'risk.refund',
    kind: 'REFUND_OR_REVERSAL',
    pattern: /退款(?!手续费|服务费)|退费|退回|返还|撤销(?:消费|订单)/u,
    reason: '文本可能描述退款或冲正，不能按普通支出自动分类',
  },
  {
    id: 'risk.deposit',
    kind: 'DEPOSIT_OR_GUARANTEE',
    pattern: /押金|保证金|定金/u,
    reason: '押金、保证金或定金不一定是最终消费，需要确认交易语义',
  },
  {
    id: 'risk.top_up',
    kind: 'STORED_VALUE_OR_TOP_UP',
    pattern:
      /充值|充钱|充了(?=\d|[零〇一二两三四五六七八九十百千万])|储值|预付(?:款|卡)?|会员卡|储值卡|预付卡|充值卡|礼品卡/u,
    reason: '充值或储值可能是账户转移，也可能是消费，需要确认用途',
  },
  {
    id: 'risk.transfer',
    kind: 'TRANSFER_OR_ACCOUNT_MOVEMENT',
    pattern: /转账|转给|划转|提现/u,
    reason: '文本可能描述账户间资金移动，不能按普通消费自动分类',
  },
  {
    id: 'risk.income',
    kind: 'POSSIBLE_INCOME',
    pattern:
      /我(?:把)?[^，。；]{0,16}(?:卖给|卖掉|出售|转卖)|(?:卖掉|出售|转卖)[^，。；]{0,12}(?:到账|收款|赚了)|(?:收入|赚了)[^，。；]{0,10}(?:\d|元|块)/u,
    reason: '文本可能描述收入或二手出售，不能按普通支出自动分类',
  },
] as const;
