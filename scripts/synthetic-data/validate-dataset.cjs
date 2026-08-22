const fs = require('node:fs');

const LABELS = new Set([
  'income',
  'expense.food',
  'expense.transport',
  'expense.shopping',
  'expense.housing',
  'expense.entertainment',
  'expense.healthcare',
  'expense.education',
  'expense.other_expense',
]);

const RULES = {
  category: {
    required: [
      'id',
      'rawText',
      'normalizedModelText',
      'label',
      'direction',
      'scenario',
      'generatorModel',
      'promptVersion',
      'taxonomyVersion',
      'difficulty',
      'splitGroup',
    ],
    optional: ['merchantFamily'],
    validate(row, fail) {
      if (!/^syn-cat-[A-Za-z0-9._-]+$/u.test(row.id)) fail('invalid id');
      if (!LABELS.has(row.label)) fail('unknown label');
      if (row.taxonomyVersion !== 3) fail('taxonomyVersion must be 3');
      const expectedDirection = row.label === 'income' ? 'INCOME' : 'EXPENSE';
      if (row.direction !== expectedDirection) fail('label/direction mismatch');
      if (!['EASY', 'MEDIUM', 'HARD', 'ADVERSARIAL'].includes(row.difficulty)) {
        fail('invalid difficulty');
      }
      boundedText(row.rawText, 'rawText', fail);
      boundedText(row.normalizedModelText, 'normalizedModelText', fail);
    },
  },
  amount: {
    required: [
      'id',
      'text',
      'expectedStatus',
      'amountEvidence',
      'scenario',
      'generatorModel',
      'promptVersion',
    ],
    optional: ['expectedAmountMinor'],
    validate(row, fail) {
      if (!/^syn-amount-[A-Za-z0-9._-]+$/u.test(row.id)) fail('invalid id');
      boundedText(row.text, 'text', fail);
      if (!['RESOLVED', 'AMBIGUOUS', 'MISSING'].includes(row.expectedStatus)) {
        fail('invalid expectedStatus');
      }
      if (row.expectedStatus === 'RESOLVED')
        positiveMinor(row.expectedAmountMinor, fail);
      if (
        row.expectedStatus !== 'RESOLVED' &&
        row.expectedAmountMinor !== undefined
      ) {
        fail('ambiguous/missing rows must not declare expectedAmountMinor');
      }
      if (!Array.isArray(row.amountEvidence))
        fail('amountEvidence must be an array');
      if (
        row.amountEvidence.some(
          value => typeof value !== 'string' || value.trim().length === 0,
        )
      ) {
        fail('amountEvidence entries must be non-empty strings');
      }
    },
  },
  risk: {
    required: [
      'id',
      'text',
      'expectedModelEligible',
      'expectedFlags',
      'expectedDisposition',
      'scenario',
      'generatorModel',
      'promptVersion',
      'splitGroup',
    ],
    optional: [],
    validate(row, fail) {
      if (!/^syn-risk-[A-Za-z0-9._-]+$/u.test(row.id)) fail('invalid id');
      boundedText(row.text, 'text', fail);
      if (row.expectedModelEligible !== false)
        fail('risk rows must be model-ineligible');
      if (!Array.isArray(row.expectedFlags) || row.expectedFlags.length === 0) {
        fail('risk rows require at least one flag');
      }
      if (!['EDIT_OR_PENDING', 'EDIT_ONLY'].includes(row.expectedDisposition)) {
        fail('invalid expectedDisposition');
      }
    },
  },
  e2e: {
    required: [
      'id',
      'text',
      'expected',
      'requiredReview',
      'scenario',
      'generatorModel',
      'promptVersion',
      'splitGroup',
    ],
    optional: [],
    validate(row, fail) {
      if (!/^syn-e2e-[A-Za-z0-9._-]+$/u.test(row.id)) fail('invalid id');
      boundedText(row.text, 'text', fail);
      if (typeof row.expected !== 'object' || row.expected === null)
        fail('expected must be an object');
      if (!['INCOME', 'EXPENSE'].includes(row.expected.direction))
        fail('invalid direction');
      positiveMinor(row.expected.amountMinor, fail);
      if (
        row.expected.direction === 'INCOME' &&
        row.expected.categoryKey !== undefined
      ) {
        fail('simplified income must not have an expense category');
      }
      if (
        row.expected.direction === 'EXPENSE' &&
        (!LABELS.has(row.expected.categoryKey) ||
          row.expected.categoryKey === 'income')
      ) {
        fail('expense requires a known primary category');
      }
      if (typeof row.requiredReview !== 'boolean')
        fail('requiredReview must be boolean');
    },
  },
};

function boundedText(value, field, fail) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500) {
    fail(`${field} must contain 1-500 characters`);
  }
}

function positiveMinor(value, fail) {
  if (!Number.isSafeInteger(value) || value <= 0)
    fail('amountMinor must be a positive safe integer');
}

function validateRows(text, kind) {
  const rule = RULES[kind];
  if (rule === undefined) throw new Error(`Unknown dataset kind: ${kind}`);
  const ids = new Set();
  const rows = [];
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.length === 0) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(`Line ${index + 1}: invalid JSON (${error.message})`);
    }
    const fail = message => {
      const rowId = row.id === undefined ? 'missing-id' : row.id;
      throw new Error(`Line ${index + 1} (${rowId}): ${message}`);
    };
    if (typeof row !== 'object' || row === null || Array.isArray(row))
      fail('row must be an object');
    const allowed = new Set([...rule.required, ...rule.optional]);
    for (const field of rule.required) {
      if (!(field in row)) fail(`missing required field ${field}`);
    }
    for (const field of Object.keys(row)) {
      if (!allowed.has(field)) fail(`unknown field ${field}`);
    }
    if (ids.has(row.id)) fail('duplicate id');
    ids.add(row.id);
    for (const field of ['scenario', 'generatorModel', 'promptVersion']) {
      if (typeof row[field] !== 'string' || row[field].trim().length === 0) {
        fail(`${field} must be a non-empty string`);
      }
    }
    if (
      'splitGroup' in row &&
      (typeof row.splitGroup !== 'string' || row.splitGroup.trim().length === 0)
    ) {
      fail('splitGroup must be a non-empty string');
    }
    rule.validate(row, fail);
    rows.push(row);
  }
  if (rows.length === 0) throw new Error('Dataset is empty.');
  return rows;
}

function main(argv) {
  const [file, kind] = argv;
  if (file === undefined || kind === undefined) {
    const usage =
      'Usage: validate-dataset.cjs <file.jsonl> <category|amount|risk|e2e>';
    throw new Error(usage);
  }
  const rows = validateRows(fs.readFileSync(file, 'utf8'), kind);
  process.stdout.write(`Validated ${rows.length} ${kind} rows from ${file}.\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { validateRows };
