const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const fastTextRoot = path.join(root, 'third_party', 'fasttext', 'src');
const classifierRoot = path.join(root, 'native', 'bill-classifier');
const outputRoot = path.join(root, 'build', 'bill-classifier-host');
const output = path.join(
  outputRoot,
  process.platform === 'win32' ? 'classifier-host.exe' : 'classifier-host',
);
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

function buildHostRuntime() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const result = spawnSync(
    process.env.CXX || 'g++',
    [
      '-std=c++17',
      '-O2',
      '-DNDEBUG',
      '-DQINGJI_FASTTEXT_SINGLE_THREAD',
      `-I${fastTextRoot}`,
      `-I${classifierRoot}`,
      path.join(__dirname, 'classifier-host.cc'),
      path.join(classifierRoot, 'OnDeviceBillClassifierCore.cc'),
      ...sources,
      '-o',
      output,
    ],
    { cwd: root, encoding: 'utf8', stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Host classifier build failed with ${result.status}.`);
  process.stdout.write(`Built host classifier: ${output}\n`);
  return output;
}

if (require.main === module) buildHostRuntime();

module.exports = { buildHostRuntime, output };
