const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const outputRoot = path.join(root, 'build', 'bill-classifier-native-smoke');
const output = path.join(
  outputRoot,
  process.platform === 'win32' ? 'core-smoke.exe' : 'core-smoke',
);
fs.mkdirSync(outputRoot, { recursive: true });

const fastTextRoot = path.join(root, 'third_party', 'fasttext', 'src');
const classifierRoot = path.join(root, 'native', 'bill-classifier');
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

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}.`);
  }
}

run(process.env.CXX || 'g++', [
  '-std=c++17',
  '-O2',
  '-DNDEBUG',
  '-DQINGJI_FASTTEXT_SINGLE_THREAD',
  `-I${fastTextRoot}`,
  `-I${classifierRoot}`,
  path.join(__dirname, 'core-smoke.cc'),
  path.join(classifierRoot, 'OnDeviceBillClassifierCore.cc'),
  ...sources,
  '-o',
  output,
]);
run(output, [path.join(root, 'models', 'bill-classifier')]);
