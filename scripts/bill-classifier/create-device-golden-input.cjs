const fs = require('node:fs');
const path = require('node:path');

const { atomicWrite, parseArgs } = require('../synthetic-data/pipeline-utils.cjs');
const { validateRows } = require('../synthetic-data/validate-dataset.cjs');

function main(argv) {
  const args = parseArgs(argv);
  if (typeof args.dataset !== 'string' || typeof args.output !== 'string') {
    throw new Error('--dataset and --output are required.');
  }
  const rows = validateRows(fs.readFileSync(args.dataset, 'utf8'), 'category');
  const selected = [];
  const byLabel = new Map();
  for (const row of rows) {
    const count = byLabel.get(row.label) ?? 0;
    if (count >= 12) continue;
    byLabel.set(row.label, count + 1);
    selected.push(row);
  }
  if (selected.length < 100) throw new Error('At least 100 stratified rows are required.');
  atomicWrite(
    path.resolve(args.output),
    `${selected
      .slice(0, 100)
      .map(row => `${row.id}\t${row.direction}\t${row.normalizedModelText.replace(/[\r\n\t]+/gu, ' ')}`)
      .join('\n')}\n`,
  );
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
