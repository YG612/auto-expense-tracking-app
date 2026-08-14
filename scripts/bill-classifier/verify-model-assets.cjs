const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const modelRoot = path.join(root, 'models', 'bill-classifier');
const manifest = JSON.parse(
  fs.readFileSync(path.join(modelRoot, 'manifest.json'), 'utf8'),
);
const taxonomy = JSON.parse(
  fs.readFileSync(path.join(modelRoot, 'taxonomy.json'), 'utf8'),
);

function fail(message) {
  throw new Error(`Bill classifier verification failed: ${message}`);
}

if (
  manifest.schemaVersion !== 1 ||
  manifest.modelId !== 'qingji-bill-category-fasttext' ||
  manifest.taxonomyVersion !== taxonomy.taxonomyVersion ||
  manifest.fastText?.commit !== '5b5943c118b0ec5fb9cd8d20587de2b2d3966dfe' ||
  manifest.fastText?.license !== 'MIT'
) {
  fail('manifest identity or provenance is invalid');
}
if (taxonomy.expense?.length !== 13 || taxonomy.income?.length !== 13) {
  fail('taxonomy does not match the seeded 13/13 parent structure');
}
const expectedNames = new Set([
  'parent-expense.ftz',
  'parent-income.ftz',
  ...taxonomy.expense.map(parent => `child-${parent.key}.ftz`),
]);
let total = 0;
for (const spec of manifest.models) {
  if (!expectedNames.delete(spec.name)) fail(`unexpected model ${spec.name}`);
  const file = path.join(modelRoot, spec.name);
  if (!fs.existsSync(file) || fs.statSync(file).size !== spec.sizeBytes) {
    fail(`size mismatch for ${spec.name}`);
  }
  const hash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
  if (hash !== spec.sha256) fail(`hash mismatch for ${spec.name}`);
  total += spec.sizeBytes;
}
if (expectedNames.size !== 0)
  fail(`missing models: ${[...expectedNames].join(', ')}`);
if (total > 3 * 1024 * 1024) fail(`model payload ${total} exceeds 3 MiB`);
for (const required of ['THIRD_PARTY_NOTICES.txt', 'sbom.json']) {
  if (!fs.existsSync(path.join(modelRoot, required)))
    fail(`missing ${required}`);
}
process.stdout.write(
  `Verified ${manifest.models.length} locked models (${total} bytes).\n`,
);
