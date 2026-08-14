const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const modelRoot = path.join(projectRoot, 'models', 'bill-classifier');
const trainingRoot = path.join(
  projectRoot,
  'build',
  'bill-classifier-training',
);
const fastTextRoot = path.join(projectRoot, 'third_party', 'fasttext');
const toolRoot = path.join(projectRoot, 'build', 'bill-classifier-tools');
const executable = path.join(
  toolRoot,
  process.platform === 'win32' ? 'fasttext-qingji.exe' : 'fasttext-qingji',
);

function run(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}.`);
  }
}

function buildTrainingTool() {
  fs.mkdirSync(toolRoot, { recursive: true });
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
    'main.cc',
  ].map(file => path.join('src', file));
  run(
    process.env.CXX || 'g++',
    [
      '-std=c++11',
      '-O2',
      '-DNDEBUG',
      '-DQINGJI_FASTTEXT_SINGLE_THREAD',
      ...sources,
      '-o',
      executable,
    ],
    fastTextRoot,
  );
}

function train(input, output) {
  run(executable, [
    'supervised',
    '-input',
    input,
    '-output',
    output,
    '-dim',
    '24',
    '-epoch',
    '60',
    '-lr',
    '0.6',
    '-minn',
    '2',
    '-maxn',
    '5',
    '-wordNgrams',
    '2',
    '-bucket',
    '10000',
    '-minCount',
    '1',
    '-loss',
    'softmax',
    '-thread',
    '1',
    '-verbose',
    '0',
  ]);
  run(executable, [
    'quantize',
    '-input',
    input,
    '-output',
    output,
    '-qnorm',
    '-retrain',
    '-cutoff',
    '5000',
    '-dsub',
    '2',
    '-thread',
    '1',
    '-verbose',
    '0',
  ]);
  for (const suffix of ['.bin', '.vec']) {
    const generated = `${output}${suffix}`;
    if (fs.existsSync(generated)) fs.rmSync(generated);
  }
}

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function main() {
  buildTrainingTool();
  run(process.execPath, [path.join(__dirname, 'generate-training-data.cjs')]);
  const trainFiles = fs
    .readdirSync(trainingRoot)
    .filter(file => file.endsWith('.train.txt'))
    .sort();
  const models = [];
  for (const trainFile of trainFiles) {
    const name = trainFile.replace('.train.txt', '');
    const output = path.join(modelRoot, name);
    train(path.join(trainingRoot, trainFile), output);
    const modelFile = `${output}.ftz`;
    models.push({
      name: `${name}.ftz`,
      sizeBytes: fs.statSync(modelFile).size,
      sha256: sha256(modelFile),
    });
  }
  const taxonomy = JSON.parse(
    fs.readFileSync(path.join(modelRoot, 'taxonomy.json')),
  );
  const manifest = {
    schemaVersion: 1,
    modelId: 'qingji-bill-category-fasttext',
    modelVersion: '0.1.0-bootstrap',
    taxonomyVersion: taxonomy.taxonomyVersion,
    fastText: {
      version: '0.9.2',
      commit: '5b5943c118b0ec5fb9cd8d20587de2b2d3966dfe',
      license: 'MIT',
    },
    thresholds: {
      parentConfidence: 0.82,
      parentMargin: 0.18,
      childConfidence: 0.78,
      childMargin: 0.15,
    },
    calibrationTemperature: 1,
    models,
  };
  fs.writeFileSync(
    path.join(modelRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(
    `Built ${models.length} models (${models.reduce((sum, model) => sum + model.sizeBytes, 0)} bytes).\n`,
  );
}

main();
