const fs = require('node:fs');
const path = require('node:path');

const {
  atomicWrite,
  jsonl,
  parseArgs,
  sha256,
} = require('./pipeline-utils.cjs');
const { validateRows } = require('./validate-dataset.cjs');

function canonicalText(value) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\p{P}\p{S}\s\d]+/gu, '')
    .trim();
}

function trigrams(value) {
  const padded = `^^${canonicalText(value)}$$`;
  const values = new Set();
  for (let index = 0; index <= padded.length - 3; index += 1) {
    values.add(padded.slice(index, index + 3));
  }
  return values;
}

function jaccard(left, right) {
  let overlap = 0;
  for (const value of left) if (right.has(value)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}

function dedupeRows(rows, threshold = 0.92) {
  const exact = new Set();
  const accepted = [];
  const removed = [];
  const inverted = new Map();
  const gramsByIndex = [];
  for (const row of rows) {
    const text = canonicalText(row.normalizedModelText);
    const exactKey = `${row.label}\u0000${text}`;
    if (exact.has(exactKey)) {
      removed.push({ id: row.id, reason: 'EXACT_NORMALIZED_DUPLICATE' });
      continue;
    }
    const grams = trigrams(row.normalizedModelText);
    const candidateIndexes = new Set();
    for (const gram of [...grams].slice(0, 8)) {
      for (const index of inverted.get(`${row.label}\u0000${gram}`) ?? []) {
        candidateIndexes.add(index);
      }
    }
    let duplicateOf;
    for (const index of candidateIndexes) {
      if (jaccard(grams, gramsByIndex[index]) >= threshold) {
        duplicateOf = accepted[index].id;
        break;
      }
    }
    if (duplicateOf !== undefined) {
      removed.push({
        id: row.id,
        reason: 'APPROXIMATE_DUPLICATE',
        duplicateOf,
      });
      continue;
    }
    const acceptedIndex = accepted.length;
    exact.add(exactKey);
    accepted.push(row);
    gramsByIndex.push(grams);
    for (const gram of [...grams].slice(0, 8)) {
      const key = `${row.label}\u0000${gram}`;
      const indexes = inverted.get(key) ?? [];
      indexes.push(acceptedIndex);
      inverted.set(key, indexes);
    }
  }
  return { rows: accepted, removed };
}

function groupBucket(splitGroup) {
  return Number.parseInt(sha256(splitGroup).slice(0, 8), 16) % 100;
}

function prepare(options) {
  const root = options.root ?? process.cwd();
  for (const name of ['trainInput', 'frozenInput', 'outputDir']) {
    if (typeof options[name] !== 'string')
      throw new Error(
        `--${name.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)} is required.`,
      );
  }
  const trainRows = validateRows(
    fs.readFileSync(path.resolve(root, options.trainInput), 'utf8'),
    'category',
  );
  const frozenRows = validateRows(
    fs.readFileSync(path.resolve(root, options.frozenInput), 'utf8'),
    'category',
  );
  const trainPrompts = new Set(trainRows.map(row => row.promptVersion));
  const frozenPrompts = new Set(frozenRows.map(row => row.promptVersion));
  if ([...frozenPrompts].some(prompt => trainPrompts.has(prompt))) {
    throw new Error(
      'Frozen data must use a promptVersion absent from train/validation data.',
    );
  }
  const trainGroups = new Set(trainRows.map(row => row.splitGroup));
  const overlap = frozenRows.find(row => trainGroups.has(row.splitGroup));
  if (overlap !== undefined)
    throw new Error(`splitGroup leaks into frozen data: ${overlap.splitGroup}`);

  const dedupedTrain = dedupeRows(trainRows, options.threshold ?? 0.92);
  const dedupedFrozen = dedupeRows(frozenRows, options.threshold ?? 0.92);
  const train = [];
  const validation = [];
  for (const row of dedupedTrain.rows) {
    (groupBucket(row.splitGroup) < 15 ? validation : train).push(row);
  }
  if (
    train.length === 0 ||
    validation.length === 0 ||
    dedupedFrozen.rows.length === 0
  ) {
    throw new Error(
      'Prepared train, validation, and frozen splits must all be non-empty.',
    );
  }

  const outputDir = path.resolve(root, options.outputDir);
  const files = {
    train: 'category.train.jsonl',
    validation: 'category.validation.jsonl',
    frozenTest: 'category.frozen-test.jsonl',
    dedupeAudit: 'category.dedupe-audit.json',
  };
  const contents = {
    train: jsonl(train),
    validation: jsonl(validation),
    frozenTest: jsonl(dedupedFrozen.rows),
    dedupeAudit: `${JSON.stringify({ train: dedupedTrain.removed, frozen: dedupedFrozen.removed }, null, 2)}\n`,
  };
  for (const key of Object.keys(files)) {
    atomicWrite(path.join(outputDir, files[key]), contents[key]);
  }
  const manifest = {
    schemaVersion: 1,
    taxonomyVersion: 3,
    generatedAt: new Date().toISOString(),
    inputs: {
      train: path.relative(root, path.resolve(root, options.trainInput)),
      frozen: path.relative(root, path.resolve(root, options.frozenInput)),
    },
    splitPolicy: 'sha256(splitGroup) % 100; validation < 15; otherwise train',
    approximateDuplicateThreshold: options.threshold ?? 0.92,
    files: Object.fromEntries(
      Object.entries(files).map(([key, file]) => [
        key,
        {
          file,
          rows:
            key === 'train'
              ? train.length
              : key === 'validation'
                ? validation.length
                : key === 'frozenTest'
                  ? dedupedFrozen.rows.length
                  : dedupedTrain.removed.length + dedupedFrozen.removed.length,
          sha256: sha256(contents[key]),
        },
      ]),
    ),
  };
  atomicWrite(
    path.join(outputDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

function main(argv) {
  const args = parseArgs(argv);
  prepare({
    trainInput: args['train-input'],
    frozenInput: args['frozen-input'],
    outputDir: args['output-dir'],
    threshold:
      args.threshold === undefined ? undefined : Number(args.threshold),
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

module.exports = { canonicalText, dedupeRows, groupBucket, prepare };
