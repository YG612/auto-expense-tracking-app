const fs = require('node:fs');
const path = require('node:path');

const { runClaudeStructured } = require('./llm-provider.cjs');
const {
  atomicWrite,
  jsonl,
  parseArgs,
  positiveNumber,
} = require('./pipeline-utils.cjs');
const { validateRows } = require('./validate-dataset.cjs');

function reviewSchema(ids) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['decisions'],
    properties: {
      decisions: {
        type: 'array',
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'verdict', 'reasonCodes'],
          properties: {
            id: { enum: ids },
            verdict: { enum: ['ACCEPT', 'REJECT'] },
            reasonCodes: {
              type: 'array',
              uniqueItems: true,
              items: {
                enum: [
                  'OK',
                  'WRONG_LABEL',
                  'WRONG_AMOUNT',
                  'WRONG_DIRECTION',
                  'AMBIGUOUS_GROUND_TRUTH',
                  'UNNATURAL_TEXT',
                  'PRIVACY_RISK',
                  'DUPLICATE_TEMPLATE',
                  'SCHEMA_SEMANTICS',
                ],
              },
            },
            note: { type: 'string', maxLength: 240 },
          },
        },
      },
    },
  };
}

function reviewPrompt(kind, rows) {
  return `你是与生成器会话隔离的中文记账数据审校员。逐条检查 ${kind} 数据的文本自然度、标签/方向/金额语义、歧义、隐私和模板重复。不要修正数据，只能 ACCEPT 或 REJECT。只在全部关键字段能由文本唯一支持且文本自然时 ACCEPT；合成数据中的人名、电话、卡号等疑似真实标识一律拒绝。每个输入 ID 必须且只能返回一次。输入：\n${JSON.stringify(rows)}`;
}

function review(options, dependencies = {}) {
  const root = options.root ?? process.cwd();
  if (typeof options.input !== 'string' || typeof options.output !== 'string') {
    throw new Error('--input and --output are required.');
  }
  if (typeof options.kind !== 'string' || typeof options.model !== 'string') {
    throw new Error('--kind and --model are required.');
  }
  const input = path.resolve(root, options.input);
  const output = path.resolve(root, options.output);
  const audit = path.resolve(
    root,
    options.audit ?? `${options.output}.review.jsonl`,
  );
  if (fs.existsSync(output) || fs.existsSync(audit)) {
    throw new Error(
      'Review output already exists; choose new --output/--audit paths.',
    );
  }
  const rows = validateRows(fs.readFileSync(input, 'utf8'), options.kind);
  const batchSize = Math.min(
    50,
    positiveNumber(options.batchSize ?? 20, 'batch-size', { integer: true }),
  );
  let remainingBudget = positiveNumber(options.maxBudgetUsd, 'max-budget-usd');
  const invoke = dependencies.invoke ?? runClaudeStructured;
  const accepted = [];
  const auditRows = [];

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const batchesRemaining = Math.ceil((rows.length - offset) / batchSize);
    const callBudget = Number((remainingBudget / batchesRemaining).toFixed(6));
    const response = invoke({
      prompt: reviewPrompt(options.kind, batch),
      schema: reviewSchema(batch.map(row => row.id)),
      model: options.model,
      maxBudgetUsd: callBudget,
      cwd: root,
    });
    const decisions = response.value.decisions;
    if (!Array.isArray(decisions))
      throw new Error('Reviewer omitted decisions.');
    const byId = new Map(decisions.map(decision => [decision.id, decision]));
    if (byId.size !== batch.length)
      throw new Error('Reviewer returned missing or duplicate IDs.');
    for (const row of batch) {
      const decision = byId.get(row.id);
      if (decision === undefined)
        throw new Error(`Reviewer omitted ${row.id}.`);
      if (decision.verdict === 'ACCEPT') accepted.push(row);
      auditRows.push({
        ...decision,
        reviewerModel: response.model ?? options.model,
        reviewerPromptVersion: 'independent-review-v1',
        reviewedPromptVersion: row.promptVersion,
      });
    }
    remainingBudget -= response.costUsd ?? callBudget;
    process.stdout.write(
      `Reviewed ${Math.min(offset + batch.length, rows.length)}/${rows.length}; accepted ${accepted.length}.\n`,
    );
  }

  if (accepted.length === 0) throw new Error('Reviewer rejected every row.');
  validateRows(jsonl(accepted), options.kind);
  atomicWrite(output, jsonl(accepted));
  atomicWrite(audit, jsonl(auditRows));
  return { accepted, decisions: auditRows };
}

function main(argv) {
  const args = parseArgs(argv);
  review({
    input: args.input,
    output: args.output,
    audit: args.audit,
    kind: args.kind,
    model: args.model,
    maxBudgetUsd: args['max-budget-usd'],
    batchSize: args['batch-size'],
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

module.exports = { review, reviewPrompt, reviewSchema };
