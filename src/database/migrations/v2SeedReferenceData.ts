import type { Migration } from './Migration';

const SEEDED_AT = '2026-07-20T00:00:00.000Z';

type CategorySeed = readonly [name: string, systemKey: string];

type ExpenseCategorySeed = {
  key: string;
  name: string;
  icon: string;
  children: readonly CategorySeed[];
};

const EXPENSE_CATEGORIES: readonly ExpenseCategorySeed[] = [
  {
    key: 'food',
    name: '餐饮',
    icon: '🍜',
    children: [
      ['早餐', 'breakfast'],
      ['午餐', 'lunch'],
      ['晚餐', 'dinner'],
      ['夜宵', 'late_night_snack'],
      ['外卖', 'delivery'],
      ['饮料', 'drinks'],
      ['咖啡奶茶', 'coffee_tea'],
      ['零食', 'snacks'],
      ['水果', 'fruit'],
      ['买菜', 'groceries'],
      ['聚餐', 'group_dining'],
      ['其他餐饮', 'other'],
    ],
  },
  {
    key: 'transport',
    name: '交通',
    icon: '🚇',
    children: [
      ['公交', 'bus'],
      ['地铁', 'metro'],
      ['打车', 'taxi'],
      ['共享单车', 'shared_bike'],
      ['火车高铁', 'train'],
      ['飞机', 'flight'],
      ['长途汽车', 'coach'],
      ['加油', 'fuel'],
      ['充电', 'charging'],
      ['停车', 'parking'],
      ['高速费', 'toll'],
      ['租车', 'car_rental'],
      ['其他交通', 'other'],
    ],
  },
  {
    key: 'travel',
    name: '旅行',
    icon: '🧳',
    children: [
      ['酒店住宿', 'hotel'],
      ['民宿', 'homestay'],
      ['景点门票', 'attraction_ticket'],
      ['旅行团', 'tour_group'],
      ['签证', 'visa'],
      ['旅行保险', 'travel_insurance'],
      ['行李寄存', 'luggage_storage'],
      ['旅行用品', 'travel_supplies'],
      ['其他旅行', 'other'],
    ],
  },
  {
    key: 'shopping',
    name: '购物',
    icon: '🛍️',
    children: [
      ['日用品', 'daily_supplies'],
      ['服饰', 'clothing'],
      ['鞋包', 'shoes_bags'],
      ['数码', 'electronics'],
      ['家电', 'appliances'],
      ['家具', 'furniture'],
      ['美妆护肤', 'beauty'],
      ['饰品', 'accessories'],
      ['礼物', 'gifts'],
      ['网购', 'online'],
      ['其他购物', 'other'],
    ],
  },
  {
    key: 'housing',
    name: '居住',
    icon: '🏠',
    children: [
      ['房租', 'rent'],
      ['水费', 'water'],
      ['电费', 'electricity'],
      ['燃气', 'gas'],
      ['物业', 'property_management'],
      ['宽带', 'broadband'],
      ['家庭维修', 'home_repair'],
      ['搬家', 'moving'],
      ['家政', 'housekeeping'],
      ['其他居住', 'other'],
    ],
  },
  {
    key: 'education',
    name: '学习',
    icon: '📚',
    children: [
      ['书籍', 'books'],
      ['课程', 'courses'],
      ['培训', 'training'],
      ['考试报名', 'exam'],
      ['打印复印', 'printing'],
      ['文具', 'stationery'],
      ['学习软件', 'software'],
      ['论文与资料', 'research'],
      ['学校费用', 'school_fees'],
      ['其他学习', 'other'],
    ],
  },
  {
    key: 'entertainment',
    name: '娱乐',
    icon: '🎮',
    children: [
      ['游戏', 'games'],
      ['电影', 'movies'],
      ['演出', 'shows'],
      ['KTV', 'ktv'],
      ['视频会员', 'video_membership'],
      ['音乐会员', 'music_membership'],
      ['运动健身', 'fitness'],
      ['棋牌', 'board_games'],
      ['其他娱乐', 'other'],
    ],
  },
  {
    key: 'healthcare',
    name: '医疗健康',
    icon: '🏥',
    children: [
      ['药品', 'medicine'],
      ['门诊', 'outpatient'],
      ['住院', 'hospitalization'],
      ['体检', 'checkup'],
      ['牙科', 'dental'],
      ['眼科', 'ophthalmology'],
      ['医疗保险自费', 'insurance_self_pay'],
      ['康复', 'rehabilitation'],
      ['其他医疗', 'other'],
    ],
  },
  {
    key: 'communication',
    name: '通讯',
    icon: '📱',
    children: [
      ['手机话费', 'phone_bill'],
      ['流量', 'mobile_data'],
      ['宽带', 'broadband'],
      ['通讯设备', 'devices'],
      ['其他通讯', 'other'],
    ],
  },
  {
    key: 'social',
    name: '人情往来',
    icon: '🧧',
    children: [
      ['红包', 'red_packet'],
      ['份子钱', 'ceremony_gift'],
      ['请客', 'treating'],
      ['礼物', 'gifts'],
      ['捐赠', 'donation'],
      ['孝敬长辈', 'elders'],
      ['其他人情', 'other'],
    ],
  },
  {
    key: 'pets',
    name: '宠物',
    icon: '🐾',
    children: [
      ['宠物食品', 'food'],
      ['宠物医疗', 'medical'],
      ['宠物用品', 'supplies'],
      ['宠物服务', 'services'],
      ['其他宠物', 'other'],
    ],
  },
  {
    key: 'financial_fees',
    name: '金融费用',
    icon: '💳',
    children: [
      ['手续费', 'service_fee'],
      ['利息', 'interest'],
      ['保险', 'insurance'],
      ['违约金', 'penalty'],
      ['汇兑费用', 'exchange_fee'],
      ['其他金融费用', 'other'],
    ],
  },
  {
    key: 'other_expense',
    name: '其他支出',
    icon: '📦',
    children: [
      ['无法识别支出', 'unclassified'],
      ['临时支出', 'temporary'],
    ],
  },
] as const;

const INCOME_CATEGORIES: readonly CategorySeed[] = [
  ['工资', 'salary'],
  ['奖金', 'bonus'],
  ['奖学金', 'scholarship'],
  ['生活费', 'allowance'],
  ['兼职', 'part_time'],
  ['项目补助', 'project_grant'],
  ['报销回款', 'reimbursement'],
  ['理财收益', 'investment'],
  ['利息收入', 'interest'],
  ['二手出售', 'secondhand_sale'],
  ['红包礼金', 'gift_money'],
  ['退款', 'refund'],
  ['其他收入', 'other'],
] as const;

const ACCOUNT_SEEDS = [
  ['account-wechat', '微信', 'WECHAT', '💚'],
  ['account-alipay', '支付宝', 'ALIPAY', '💙'],
  ['account-cash', '现金', 'CASH', '💵'],
  ['account-bank-card', '银行卡', 'BANK_CARD', '🏦'],
  ['account-credit-card', '信用卡', 'CREDIT_CARD', '💳'],
  ['account-huabei', '花呗', 'HUABEI', '🌸'],
  ['account-other', '其他账户', 'OTHER', '📁'],
] as const;

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function categoryInsert(
  id: string,
  type: 'EXPENSE' | 'INCOME',
  parentId: string | undefined,
  systemKey: string,
  name: string,
  icon: string | undefined,
  sortOrder: number,
): string {
  return `INSERT INTO categories (
    id, type, parent_id, system_key, name, icon, sort_order,
    is_system, is_hidden, created_at, updated_at
  ) VALUES (
    ${sqlString(id)}, ${sqlString(type)}, ${parentId === undefined ? 'NULL' : sqlString(parentId)},
    ${sqlString(systemKey)}, ${sqlString(name)}, ${icon === undefined ? 'NULL' : sqlString(icon)},
    ${sortOrder}, 1, 0, ${sqlString(SEEDED_AT)}, ${sqlString(SEEDED_AT)}
  )`;
}

const categoryStatements = EXPENSE_CATEGORIES.flatMap(
  (category, categoryIndex) => {
    const parentId = `category-expense-${category.key}`;
    const parent = categoryInsert(
      parentId,
      'EXPENSE',
      undefined,
      `expense.${category.key}`,
      category.name,
      category.icon,
      categoryIndex * 100,
    );
    const children = category.children.map(([name, key], childIndex) =>
      categoryInsert(
        `${parentId}-${key}`,
        'EXPENSE',
        parentId,
        `expense.${category.key}.${key}`,
        name,
        undefined,
        childIndex,
      ),
    );

    return [parent, ...children];
  },
).concat(
  INCOME_CATEGORIES.map(([name, key], index) =>
    categoryInsert(
      `category-income-${key}`,
      'INCOME',
      undefined,
      `income.${key}`,
      name,
      '💰',
      index,
    ),
  ),
);

const accountStatements = ACCOUNT_SEEDS.map(
  ([id, name, type, icon], index) => `INSERT INTO accounts (
    id, name, type, currency, include_in_net_worth,
    opening_balance_minor, current_balance_minor, icon,
    sort_order, is_hidden, created_at, updated_at
  ) VALUES (
    ${sqlString(id)}, ${sqlString(name)}, ${sqlString(type)}, 'CNY', 1,
    NULL, NULL, ${sqlString(icon)}, ${index}, 0,
    ${sqlString(SEEDED_AT)}, ${sqlString(SEEDED_AT)}
  )`,
);

export const v2SeedReferenceData: Migration = {
  version: 2,
  name: 'seed_reference_data',
  statements: [...categoryStatements, ...accountStatements],
};
