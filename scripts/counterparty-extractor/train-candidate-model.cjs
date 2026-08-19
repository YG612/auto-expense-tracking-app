const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('../synthetic-data/pipeline-utils.cjs');
const {
  generateCounterpartyCandidates,
  hasTransactionEvidence,
  markedCandidateText,
} = require('./candidate-generator.cjs');

const LABELS = ['PRIMARY_NAMED', 'PRIMARY_GENERIC', 'NOT_COUNTERPARTY'];
const CONFIGS = [
  { name: 'compact', dim: 24, epoch: 30, lr: 0.35, bucket: 20000 },
  { name: 'balanced', dim: 40, epoch: 40, lr: 0.25, bucket: 30000 },
];

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status}): ${result.stderr ?? ''}`,
    );
  }
  return result.stdout ?? '';
}

function readJsonLines(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function checkedDataset(datasetDir) {
  const manifestFile = path.join(datasetDir, 'manifest.json');
  const manifestText = fs.readFileSync(manifestFile, 'utf8');
  const manifest = JSON.parse(manifestText);
  const rows = {};
  for (const split of ['train', 'validation', 'frozenTest']) {
    const spec = manifest.files?.[split];
    if (spec === undefined) throw new Error(`Dataset is missing ${split}.`);
    const file = path.join(datasetDir, spec.file);
    const contents = fs.readFileSync(file, 'utf8');
    if (sha256(contents) !== spec.sha256) {
      throw new Error(`Dataset hash mismatch: ${split}`);
    }
    rows[split] = readJsonLines(file);
  }
  return { manifest, manifestSha256: sha256(manifestText), rows };
}

function exactGold(candidate, gold) {
  return (
    gold !== null &&
    candidate.start === gold.start &&
    candidate.end === gold.end &&
    candidate.text === gold.text
  );
}

function candidateRows(transactions, training) {
  return transactions.flatMap(transaction => {
    const candidates = generateCounterpartyCandidates(transaction.text);
    const mapped = candidates.map((candidate, index) => {
      const positive = exactGold(candidate, transaction.counterparty);
      return {
        id: `${transaction.id}:candidate:${index}`,
        transactionId: transaction.id,
        scenario: transaction.scenario,
        difficulty: transaction.difficulty,
        text: transaction.text,
        candidate,
        modelText: markedCandidateText(transaction.text, candidate),
        label: positive
          ? transaction.counterparty.specificity === 'GENERIC'
            ? 'PRIMARY_GENERIC'
            : 'PRIMARY_NAMED'
          : 'NOT_COUNTERPARTY',
      };
    });
    if (!training) return mapped;
    const positives = mapped.filter(row => row.label !== 'NOT_COUNTERPARTY');
    const negatives = mapped.filter(row => row.label === 'NOT_COUNTERPARTY');
    const hardNegative = [
      'HARD_BRAND_PRODUCT',
      'HARD_ROUTE_LOCATION',
      'HARD_CHANNEL',
      'HARD_COMPANION',
      'HARD_MULTI_ENTITY',
      'HARD_NO_TRANSACTION',
      'HARD_BENEFICIARY',
      'HARD_NEGATION',
      'HARD_LOCATION',
    ].includes(transaction.difficulty);
    const negativeLimit = hardNegative ? 12 : 4;
    return [...positives, ...negatives.slice(0, negativeLimit)];
  });
}

function trainingLine(row) {
  return `__label__${row.label} ${row.modelText.replace(/[\r\n]+/gu, ' ')}`;
}

function parsePredictions(stdout, rows) {
  const lines = stdout.split(/\r?\n/u).filter(Boolean);
  if (lines.length !== rows.length) {
    throw new Error(
      `Expected ${rows.length} predictions, received ${lines.length}.`,
    );
  }
  return rows.map((row, index) => {
    const fields = lines[index].trim().split(/\s+/u);
    const probabilities = Object.fromEntries(LABELS.map(label => [label, 0]));
    for (let field = 0; field < fields.length; field += 2) {
      const label = fields[field].replace(/^__label__/u, '');
      probabilities[label] = Number(fields[field + 1]);
    }
    const total = LABELS.reduce((sum, label) => sum + probabilities[label], 0);
    for (const label of LABELS) {
      probabilities[label] =
        total > 0 ? probabilities[label] / total : 1 / LABELS.length;
    }
    return { ...row, probabilities };
  });
}

function transactionPredictions(transactions, predictions) {
  const byTransaction = new Map();
  for (const prediction of predictions) {
    const list = byTransaction.get(prediction.transactionId) ?? [];
    list.push(prediction);
    byTransaction.set(prediction.transactionId, list);
  }
  return transactions.map(transaction => {
    const candidates = byTransaction.get(transaction.id) ?? [];
    const deterministicSourceRank = {
      EXPLICIT_FIELD: 5,
      DIRECT_PARTY: 4,
      INCOME_PARTY: 4,
      SOURCE_OR_PROVIDER: 3,
      VENUE: 2,
      ARRIVAL_VENUE: 2,
      PURCHASED_NAMED_OBJECT: 2,
      TRANSACTION_PLATFORM: 1,
    };
    const deterministic = candidates
      .filter(
        candidate => deterministicSourceRank[candidate.candidate.source] > 0,
      )
      .filter(
        candidate =>
          !/^(?:一笔|一款|这笔|款项|钱|金额|退款|付款|支付|工资|奖金)$/u.test(
            candidate.candidate.text,
          ),
      )
      .filter(candidate => {
        if (!['VENUE', 'ARRIVAL_VENUE'].includes(candidate.candidate.source)) {
          return true;
        }
        if (
          /在.{2,20}(?:隔壁|旁边|附近|门口|对面|楼上|楼下).{0,12}(?:买|购买|消费|吃|喝|购物)/u.test(
            transaction.text,
          )
        ) {
          return false;
        }
        const hasPlatformBeforeVenue = candidates.some(
          other =>
            other.candidate.source === 'TRANSACTION_PLATFORM' &&
            other.candidate.end <= candidate.candidate.start,
        );
        if (
          /动车|高铁|火车|飞机|列车|车票|机票|行程/u.test(transaction.text) &&
          !/^(?:铁路)?12306$/u.test(candidate.candidate.text)
        ) {
          return false;
        }
        return (
          hasPlatformBeforeVenue ||
          /^(?:铁路)?12306$/u.test(candidate.candidate.text) ||
          /(?:店|馆|吧|餐厅|餐馆|面馆|咖啡|酒店|客栈|影城|花店|诊所|牙科|药房|书房|书屋|超市|便利店|健身房|旅行社|照相馆|汽修厂|烘焙坊|洗车行|茶室|生鲜)$/u.test(
            candidate.candidate.text,
          )
        );
      })
      .filter(
        candidate =>
          candidate.candidate.source !== 'PURCHASED_NAMED_OBJECT' ||
          (!/^(?:的|了)/u.test(candidate.candidate.text) &&
            /淘宝|天猫|京东|拼多多|美团|饿了么|携程/u.test(transaction.text) &&
            /(?:店|馆|吧|餐厅|餐馆|面馆|咖啡|酒店|客栈|影城|花店|诊所|牙科|药房|书房|书屋|超市|便利店|健身房|旅行社|照相馆|汽修厂|烘焙坊|洗车行|茶室|生鲜)$/u.test(
              candidate.candidate.text,
            ) &&
            !/股票|基金|债券|代金券|礼品卡|联名|周边|证券/u.test(
              transaction.text,
            )),
      )
      .filter(candidate => {
        if (candidate.candidate.source !== 'TRANSACTION_PLATFORM') return true;
        const hasSpecificVenue = candidates.some(
          other =>
            ['VENUE', 'ARRIVAL_VENUE'].includes(other.candidate.source) &&
            !(
              other.candidate.start <= candidate.candidate.start &&
              other.candidate.end >= candidate.candidate.end
            ) &&
            !(
              /动车|高铁|火车|飞机|列车|车票|机票|行程/u.test(
                transaction.text,
              ) && !/^(?:铁路)?12306$/u.test(other.candidate.text)
            ),
        );
        const compactText = transaction.text.replace(/\s+/gu, '');
        const negated = ['不是', '并非', '没用', '没有用'].some(prefix =>
          compactText.includes(`${prefix}${candidate.candidate.text}`),
        );
        return !hasSpecificVenue && !negated;
      })
      .sort(
        (left, right) =>
          deterministicSourceRank[right.candidate.source] -
            deterministicSourceRank[left.candidate.source] ||
          (left.candidate.source === 'TRANSACTION_PLATFORM' &&
          right.candidate.source === 'TRANSACTION_PLATFORM'
            ? right.candidate.text.length - left.candidate.text.length
            : left.candidate.text.length - right.candidate.text.length) ||
          left.candidate.start - right.candidate.start,
      )[0];
    const ranked = candidates
      .map(candidate => ({
        ...candidate,
        primaryScore:
          /股票|基金|债券|保险产品|理财产品|代金券|优惠券|礼品卡|会员卡|储值卡|联名|周边|证券/u.test(
            transaction.text,
          ) ||
          (/在.{2,20}(?:隔壁|旁边|附近|门口|对面|楼上|楼下).{0,12}(?:买|购买|消费|吃|喝|购物)/u.test(
            transaction.text,
          ) &&
            !['EXPLICIT_FIELD', 'DIRECT_PARTY', 'INCOME_PARTY'].includes(
              candidate.candidate.source,
            )) ||
          (/机场.*(?:飞往|航班|机票|起飞|降落)|(?:飞往|航班|机票|起飞|降落).*机场/u.test(
            transaction.text,
          ) &&
            candidate.candidate.source !== 'TRANSACTION_PLATFORM') ||
          ((/站$/u.test(candidate.candidate.text) ||
            [
              'ROUTE_ORIGIN',
              'ROUTE_DESTINATION',
              'PURCHASED_NAMED_OBJECT',
            ].includes(candidate.candidate.source)) &&
            /开往|从.+到|去.+(?:动车|高铁|火车|飞机)|动车|高铁|火车|飞机|车票|机票|出发|终点/u.test(
              transaction.text,
            )) ||
          (/(?:^|[,，。；;])(?:给|帮|替).{2,8}(?:买|购买|订|交)/u.test(
            transaction.text,
          ) &&
            !candidates.some(other =>
              ['VENUE', 'ARRIVAL_VENUE'].includes(other.candidate.source),
            )) ||
          (/^(?:公司|学校|医院|小区|单位).{0,4}(?:楼下|附近|旁边|门口)(?:买|购买|消费|吃|喝)/u.test(
            transaction.text,
          ) &&
            !candidates.some(
              other =>
                ['VENUE', 'ARRIVAL_VENUE'].includes(other.candidate.source) &&
                /(?:店|馆|吧|餐厅|餐馆|面馆|咖啡|酒店|影城|花店|诊所|药房|书房|书屋|超市|便利店)$/u.test(
                  other.candidate.text,
                ),
            ))
            ? 0
            : candidate.probabilities.PRIMARY_NAMED +
              candidate.probabilities.PRIMARY_GENERIC,
      }))
      .sort(
        (left, right) =>
          right.primaryScore - left.primaryScore ||
          right.candidate.text.length - left.candidate.text.length ||
          left.candidate.start - right.candidate.start,
      );
    return {
      transaction,
      candidates,
      best: !hasTransactionEvidence(transaction.text)
        ? undefined
        : deterministic === undefined
          ? ranked[0]
          : {
              ...deterministic,
              primaryScore: 1,
              resolutionSource: 'DETERMINISTIC_ROLE',
            },
      candidateContainsGold: candidates.some(candidate =>
        exactGold(candidate.candidate, transaction.counterparty),
      ),
    };
  });
}

function metricsAt(rows, threshold) {
  let goldTransactions = 0;
  let candidateHits = 0;
  let accepted = 0;
  let correct = 0;
  let noGold = 0;
  let noGoldAccepted = 0;
  const slices = new Map();
  for (const row of rows) {
    const hasGold = row.transaction.counterparty !== null;
    if (hasGold) goldTransactions += 1;
    else noGold += 1;
    if (row.candidateContainsGold) candidateHits += 1;
    const predicted =
      row.best !== undefined && row.best.primaryScore >= threshold;
    const exact =
      predicted && exactGold(row.best.candidate, row.transaction.counterparty);
    if (predicted) accepted += 1;
    if (exact) correct += 1;
    if (!hasGold && predicted) noGoldAccepted += 1;
    const key = row.transaction.difficulty;
    const slice = slices.get(key) ?? {
      rows: 0,
      gold: 0,
      candidateHits: 0,
      accepted: 0,
      correct: 0,
      noGold: 0,
      falsePositives: 0,
    };
    slice.rows += 1;
    if (hasGold) slice.gold += 1;
    else slice.noGold += 1;
    if (row.candidateContainsGold) slice.candidateHits += 1;
    if (predicted) slice.accepted += 1;
    if (exact) slice.correct += 1;
    if (!hasGold && predicted) slice.falsePositives += 1;
    slices.set(key, slice);
  }
  return {
    threshold,
    transactions: rows.length,
    goldTransactions,
    candidateRecall:
      goldTransactions === 0 ? 1 : candidateHits / goldTransactions,
    accepted,
    coverage: rows.length === 0 ? 0 : accepted / rows.length,
    exactPrecision: accepted === 0 ? 1 : correct / accepted,
    exactRecall: goldTransactions === 0 ? 1 : correct / goldTransactions,
    noCounterpartyFalsePositiveRate: noGold === 0 ? 0 : noGoldAccepted / noGold,
    slices: Object.fromEntries(
      [...slices.entries()].map(([key, value]) => [
        key,
        {
          ...value,
          precision: value.accepted === 0 ? 1 : value.correct / value.accepted,
          recall: value.gold === 0 ? 1 : value.correct / value.gold,
          candidateRecall:
            value.gold === 0 ? 1 : value.candidateHits / value.gold,
          noCounterpartyFalsePositiveRate:
            value.noGold === 0 ? 0 : value.falsePositives / value.noGold,
        },
      ]),
    ),
  };
}

function selectThreshold(rows) {
  const candidates = [];
  for (let value = 5; value <= 99; value += 1) {
    const metrics = metricsAt(rows, value / 100);
    if (
      metrics.exactPrecision >= 0.95 &&
      metrics.noCounterpartyFalsePositiveRate <= 0.01
    ) {
      candidates.push(metrics);
    }
  }
  return candidates.sort(
    (left, right) =>
      right.exactRecall - left.exactRecall ||
      right.coverage - left.coverage ||
      left.threshold - right.threshold,
  )[0];
}

function train(options = {}) {
  const root = options.root ?? process.cwd();
  const datasetDir = path.resolve(
    root,
    options.datasetDir ?? 'data/synthetic/work/counterparty-v1',
  );
  const outputDir = path.resolve(
    root,
    options.outputDir ??
      path.join('build', 'model-candidates', `counterparty-v1-${Date.now()}`),
  );
  if (fs.existsSync(outputDir))
    throw new Error(`Output already exists: ${outputDir}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const dataset = checkedDataset(datasetDir);
  const trainRows = candidateRows(dataset.rows.train, true);
  const validationRows = candidateRows(dataset.rows.validation, false);
  const frozenRows = candidateRows(dataset.rows.frozenTest, false);
  if (!trainRows.some(row => row.label === 'PRIMARY_NAMED')) {
    throw new Error('Training data contains no named counterparties.');
  }
  const trainFile = path.join(outputDir, 'train.txt');
  atomicWrite(trainFile, `${trainRows.map(trainingLine).join('\n')}\n`);
  const tool = path.join(
    root,
    'build',
    'bill-classifier-tools',
    process.platform === 'win32' ? 'fasttext-qingji.exe' : 'fasttext-qingji',
  );
  if (!fs.existsSync(tool)) {
    throw new Error(
      'fastText training tool is missing; run bill-classifier training setup first.',
    );
  }

  const validationInput = path.join(outputDir, 'validation.txt');
  const frozenInput = path.join(outputDir, 'frozen-test.txt');
  atomicWrite(
    validationInput,
    `${validationRows.map(row => row.modelText).join('\n')}\n`,
  );
  atomicWrite(
    frozenInput,
    `${frozenRows.map(row => row.modelText).join('\n')}\n`,
  );
  const competition = [];
  for (const config of CONFIGS) {
    const modelBase = path.join(outputDir, config.name);
    run(
      tool,
      [
        'supervised',
        '-input',
        trainFile,
        '-output',
        modelBase,
        '-dim',
        String(config.dim),
        '-epoch',
        String(config.epoch),
        '-lr',
        String(config.lr),
        '-minn',
        '2',
        '-maxn',
        '5',
        '-wordNgrams',
        '2',
        '-bucket',
        String(config.bucket),
        '-minCount',
        '1',
        '-loss',
        'softmax',
        '-thread',
        '1',
        '-verbose',
        '0',
      ],
      root,
    );
    const validationOutput = run(
      tool,
      [
        'predict-prob',
        `${modelBase}.bin`,
        validationInput,
        String(LABELS.length),
      ],
      root,
      true,
    );
    const validationPredictions = transactionPredictions(
      dataset.rows.validation,
      parsePredictions(validationOutput, validationRows),
    );
    const operatingPoint = selectThreshold(validationPredictions);
    competition.push({
      config,
      modelBase,
      operatingPoint,
      validationPredictions,
    });
  }
  competition.sort((left, right) => {
    if (left.operatingPoint === undefined) return 1;
    if (right.operatingPoint === undefined) return -1;
    return (
      right.operatingPoint.exactRecall - left.operatingPoint.exactRecall ||
      right.operatingPoint.coverage - left.operatingPoint.coverage
    );
  });
  const winner = competition[0];
  if (winner?.operatingPoint === undefined) {
    throw new Error(
      'No candidate model reached the validation precision gate.',
    );
  }
  const frozenOutput = run(
    tool,
    [
      'predict-prob',
      `${winner.modelBase}.bin`,
      frozenInput,
      String(LABELS.length),
    ],
    root,
    true,
  );
  const frozenPredictions = transactionPredictions(
    dataset.rows.frozenTest,
    parsePredictions(frozenOutput, frozenRows),
  );
  const frozenMetrics = metricsAt(
    frozenPredictions,
    winner.operatingPoint.threshold,
  );
  const selectedModel = path.join(outputDir, 'counterparty-candidate-v1.bin');
  fs.copyFileSync(`${winner.modelBase}.bin`, selectedModel);
  const modelBytes = fs.readFileSync(selectedModel);
  const challengeMetrics = frozenMetrics.slices.HARD_OUT_OF_TEMPLATE;
  const challengePassed =
    challengeMetrics !== undefined &&
    challengeMetrics.precision >= 0.95 &&
    challengeMetrics.recall >= 0.9 &&
    challengeMetrics.noCounterpartyFalsePositiveRate <= 0.02;
  const report = {
    schemaVersion: 1,
    experimentId: 'counterparty-candidate-fasttext-v1',
    status:
      frozenMetrics.exactPrecision >= 0.95 &&
      frozenMetrics.noCounterpartyFalsePositiveRate <= 0.02 &&
      challengePassed
        ? 'EXPERIMENT_GATE_PASSED'
        : 'EXPERIMENT_GATE_FAILED',
    labels: LABELS,
    datasetManifestSha256: dataset.manifestSha256,
    data: {
      transactions: Object.fromEntries(
        Object.entries(dataset.rows).map(([key, value]) => [key, value.length]),
      ),
      candidateRows: {
        train: trainRows.length,
        validation: validationRows.length,
        frozenTest: frozenRows.length,
      },
    },
    winner: winner.config,
    validation: winner.operatingPoint,
    frozenTest: frozenMetrics,
    model: {
      file: path.basename(selectedModel),
      sizeBytes: modelBytes.length,
      sha256: crypto.createHash('sha256').update(modelBytes).digest('hex'),
    },
    limitations: [
      '训练和冻结测试均为同一生成规范下的纯合成数据，不能代表真实用户分布。',
      '候选生成器未召回的商户无法由候选判别模型恢复。',
      '模型尚未接入移动端或现有记账解析流程。',
    ],
  };
  atomicWrite(
    path.join(outputDir, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  atomicWrite(
    path.join(outputDir, 'frozen-predictions.jsonl'),
    jsonl(
      frozenPredictions.map(row => ({
        id: row.transaction.id,
        scenario: row.transaction.scenario,
        difficulty: row.transaction.difficulty,
        expected: row.transaction.counterparty,
        candidateContainsGold: row.candidateContainsGold,
        predicted:
          row.best !== undefined &&
          row.best.primaryScore >= winner.operatingPoint.threshold
            ? { ...row.best.candidate, score: row.best.primaryScore }
            : null,
      })),
    ),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function main(argv) {
  const args = parseArgs(argv);
  train({ datasetDir: args['dataset-dir'], outputDir: args['output-dir'] });
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
  candidateRows,
  checkedDataset,
  metricsAt,
  parsePredictions,
  selectThreshold,
  train,
  transactionPredictions,
};
