const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--'))
      throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      result[key] = true;
    } else {
      result[key] = value;
      index += 1;
    }
  }
  return result;
}

function positiveNumber(value, name, { integer = false } = {}) {
  const parsed = Number(value);
  if (!(parsed > 0) || (integer && !Number.isInteger(parsed))) {
    throw new Error(
      `--${name} must be a positive ${integer ? 'integer' : 'number'}.`,
    );
  }
  return parsed;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function jsonl(rows) {
  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
}

function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, contents, 'utf8');
  fs.renameSync(temporary, file);
}

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

module.exports = {
  atomicWrite,
  jsonl,
  parseArgs,
  positiveNumber,
  readJson,
  sha256,
};
