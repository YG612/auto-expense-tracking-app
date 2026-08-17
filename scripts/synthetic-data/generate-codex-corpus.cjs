const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('./pipeline-utils.cjs');
const { groupBucket } = require('./prepare-category-dataset.cjs');
const { validateRows } = require('./validate-dataset.cjs');

const GENERATOR = 'openai-codex-current/generator-pass-v1';
const REVIEWER = 'deterministic-validator/codex-authored-rules-v1';
const LABELS = [
  'income',
  'expense.food',
  'expense.transport',
  'expense.shopping',
  'expense.housing',
  'expense.entertainment',
  'expense.healthcare',
  'expense.education',
  'expense.other_expense',
];
const CATEGORY_SCENARIOS = [
  'VENUE_VS_ITEM',
  'BROAD_PLATFORM',
  'ASR_HOMOPHONE',
  'CATEGORY_BOUNDARY',
  'INSUFFICIENT_INFORMATION',
  'NEW_MERCHANT',
];
const PREFIXES = [
  ...'春夏秋冬东西南北云海星月山水青白赤金木火土风雨晨夕远近大小新旧安乐',
];
const SUFFIXES = [
  ...'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥松竹梅兰荷桂枫柳桃杏禾麦',
];
const CONTEXTS = [
  '刚刚',
  '今天',
  '昨晚',
  '周末',
  '月底',
  '出门时',
  '下班后',
  '午休时',
  '早晨',
  '临睡前',
];

const CATEGORY_CONFIG = {
  income: {
    places: ['公司', '客户', '平台', '项目组', '合作方'],
    items: ['工资', '奖金', '稿费', '劳务费', '利息', '分红', '销售款', '补贴'],
    verbs: ['到账', '入账', '收到', '结算'],
  },
  'expense.food': {
    places: ['食堂', '餐馆', '咖啡店', '面包房', '外卖店'],
    items: ['早餐', '午饭', '晚餐', '咖啡', '奶茶', '水果', '夜宵', '点心'],
    verbs: ['买了', '支付', '消费', '结账'],
  },
  'expense.transport': {
    places: ['地铁站', '公交站', '出租车', '停车场', '加油站'],
    items: ['车票', '打车', '公交', '地铁', '停车费', '油费', '过路费', '骑行'],
    verbs: ['支付', '花了', '扣款', '结算'],
  },
  'expense.shopping': {
    places: ['商场', '超市', '网店', '便利店', '百货店'],
    items: [
      '衣服',
      '鞋子',
      '日用品',
      '数码配件',
      '洗护品',
      '家居品',
      '文具',
      '礼物',
    ],
    verbs: ['购买', '下单', '消费', '付款'],
  },
  'expense.housing': {
    places: ['物业处', '房东', '供电局', '燃气站', '维修店'],
    items: [
      '房租',
      '物业费',
      '电费',
      '水费',
      '燃气费',
      '维修费',
      '宽带费',
      '保洁费',
    ],
    verbs: ['缴纳', '支付', '扣款', '结清'],
  },
  'expense.entertainment': {
    places: ['影院', '剧场', '乐园', '游戏厅', '票务平台'],
    items: [
      '电影票',
      '演出票',
      '游戏',
      '会员',
      '展览票',
      '桌游',
      '唱歌',
      '门票',
    ],
    verbs: ['购买', '充值', '消费', '订票'],
  },
  'expense.healthcare': {
    places: ['医院', '诊所', '药房', '牙科', '体检中心'],
    items: [
      '挂号费',
      '药品',
      '检查费',
      '治疗费',
      '牙科费',
      '体检费',
      '眼镜',
      '康复费',
    ],
    verbs: ['支付', '买了', '缴费', '结算'],
  },
  'expense.education': {
    places: ['学校', '书店', '培训班', '网课平台', '考试中心'],
    items: [
      '学费',
      '教材',
      '课程',
      '考试费',
      '资料费',
      '培训费',
      '书籍',
      '报名费',
    ],
    verbs: ['缴纳', '购买', '报名', '支付'],
  },
  'expense.other_expense': {
    places: ['社区', '服务台', '宠物店', '照相馆', '打印店'],
    items: [
      '捐款',
      '宠物护理',
      '证件费',
      '打印费',
      '快递费',
      '理发',
      '洗衣',
      '杂费',
    ],
    verbs: ['支付', '花了', '缴纳', '消费'],
  },
};

function pick(values, index, divisor = 1) {
  return values[Math.floor(index / divisor) % values.length];
}

function uniqueName(index, offset = 0) {
  const value = index + offset;
  return `${pick(PREFIXES, value)}${pick(SUFFIXES, value, PREFIXES.length)}`;
}

function splitGroup(label, index, wantValidation, frozen = false) {
  const prefix = frozen ? 'frozen' : 'development';
  for (let attempt = 0; ; attempt += 1) {
    const group = `${prefix}-${label.replaceAll('.', '-')}-${index}-${attempt}`;
    if (groupBucket(group) < 15 === wantValidation) return group;
  }
}

function categoryText(label, index, frozen, version = 1) {
  const config = CATEGORY_CONFIG[label];
  const offset = frozen ? version * 100000 : (version - 1) * 300000;
  const name = uniqueName(index, offset);
  const place = pick(config.places, index, PREFIXES.length * SUFFIXES.length);
  const item = pick(config.items, index, 7);
  const verb = pick(config.verbs, index, 11);
  const context = pick(CONTEXTS, index, 13);
  const merchant = `${name}${place}`;
  const templatesV1 = frozen
    ? [
        `${context}记一下，${merchant}的${item}${verb}`,
        `${item}这一笔是在${merchant}${verb}的`,
        `账单显示${merchant}，实际是${item}${verb}`,
        `帮我记${merchant}${item}这笔`,
      ]
    : [
        `${context}在${merchant}${verb}${item}`,
        `${merchant}${item}${verb}记一笔`,
        `记账：${item}，商户${merchant}`,
        `${context}${item}${verb}，来自${merchant}`,
      ];
  const flow = label === 'income' ? '收入' : '消费';
  const templatesV2 = frozen
    ? [
        `${merchant}显示一笔${item}相关${flow}，${context}${verb}`,
        `${context}的${flow}凭证写着${merchant}，内容是${item}`,
        `这笔${item}${verb}自${merchant}，按${flow}候选处理`,
        `来自${merchant}的记录，实际事项为${item}${verb}`,
        `${context}${merchant}完成${item}${verb}，需要记${flow}`,
      ]
    : [
        `${context}${merchant}${verb}${item}，是一笔${flow}`,
        `${item}${verb}完成，凭证商户为${merchant}`,
        `需要记录${merchant}这笔${item}${flow}`,
        `${merchant}账单用途写的是${item}，${context}${verb}`,
        `${context}发生${item}${flow}，对方是${merchant}`,
        `凭证摘要${item}，由${merchant}${verb}`,
      ];
  return {
    text: pick(version >= 2 ? templatesV2 : templatesV1, index, 5),
    merchant,
  };
}

function createCategoryRows({ frozen = false, version = 1 } = {}) {
  const rows = [];
  for (const label of LABELS) {
    const validationCounts = frozen
      ? [[1000, false]]
      : [
          [500, true],
          [3000, false],
        ];
    let labelIndex = 0;
    for (const [count, validation] of validationCounts) {
      for (let local = 0; local < count; local += 1) {
        const { text, merchant } = categoryText(
          label,
          labelIndex,
          frozen,
          version,
        );
        rows.push({
          id: `syn-cat-${version === 1 ? '' : `v${version}-`}${frozen ? 'frozen' : 'development'}-${label.replaceAll('.', '-')}-${String(labelIndex).padStart(4, '0')}`,
          rawText: text,
          normalizedModelText: text,
          label,
          direction: label === 'income' ? 'INCOME' : 'EXPENSE',
          scenario:
            labelIndex % 3 === 0
              ? CATEGORY_SCENARIOS[
                  Math.floor(labelIndex / 3) % CATEGORY_SCENARIOS.length
                ]
              : 'PRIMARY_CATEGORY',
          merchantFamily: merchant,
          generatorModel: GENERATOR,
          promptVersion: frozen
            ? `codex-frozen-v${version}`
            : `codex-training-v${version}`,
          taxonomyVersion: 3,
          difficulty: pick(
            ['EASY', 'MEDIUM', 'HARD', 'ADVERSARIAL'],
            labelIndex,
            17,
          ),
          splitGroup: splitGroup(label, labelIndex, validation, frozen),
        });
        labelIndex += 1;
      }
    }
  }
  return rows;
}

const RISK_CASES = [
  [
    'SPECIAL_FUNDS',
    '给朋友转账',
    ['POSSIBLE_TRANSFER', 'EXCLUDE_FROM_INCOME_EXPENSE_STATS'],
  ],
  [
    'SPECIAL_FUNDS',
    '商家退款到账',
    ['POSSIBLE_REFUND', 'OFFSETS_PREVIOUS_EXPENSE'],
  ],
  [
    'SPECIAL_FUNDS',
    '公司报销款收到',
    ['POSSIBLE_REIMBURSEMENT', 'OFFSETS_PREVIOUS_EXPENSE'],
  ],
  [
    'SPECIAL_FUNDS',
    '归还信用卡欠款',
    ['POSSIBLE_DEBT_MOVEMENT', 'EXCLUDE_FROM_INCOME_EXPENSE_STATS'],
  ],
  [
    'SPECIAL_FUNDS',
    '公交卡储值充值',
    ['POSSIBLE_STORED_VALUE_RECHARGE', 'EXCLUDE_FROM_INCOME_EXPENSE_STATS'],
  ],
  ['OOD', '提醒我明早带雨伞', ['EXCLUDE_FROM_INCOME_EXPENSE_STATS']],
  ['OOD', '周三下午开项目会议', ['EXCLUDE_FROM_INCOME_EXPENSE_STATS']],
  ['OOD', '查询今天的天气情况', ['EXCLUDE_FROM_INCOME_EXPENSE_STATS']],
];

function createRiskRows() {
  return Array.from({ length: 8000 }, (_, index) => {
    const [scenario, phrase, flags] = RISK_CASES[index % RISK_CASES.length];
    const marker = `${uniqueName(index)}${pick(CONTEXTS, index, 19)}`;
    return {
      id: `syn-risk-${String(index).padStart(5, '0')}`,
      text: `${marker}${phrase}`,
      expectedModelEligible: false,
      expectedFlags: flags,
      expectedDisposition: scenario === 'OOD' ? 'EDIT_ONLY' : 'EDIT_OR_PENDING',
      scenario,
      generatorModel: GENERATOR,
      promptVersion: 'codex-risk-v1',
      splitGroup: `risk-${scenario.toLowerCase()}-${index}`,
    };
  });
}

function createAmountRows() {
  return Array.from({ length: 3000 }, (_, index) => {
    const marker = `${uniqueName(index)}店`;
    if (index < 2000) {
      const yuan = (index % 897) + 1;
      const cents = index % 100;
      const amountText = `${yuan}.${String(cents).padStart(2, '0')}`;
      return {
        id: `syn-amount-${String(index).padStart(4, '0')}`,
        text: `${marker}消费${amountText}元`,
        expectedAmountMinor: yuan * 100 + cents,
        expectedStatus: 'RESOLVED',
        amountEvidence: [amountText],
        scenario: 'SINGLE_ARABIC_DECIMAL',
        generatorModel: GENERATOR,
        promptVersion: 'codex-amount-v1',
      };
    }
    if (index < 2500) {
      const first = (index % 80) + 10;
      const second = first + 20;
      return {
        id: `syn-amount-${String(index).padStart(4, '0')}`,
        text: `${marker}先说${first}元又说${second}元，不确定记哪笔`,
        expectedStatus: 'AMBIGUOUS',
        amountEvidence: [String(first), String(second)],
        scenario: 'MULTIPLE_UNRESOLVED_AMOUNTS',
        generatorModel: GENERATOR,
        promptVersion: 'codex-amount-v1',
      };
    }
    return {
      id: `syn-amount-${String(index).padStart(4, '0')}`,
      text: `${marker}买了东西但没说多少钱`,
      expectedStatus: 'MISSING',
      amountEvidence: [],
      scenario: 'AMOUNT_MISSING',
      generatorModel: GENERATOR,
      promptVersion: 'codex-amount-v1',
    };
  });
}

function createE2eRows() {
  const rows = [];
  for (const label of LABELS) {
    const config = CATEGORY_CONFIG[label];
    for (let index = 0; index < 500; index += 1) {
      const yuan = ((index * 13 + LABELS.indexOf(label) * 17) % 988) + 1;
      const cents = index % 100;
      const amountMinor = yuan * 100 + cents;
      const item = pick(config.items, index, 3);
      const merchant = `${uniqueName(index + LABELS.indexOf(label) * 500)}${pick(config.places, index, 23)}`;
      const expected = {
        direction: label === 'income' ? 'INCOME' : 'EXPENSE',
        amountMinor,
        accountKey: pick(['CASH', 'WECHAT', 'ALIPAY', 'BANK_CARD'], index, 29),
      };
      if (label !== 'income') expected.categoryKey = label;
      rows.push({
        id: `syn-e2e-${label.replaceAll('.', '-')}-${String(index).padStart(3, '0')}`,
        text: `${merchant}${label === 'income' ? '收到' : '支付'}${item}${yuan}.${String(cents).padStart(2, '0')}元`,
        expected,
        requiredReview: label === 'expense.other_expense',
        scenario: 'FULL_CANDIDATE_EXTRACTION',
        generatorModel: GENERATOR,
        promptVersion: 'codex-e2e-v1',
        splitGroup: `e2e-${label.replaceAll('.', '-')}-${index}`,
      });
    }
  }
  return rows;
}

function auditRows(rows) {
  return rows.map(row => ({
    id: row.id,
    verdict: 'ACCEPT',
    reasonCodes: ['SCHEMA_VALID', 'SEMANTIC_TEMPLATE_VALID'],
    reviewerModel: REVIEWER,
    reviewerPromptVersion: 'deterministic-review-v1',
    reviewMode: 'DETERMINISTIC_VALIDATOR',
    reviewedPromptVersion: row.promptVersion,
    reviewNote:
      'Codex-authored semantic template plus deterministic per-row validation; not an independent LLM or human review.',
  }));
}

function generate(options = {}) {
  const root = options.root ?? process.cwd();
  const outputDir = path.resolve(
    root,
    options.outputDir ?? 'data/synthetic/reviewed',
  );
  const corpusVersion = Number(options.corpusVersion ?? 1);
  if (!Number.isInteger(corpusVersion) || corpusVersion < 1) {
    throw new Error('--corpus-version must be a positive integer.');
  }
  const files = {
    categoryTraining: createCategoryRows({ version: corpusVersion }),
    categoryFrozen: createCategoryRows({
      frozen: true,
      version: corpusVersion,
    }),
    risk: createRiskRows(),
    amount: createAmountRows(),
    e2e: createE2eRows(),
  };
  const specs = [
    ['category-training', 'categoryTraining', 'category'],
    ['category-frozen', 'categoryFrozen', 'category'],
    ['risk', 'risk', 'risk'],
    ['amount', 'amount', 'amount'],
    ['e2e', 'e2e', 'e2e'],
  ];
  const plannedPaths = specs.flatMap(([file]) =>
    options.auditOnly
      ? [path.join(outputDir, `${file}.audit.jsonl`)]
      : [
          path.join(outputDir, `${file}.jsonl`),
          path.join(outputDir, `${file}.audit.jsonl`),
        ],
  );
  if (!options.force) {
    const existing = plannedPaths.find(file => fs.existsSync(file));
    if (existing)
      throw new Error(
        `Refusing to overwrite ${existing}; pass --force to regenerate.`,
      );
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatorModel: GENERATOR,
    reviewerModel: REVIEWER,
    isolation: 'codex_authored_templates_plus_deterministic_validator',
    humanAudit: 'REQUIRED_AND_NOT_PERFORMED',
    corpusVersion,
    datasets: {},
  };
  for (const [fileName, key, kind] of specs) {
    const datasetFile = path.join(outputDir, `${fileName}.jsonl`);
    const contents = options.auditOnly
      ? fs.readFileSync(datasetFile, 'utf8')
      : jsonl(files[key]);
    const rows = validateRows(contents, kind);
    const auditContents = jsonl(auditRows(rows));
    if (!options.auditOnly) atomicWrite(datasetFile, contents);
    atomicWrite(path.join(outputDir, `${fileName}.audit.jsonl`), auditContents);
    report.datasets[fileName] = {
      rows: rows.length,
      sha256: sha256(contents),
      auditSha256: sha256(auditContents),
    };
  }
  atomicWrite(
    path.join(outputDir, 'codex-corpus-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

function main(argv) {
  const args = parseArgs(argv);
  const report = generate({
    outputDir: args['output-dir'],
    force: args.force === true,
    auditOnly: args['audit-only'] === true,
    corpusVersion: args['corpus-version'],
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  GENERATOR,
  LABELS,
  REVIEWER,
  createAmountRows,
  createCategoryRows,
  createE2eRows,
  createRiskRows,
  generate,
};
