const { createHash } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');

function fail(message) {
  throw new Error(`[migration-integrity] ${message}`);
}

function normalizedSource(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function verifyMigrationSources(manifest, sourcesByFile) {
  const migrations = manifest.migrations;
  if (manifest.schemaVersion !== 1 || !Array.isArray(migrations)) {
    fail('manifest schema is invalid');
  }

  const discoveredFiles = [...sourcesByFile.keys()].sort();
  const declaredFiles = migrations.map(migration => migration.file).sort();
  if (JSON.stringify(discoveredFiles) !== JSON.stringify(declaredFiles)) {
    fail('migration source files and integrity manifest do not match');
  }

  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      fail(`expected contiguous migration version ${expectedVersion}`);
    }
    if (!/^[a-z0-9_]+$/u.test(migration.name)) {
      fail(`migration ${migration.version} has an invalid name`);
    }
    if (!/^[a-f0-9]{64}$/u.test(migration.sha256)) {
      fail(`migration ${migration.version} has an invalid SHA-256`);
    }

    const source = sourcesByFile.get(migration.file);
    if (source === undefined) {
      fail(`migration ${migration.version} source is missing`);
    }
    if (
      !new RegExp(`version:\\s*${migration.version}(?:,|\\s)`, 'u').test(source)
    ) {
      fail(`migration ${migration.version} source declares another version`);
    }
    if (!source.includes(`name: '${migration.name}'`)) {
      fail(`migration ${migration.version} source declares another name`);
    }
    if (sha256(source) !== migration.sha256) {
      fail(
        `migration ${migration.version} changed; append a new migration instead of editing released history`,
      );
    }
  });

  return migrations.length;
}

function verifyMigrationIntegrity(projectRoot = resolve(__dirname, '..')) {
  const manifestPath = resolve(
    projectRoot,
    'config',
    'migration-integrity.json',
  );
  const migrationsDirectory = resolve(
    projectRoot,
    'src',
    'database',
    'migrations',
  );
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const sourcesByFile = new Map(
    readdirSync(migrationsDirectory)
      .filter(file => /^v\d+[A-Za-z0-9]+\.ts$/u.test(file))
      .map(file => [
        file,
        normalizedSource(resolve(migrationsDirectory, file)),
      ]),
  );
  return verifyMigrationSources(manifest, sourcesByFile);
}

if (require.main === module) {
  const count = verifyMigrationIntegrity();
  console.log(`[migration-integrity] PASS ${count} immutable migrations`);
}

module.exports = { verifyMigrationIntegrity, verifyMigrationSources };
