const fs = require('node:fs');
const path = require('node:path');

const { runClaudeStructured } = require('./llm-provider.cjs');
const {
  atomicWrite,
  jsonl,
  parseArgs,
  positiveNumber,
  readJson,
} = require('./pipeline-utils.cjs');
const { validateRows } = require('./validate-dataset.cjs');

const KINDS = new Set(['category', 'amount', 'risk', 'e2e']);
const FILE_PREFIX = {
  category: 'cat',
  amount: 'amount',
  risk: 'risk',
  e2e: 'e2e',
};
const REQUIRED_CATEGORY_SCENARIOS = [
  'VENUE_VS_ITEM',
  'BROAD_PLATFORM',
  'ASR_HOMOPHONE',
  'CATEGORY_BOUNDARY',
  'INSUFFICIENT_INFORMATION',
  'NEW_MERCHANT',
];
const REQUIRED_RISK_SCENARIOS = ['SPECIAL_FUNDS', 'OOD'];

function rowSchema(kind, root) {
  const schema = readJson(
    path.join(root, 'data', 'synthetic', 'schemas', `${kind}.schema.json`),
  );
  delete schema.$schema;
  delete schema.$id;
  return schema;
}

function batchSchema(kind, root, count) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['rows'],
    properties: {
      rows: {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: rowSchema(kind, root),
      },
    },
  };
}

function kindInstructions(kind) {
  if (kind === 'category') {
    return `分类标签只能是 income 或八个支出标签：expense.food、expense.transport、expense.shopping、expense.housing、expense.entertainment、expense.healthcare、expense.education、expense.other_expense。收入不细分。label=income 时 direction=INCOME，否则为 EXPENSE。normalizedModelText 保留有分类价值的商户/物品/场景词，去掉金额、时间、账户、支付方式。覆盖短文本、自然口语、账单摘要和 ASR 噪声，避免模板换数字式重复。scenario 使用指定的难例名称或其他稳定英文场景名。`;
  }
  if (kind === 'amount') {
    return '生成金额解析边界样本，覆盖阿拉伯数字、中文数字、口语、小数、多金额歧义和无金额。RESOLVED 必须有唯一 expectedAmountMinor；AMBIGUOUS/MISSING 不得臆造金额。';
  }
  if (kind === 'risk') {
    return '只生成不应直接进入普通九类模型的资金语义：转账、退款、报销、借还款、储值充值及明显非账单文本。expectedModelEligible 必须为 false，并准确填写语义 flags。';
  }
  return '生成完整账单候选样本。expected 只包含收入/支出方向、整数分金额、支出一级分类以及可选账户线索；特殊资金或歧义文本 requiredReview=true。收入不得带 categoryKey。';
}

function generationPrompt({ kind, count, model, promptVersion, startIndex }) {
  const requiredScenarios =
    kind === 'category'
      ? [
          REQUIRED_CATEGORY_SCENARIOS[
            Math.floor(startIndex / 9) % REQUIRED_CATEGORY_SCENARIOS.length
          ],
        ]
      : kind === 'risk'
        ? [
            REQUIRED_RISK_SCENARIOS[
              Math.floor(startIndex / 9) % REQUIRED_RISK_SCENARIOS.length
            ],
          ]
        : [];
  const scenarioInstruction =
    requiredScenarios.length === 0
      ? ''
      : ` 本批第 1 条的 scenario 必须为 ${requiredScenarios[0]}，且 splitGroup 必须包含具体语义或商户族，不能只写 scenario 名称。`;
  return `你是中文个人记账合成数据生成器。生成 ${count} 条相互独立、自然、多样、无真实个人信息的数据。\n${kindInstructions(kind)}\n严格遵守给定 JSON Schema。ID 从 syn-${FILE_PREFIX[kind]}-${String(startIndex + 1).padStart(7, '0')} 起连续编号。generatorModel 固定为 ${model}，promptVersion 固定为 ${promptVersion}。scenario 使用稳定的英文场景族名称；同一商户/语义模板的改写必须共享 splitGroup，避免跨数据集泄漏。${scenarioInstruction}不要解释，只返回结构化结果。`;
}

function normalizeRows(rows, { kind, model, promptVersion, startIndex }) {
  return rows.map((row, offset) => ({
    ...row,
    id: `syn-${FILE_PREFIX[kind]}-${String(startIndex + offset + 1).padStart(7, '0')}`,
    generatorModel: model,
    promptVersion,
    ...(kind === 'category' ? { taxonomyVersion: 3 } : {}),
  }));
}

function generate(options, dependencies = {}) {
  const root = options.root ?? process.cwd();
  const kind = options.kind;
  if (!KINDS.has(kind))
    throw new Error('--kind must be category, amount, risk, or e2e.');
  if (typeof options.output !== 'string')
    throw new Error('--output is required.');
  if (typeof options.model !== 'string')
    throw new Error('--model is required.');
  const count = positiveNumber(options.count, 'count', { integer: true });
  const batchSize = Math.min(
    50,
    positiveNumber(options.batchSize ?? 20, 'batch-size', { integer: true }),
  );
  const maxBudgetUsd = positiveNumber(options.maxBudgetUsd, 'max-budget-usd');
  const promptVersion = options.promptVersion ?? 'training-v1';
  const output = path.resolve(root, options.output);
  let rows = [];
  if (fs.existsSync(output)) {
    if (!options.resume)
      throw new Error(`${output} already exists; pass --resume to continue.`);
    rows = validateRows(fs.readFileSync(output, 'utf8'), kind);
  }
  if (rows.length > count)
    throw new Error('Existing output already exceeds requested count.');

  const invoke = dependencies.invoke ?? runClaudeStructured;
  let remainingBudget = maxBudgetUsd;
  while (rows.length < count) {
    const requested = Math.min(batchSize, count - rows.length);
    const batchesRemaining = Math.ceil((count - rows.length) / batchSize);
    const callBudget = Number((remainingBudget / batchesRemaining).toFixed(6));
    if (!(callBudget > 0))
      throw new Error('LLM budget exhausted before generation completed.');
    const response = invoke({
      prompt: generationPrompt({
        kind,
        count: requested,
        model: options.model,
        promptVersion,
        startIndex: rows.length,
      }),
      schema: batchSchema(kind, root, requested),
      model: options.model,
      maxBudgetUsd: callBudget,
      cwd: root,
    });
    if (
      !Array.isArray(response.value.rows) ||
      response.value.rows.length !== requested
    ) {
      throw new Error(
        `LLM returned ${response.value.rows?.length ?? 0} rows; expected ${requested}.`,
      );
    }
    const next = normalizeRows(response.value.rows, {
      kind,
      model: response.model ?? options.model,
      promptVersion,
      startIndex: rows.length,
    });
    const combined = [...rows, ...next];
    validateRows(jsonl(combined), kind);
    atomicWrite(output, jsonl(combined));
    rows = combined;
    remainingBudget -= response.costUsd ?? callBudget;
    process.stdout.write(
      `Generated ${rows.length}/${count} ${kind} rows; budget remaining $${Math.max(0, remainingBudget).toFixed(4)}.\n`,
    );
  }
  return rows;
}

function main(argv) {
  const args = parseArgs(argv);
  return generate({
    kind: args.kind,
    output: args.output,
    count: args.count,
    model: args.model,
    maxBudgetUsd: args['max-budget-usd'],
    batchSize: args['batch-size'],
    promptVersion: args['prompt-version'],
    resume: args.resume === true,
  });
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { batchSchema, generate, generationPrompt, normalizeRows };
