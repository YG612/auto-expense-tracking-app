const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  projectRoot,
  'src',
  'database',
  'migrations',
  'v2SeedReferenceData.ts',
);
const outputRoot = path.join(projectRoot, 'models', 'bill-classifier');
const trainingRoot = path.join(
  projectRoot,
  'build',
  'bill-classifier-training',
);

const BOOTSTRAP_ALIASES = {
  'expense.food.breakfast': ['早饭', '早餐店', '早茶'],
  'expense.food.lunch': ['午饭', '工作餐', '中饭'],
  'expense.food.dinner': ['晚饭', '晚餐馆'],
  'expense.food.delivery': ['点外卖', '外卖餐'],
  'expense.food.drinks': ['矿泉水', '可乐', '果汁'],
  'expense.food.coffee_tea': ['咖啡', '奶茶', '瑞幸', '星巴克', '库迪'],
  'expense.food.snacks': ['薯片', '饼干', '泡面'],
  'expense.food.fruit': ['苹果', '香蕉', '水果店'],
  'expense.food.groceries': ['菜市场', '蔬菜', '买肉'],
  'expense.transport.bus': ['公交车', '公交卡'],
  'expense.transport.metro': ['地铁票', '轨道交通'],
  'expense.transport.taxi': ['打车', '网约车', '滴滴'],
  'expense.transport.shared_bike': ['共享单车', '哈啰单车', '美团单车'],
  'expense.transport.train': ['高铁票', '火车票', '动车票'],
  'expense.transport.flight': ['机票', '航空票'],
  'expense.transport.fuel': ['加油站', '汽油', '油费'],
  'expense.transport.charging': ['充电桩', '汽车充电'],
  'expense.transport.parking': ['停车场', '停车费'],
  'expense.transport.toll': ['高速费', '过路费'],
  'expense.travel.hotel': ['酒店', '宾馆', '住宿'],
  'expense.travel.homestay': ['民宿', '客栈'],
  'expense.travel.attraction_ticket': ['景区门票', '公园门票'],
  'expense.shopping.daily_supplies': ['纸巾', '洗衣液', '生活用品'],
  'expense.shopping.clothing': ['衣服', '裤子', '外套'],
  'expense.shopping.shoes_bags': ['鞋子', '运动鞋', '背包'],
  'expense.shopping.electronics': ['手机', '电脑', '耳机', '键盘'],
  'expense.shopping.appliances': ['冰箱', '洗衣机', '小家电'],
  'expense.shopping.furniture': ['桌子', '椅子', '沙发'],
  'expense.shopping.beauty': ['护肤品', '化妆品', '面膜'],
  'expense.housing.rent': ['租金', '交房租'],
  'expense.housing.water': ['水费', '自来水费'],
  'expense.housing.electricity': ['电费', '交电费'],
  'expense.housing.gas': ['燃气费', '天然气费'],
  'expense.housing.property_management': ['物业费', '小区物业'],
  'expense.housing.broadband': ['网费', '宽带费'],
  'expense.education.books': ['买书', '教材', '电子书'],
  'expense.education.courses': ['网课', '课程费'],
  'expense.education.training': ['培训班', '培训费'],
  'expense.education.exam': ['考试费', '报名费'],
  'expense.education.stationery': ['笔记本', '钢笔', '文具店'],
  'expense.entertainment.games': ['游戏充值', '买游戏'],
  'expense.entertainment.movies': ['电影票', '电影院'],
  'expense.entertainment.shows': ['演唱会', '话剧票'],
  'expense.entertainment.ktv': ['唱歌', 'KTV消费'],
  'expense.entertainment.video_membership': ['视频网站会员', '追剧会员'],
  'expense.entertainment.fitness': ['健身房', '游泳馆', '瑜伽课'],
  'expense.healthcare.medicine': ['买药', '药店', '感冒药'],
  'expense.healthcare.outpatient': ['门诊费', '挂号费', '看病'],
  'expense.healthcare.hospitalization': ['住院费', '病房费'],
  'expense.healthcare.checkup': ['体检费', '体检中心'],
  'expense.healthcare.dental': ['看牙', '洗牙', '牙医'],
  'expense.healthcare.ophthalmology': ['眼科', '验光'],
  'expense.communication.phone_bill': ['充话费', '手机费'],
  'expense.communication.mobile_data': ['流量包', '手机流量'],
  'expense.social.red_packet': ['发红包', '微信红包'],
  'expense.social.ceremony_gift': ['随礼', '礼金', '份子'],
  'expense.social.donation': ['捐款', '公益捐赠'],
  'expense.pets.food': ['猫粮', '狗粮', '宠物粮'],
  'expense.pets.medical': ['宠物医院', '猫看病', '狗看病'],
  'expense.pets.supplies': ['猫砂', '宠物玩具'],
  'expense.pets.services': ['宠物洗澡', '宠物寄养'],
  'expense.financial_fees.service_fee': ['手续费', '服务费'],
  'expense.financial_fees.interest': ['贷款利息', '分期利息'],
  'expense.financial_fees.insurance': ['保险费', '保费'],
  'expense.financial_fees.penalty': ['违约金', '滞纳金'],
  'income.salary': ['工资到账', '发工资', '薪水'],
  'income.bonus': ['奖金到账', '年终奖', '绩效奖'],
  'income.scholarship': ['奖学金到账'],
  'income.allowance': ['收到生活费', '家里给生活费'],
  'income.part_time': ['兼职工资', '兼职报酬'],
  'income.project_grant': ['项目补贴', '项目资助'],
  'income.investment': ['理财收益', '基金收益', '投资分红'],
  'income.interest': ['存款利息', '利息到账'],
  'income.secondhand_sale': ['卖二手', '闲置卖出'],
  'income.gift_money': ['收到红包', '收到礼金'],
};

function parseTaxonomy(source) {
  const expenseSource = source.slice(
    source.indexOf('const EXPENSE_CATEGORIES'),
    source.indexOf('const INCOME_CATEGORIES'),
  );
  const expense = [];
  const parentPattern =
    /\{\s*key:\s*'([^']+)',\s*name:\s*'([^']+)',[\s\S]*?children:\s*\[([\s\S]*?)\]\s*,?\s*\}/gu;
  for (const match of expenseSource.matchAll(parentPattern)) {
    const children = [...match[3].matchAll(/\['([^']+)',\s*'([^']+)'\]/gu)].map(
      child => ({ name: child[1], key: `expense.${match[1]}.${child[2]}` }),
    );
    expense.push({
      name: match[2],
      key: `expense.${match[1]}`,
      children,
    });
  }

  const incomeSource = source.slice(
    source.indexOf('const INCOME_CATEGORIES'),
    source.indexOf('const ACCOUNT_SEEDS'),
  );
  const income = [...incomeSource.matchAll(/\['([^']+)',\s*'([^']+)'\]/gu)].map(
    item => ({ name: item[1], key: `income.${item[2]}` }),
  );
  if (expense.length !== 13 || income.length !== 13) {
    throw new Error(
      `Taxonomy parser expected 13 expense and 13 income parents, got ${expense.length}/${income.length}.`,
    );
  }
  return { schemaVersion: 1, taxonomyVersion: 2, expense, income };
}

function examplesFor(name, key) {
  const aliases = [...new Set([name, ...(BOOTSTRAP_ALIASES[key] ?? [])])];
  const templates = [
    value => value,
    value => `${value} <AMOUNT>`,
    value => `今天${value}花了 <AMOUNT>`,
    value => `${value}支付 <AMOUNT>`,
    value => `${value}用了 <AMOUNT>`,
    value => `<DATE> ${value} <AMOUNT>`,
    value => `${value} <ACCOUNT>`,
    value => `刚刚${value} <AMOUNT>`,
  ];
  return aliases.flatMap(alias => templates.map(template => template(alias)));
}

function writeLines(file, lines) {
  fs.writeFileSync(file, `${[...new Set(lines)].join('\n')}\n`, 'utf8');
}

function generate() {
  const taxonomy = parseTaxonomy(fs.readFileSync(migrationPath, 'utf8'));
  fs.mkdirSync(trainingRoot, { recursive: true });
  fs.writeFileSync(
    path.join(outputRoot, 'taxonomy.json'),
    `${JSON.stringify(taxonomy, null, 2)}\n`,
  );

  const expenseParent = [];
  for (const parent of taxonomy.expense) {
    const childLines = [];
    for (const child of parent.children) {
      const examples = examplesFor(child.name, child.key);
      expenseParent.push(
        ...examples.map(text => `__label__${parent.key} ${text}`),
      );
      childLines.push(...examples.map(text => `__label__${child.key} ${text}`));
    }
    writeLines(
      path.join(trainingRoot, `child-${parent.key}.train.txt`),
      childLines,
    );
  }
  writeLines(
    path.join(trainingRoot, 'parent-expense.train.txt'),
    expenseParent,
  );

  const incomeLines = taxonomy.income.flatMap(category =>
    examplesFor(category.name, category.key).map(
      text => `__label__${category.key} ${text}`,
    ),
  );
  writeLines(path.join(trainingRoot, 'parent-income.train.txt'), incomeLines);

  const riskCases = [
    '朋友转给我100元',
    '押金退回200元',
    '信用卡还款500元',
    '从微信转到银行卡1000元',
    '充值100元',
    '午饭25元然后打车18元',
    '没有去医院消费',
  ];
  writeLines(path.join(trainingRoot, 'risk-abstention.txt'), riskCases);
  process.stdout.write(
    `Generated ${expenseParent.length + incomeLines.length} bootstrap examples.\n`,
  );
}

generate();
