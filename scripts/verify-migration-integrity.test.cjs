const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  verifyMigrationIntegrity,
  verifyMigrationSources,
} = require('./verify-migration-integrity.cjs');

const projectRoot = resolve(__dirname, '..');

function fixture() {
  const migrationsDirectory = resolve(
    projectRoot,
    'src',
    'database',
    'migrations',
  );
  const manifest = JSON.parse(
    readFileSync(
      resolve(projectRoot, 'config', 'migration-integrity.json'),
      'utf8',
    ),
  );
  const sourcesByFile = new Map(
    readdirSync(migrationsDirectory)
      .filter(file => /^v\d+[A-Za-z0-9]+\.ts$/u.test(file))
      .map(file => [
        file,
        readFileSync(resolve(migrationsDirectory, file), 'utf8').replace(
          /\r\n/gu,
          '\n',
        ),
      ]),
  );
  return { manifest, sourcesByFile };
}

test('accepts the reviewed append-only migration chain', () => {
  assert.equal(verifyMigrationIntegrity(projectRoot), 12);
});

test('rejects an edited historical migration', () => {
  const { manifest, sourcesByFile } = fixture();
  sourcesByFile.set(
    'v1InitialSchema.ts',
    `${sourcesByFile.get('v1InitialSchema.ts')}\n// unauthorized rewrite\n`,
  );
  assert.throws(
    () => verifyMigrationSources(manifest, sourcesByFile),
    /append a new migration instead of editing released history/u,
  );
});

test('rejects an undeclared migration file', () => {
  const { manifest, sourcesByFile } = fixture();
  sourcesByFile.set(
    'v5Unreviewed.ts',
    "export const unreviewed = { version: 5, name: 'unreviewed' };\n",
  );
  assert.throws(
    () => verifyMigrationSources(manifest, sourcesByFile),
    /source files and integrity manifest do not match/u,
  );
});
