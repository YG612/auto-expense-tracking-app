const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildTrainingTool } = require('./train-unified-model.cjs');

const root = path.resolve(__dirname, '..', '..');
const outputRoot = path.join(root, 'build', 'bill-classifier-native-smoke');
const output = path.join(
  outputRoot,
  process.platform === 'win32' ? 'core-smoke.exe' : 'core-smoke',
);
fs.mkdirSync(outputRoot, { recursive: true });

const fastTextRoot = path.join(root, 'third_party', 'fasttext', 'src');
const classifierRoot = path.join(root, 'native', 'bill-classifier');
const sources = [
  'args.cc',
  'matrix.cc',
  'dictionary.cc',
  'loss.cc',
  'productquantizer.cc',
  'densematrix.cc',
  'quantmatrix.cc',
  'vector.cc',
  'model.cc',
  'utils.cc',
  'meter.cc',
  'fasttext.cc',
].map(file => path.join(fastTextRoot, file));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}.`);
  }
}

run(process.env.CXX || 'g++', [
  '-std=c++17',
  '-O2',
  '-DNDEBUG',
  '-DQINGJI_FASTTEXT_SINGLE_THREAD',
  `-I${fastTextRoot}`,
  `-I${classifierRoot}`,
  path.join(__dirname, 'core-smoke.cc'),
  path.join(classifierRoot, 'OnDeviceBillClassifierCore.cc'),
  ...sources,
  '-o',
  output,
]);
run(output, [path.join(root, 'models', 'bill-classifier')]);

// Exercise the schema-v2 single-head branch with an isolated toy model. This
// fixture is only a native contract test; it is never copied into model assets
// and cannot satisfy the production dataset/model gates.
const unifiedRoot = path.join(root, 'build', 'bill-classifier-unified-smoke');
fs.mkdirSync(unifiedRoot, { recursive: true });
const trainingFile = path.join(unifiedRoot, 'toy.train.txt');
const examples = {
  income: ['工资到账', '奖金收入', '兼职收款'],
  'expense.food': ['盖饭午餐', '早餐面包', '晚餐米饭'],
  'expense.transport': ['地铁车票', '公交出行', '出租车费'],
  'expense.shopping': ['购买衣服', '网购日用品', '商场买鞋'],
  'expense.housing': ['支付房租', '物业费用', '家庭水费'],
  'expense.entertainment': ['电影门票', '游戏消费', '演出门票'],
  'expense.healthcare': ['医院挂号', '药店买药', '体检费用'],
  'expense.education': ['购买教材', '课程学费', '考试报名'],
  'expense.other_expense': ['其他杂费', '临时支出', '未知消费'],
};
fs.writeFileSync(
  trainingFile,
  `${Object.entries(examples)
    .flatMap(([label, texts]) =>
      texts.flatMap(text =>
        Array.from({ length: 4 }, () => `__label__${label} ${text}`),
      ),
    )
    .join('\n')}\n`,
);
const trainingTool = path.join(
  root,
  'build',
  'bill-classifier-tools',
  process.platform === 'win32' ? 'fasttext-qingji.exe' : 'fasttext-qingji',
);
buildTrainingTool(root, trainingTool);
const toyOutput = path.join(unifiedRoot, 'category-v3');
run(trainingTool, [
  'supervised',
  '-input',
  trainingFile,
  '-output',
  toyOutput,
  '-dim',
  '16',
  '-epoch',
  '120',
  '-lr',
  '0.8',
  '-minn',
  '2',
  '-maxn',
  '5',
  '-bucket',
  '2000',
  '-minCount',
  '1',
  '-loss',
  'softmax',
  '-thread',
  '1',
  '-verbose',
  '0',
]);
run(trainingTool, [
  'quantize',
  '-input',
  trainingFile,
  '-output',
  toyOutput,
  '-qnorm',
  '-retrain',
  '-dsub',
  '2',
  '-thread',
  '1',
  '-verbose',
  '0',
]);
const unifiedSmoke = path.join(
  unifiedRoot,
  process.platform === 'win32'
    ? 'unified-core-smoke.exe'
    : 'unified-core-smoke',
);
run(process.env.CXX || 'g++', [
  '-std=c++17',
  '-O2',
  '-DNDEBUG',
  '-DQINGJI_FASTTEXT_SINGLE_THREAD',
  `-I${fastTextRoot}`,
  `-I${classifierRoot}`,
  path.join(__dirname, 'unified-core-smoke.cc'),
  path.join(classifierRoot, 'OnDeviceBillClassifierCore.cc'),
  ...sources,
  '-o',
  unifiedSmoke,
]);
run(unifiedSmoke, [unifiedRoot]);
