#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { parseArgs } = require('./synthetic-data/pipeline-utils.cjs');

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function requireOption(args, name) {
  if (typeof args[name] !== 'string' || args[name].trim().length === 0) {
    throw new Error(`--${name} is required.`);
  }
  return args[name];
}

function quote(value) {
  const text = String(value);
  return /[\s"']/u.test(text) ? JSON.stringify(text) : text;
}

function displayCommand(command) {
  return command.map(quote).join(' ');
}

function createPlan(options) {
  const root = path.resolve(options.root ?? process.cwd());
  const device = options.device;
  const team = options.developmentTeam;
  const candidateDir = path.resolve(root, options.candidateDir);
  const outputDir = path.resolve(root, options.outputDir);
  const runRoot = path.resolve(options.runRoot);
  const stagedRoot = path.join(runRoot, 'benchmark-assets');
  const derivedData = path.join(runRoot, 'DerivedData');
  const goldenInput = path.join(runRoot, 'golden-input.tsv');
  const appPath = path.join(
    derivedData,
    'Build',
    'Products',
    'Release-iphoneos',
    'QingJiAI.app',
  );
  const iosGolden = path.join(outputDir, 'ios-golden.jsonl');
  const deviceEvidence = path.join(outputDir, 'ios-device-evidence.json');
  const iosBenchmark = path.join(outputDir, 'ios-benchmark.json');
  return {
    root,
    device,
    team,
    candidateDir,
    outputDir,
    runRoot,
    stagedRoot,
    derivedData,
    goldenInput,
    appPath,
    iosGolden,
    deviceEvidence,
    iosBenchmark,
    commands: {
      stage: [
        process.execPath,
        path.join(
          root,
          'scripts',
          'bill-classifier',
          'stage-benchmark-model.cjs',
        ),
        '--candidate-dir',
        candidateDir,
        '--output-root',
        stagedRoot,
      ],
      golden: [
        process.execPath,
        path.join(
          root,
          'scripts',
          'bill-classifier',
          'create-device-golden-input.cjs',
        ),
        '--dataset',
        path.join(
          root,
          'data',
          'synthetic',
          'reviewed',
          'codex-v2',
          'category-training.jsonl',
        ),
        '--output',
        goldenInput,
      ],
      build: [
        'xcodebuild',
        '-workspace',
        path.join(root, 'ios', 'QingJiAI.xcworkspace'),
        '-scheme',
        'QingJiAI',
        '-configuration',
        'Release',
        '-destination',
        `id=${device}`,
        '-derivedDataPath',
        derivedData,
        `BILL_CLASSIFIER_ASSETS_ROOT=${stagedRoot}`,
        `DEVELOPMENT_TEAM=${team}`,
        'CODE_SIGN_STYLE=Automatic',
        'build',
      ],
      install: [
        'xcrun',
        'devicectl',
        'device',
        'install',
        'app',
        '--device',
        device,
        appPath,
      ],
    },
  };
}

function run(command, options = {}) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error || result.status !== 0) {
    const details = options.capture
      ? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
      : '';
    throw new Error(
      `Command failed: ${displayCommand(command)}${details ? `\n${details}` : ''}`,
    );
  }
  return result;
}

function readBundleIdentifier(appPath) {
  const result = run(
    [
      '/usr/libexec/PlistBuddy',
      '-c',
      'Print :CFBundleIdentifier',
      path.join(appPath, 'Info.plist'),
    ],
    { capture: true },
  );
  const identifier = result.stdout.trim();
  if (!/^[A-Za-z0-9.-]+$/u.test(identifier)) {
    throw new Error('Built app has an invalid bundle identifier.');
  }
  return identifier;
}

function copyToDevice(plan, bundleIdentifier) {
  run([
    'xcrun',
    'devicectl',
    'device',
    'copy',
    'to',
    '--device',
    plan.device,
    '--source',
    plan.goldenInput,
    '--domain-type',
    'appDataContainer',
    '--domain-identifier',
    bundleIdentifier,
    '--destination',
    'Documents/golden-input.tsv',
  ]);
}

function copyFromDevice(plan, bundleIdentifier, source, destination) {
  return spawnSync(
    'xcrun',
    [
      'devicectl',
      'device',
      'copy',
      'from',
      '--device',
      plan.device,
      '--domain-type',
      'appDataContainer',
      '--domain-identifier',
      bundleIdentifier,
      '--source',
      source,
      '--destination',
      destination,
    ],
    { encoding: 'utf8', stdio: 'pipe' },
  );
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function collectDeviceOutputs(plan, bundleIdentifier) {
  const outputs = [
    ['Documents/ios-golden.jsonl', plan.iosGolden],
    ['Documents/ios-device-evidence.json', plan.deviceEvidence],
  ];
  const deadline = Date.now() + 60_000;
  for (;;) {
    const results = outputs.map(([source, destination]) =>
      copyFromDevice(plan, bundleIdentifier, source, destination),
    );
    if (results.every(result => result.status === 0)) return;
    for (const [, destination] of outputs) {
      fs.rmSync(destination, { force: true });
    }
    if (Date.now() >= deadline) {
      const details = results
        .map(result => `${result.stdout ?? ''}${result.stderr ?? ''}`.trim())
        .filter(Boolean)
        .join('\n');
      throw new Error(
        `Timed out waiting for iOS benchmark outputs.\n${details}`,
      );
    }
    wait(2_000);
  }
}

function execute(options) {
  if (process.platform !== 'darwin') {
    throw new Error('The iOS physical-device benchmark must run on macOS.');
  }
  if (!options.acknowledgeReplacesInstalledApp) {
    throw new Error('--acknowledge-replaces-installed-app is required.');
  }
  const plan = createPlan(options);
  if (!fs.existsSync(path.join(plan.root, 'ios', 'QingJiAI.xcworkspace'))) {
    throw new Error(
      'ios/QingJiAI.xcworkspace is missing; run pod install first.',
    );
  }
  if (!fs.existsSync(plan.candidateDir)) {
    throw new Error(`Candidate directory is missing (${plan.candidateDir}).`);
  }
  if (fs.existsSync(plan.outputDir)) {
    throw new Error(
      'iOS benchmark output directory already exists; evidence is immutable.',
    );
  }
  fs.mkdirSync(plan.outputDir, { recursive: true });
  run(['xcrun', 'devicectl', 'help'], { capture: true });
  run(plan.commands.stage, { cwd: plan.root });
  run(plan.commands.golden, { cwd: plan.root });
  run(plan.commands.build, { cwd: plan.root });
  if (!fs.existsSync(plan.appPath)) {
    throw new Error(`Built app is missing (${plan.appPath}).`);
  }
  const bundleIdentifier = readBundleIdentifier(plan.appPath);
  run(plan.commands.install, { cwd: plan.root });
  copyToDevice(plan, bundleIdentifier);
  run([
    'xcrun',
    'devicectl',
    'device',
    'process',
    'launch',
    '--terminate-existing',
    '--device',
    plan.device,
    bundleIdentifier,
    '--',
    '--qingji-bill-classifier-benchmark',
  ]);
  collectDeviceOutputs(plan, bundleIdentifier);
  const manifest = path.join(
    plan.stagedRoot,
    'bill-classifier',
    'manifest.json',
  );
  fs.copyFileSync(manifest, path.join(plan.outputDir, 'manifest.json'));
  run(
    [
      process.execPath,
      path.join(
        plan.root,
        'scripts',
        'bill-classifier',
        'create-ios-benchmark-evidence.cjs',
      ),
      '--manifest',
      manifest,
      '--golden',
      plan.iosGolden,
      '--device-evidence',
      plan.deviceEvidence,
      '--output',
      plan.iosBenchmark,
    ],
    { cwd: plan.root },
  );
  const receipt = {
    schemaVersion: 1,
    status: 'IOS_BENCHMARK_COMPLETE',
    deploymentMode: 'BENCHMARK_ONLY',
    allowAutoCommit: false,
    device: plan.device,
    bundleIdentifier,
    modelManifestSha256: sha256(manifest),
    goldenSha256: sha256(plan.iosGolden),
    deviceEvidenceSha256: sha256(plan.deviceEvidence),
    benchmarkSha256: sha256(plan.iosBenchmark),
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(plan.outputDir, 'ios-benchmark-receipt.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

function main(argv) {
  const args = parseArgs(argv);
  const dryRun = args['dry-run'] === true;
  const options = {
    root: process.cwd(),
    device: requireOption(args, 'device'),
    developmentTeam: requireOption(args, 'development-team'),
    candidateDir: requireOption(args, 'candidate-dir'),
    outputDir: requireOption(args, 'output-dir'),
    acknowledgeReplacesInstalledApp:
      args['acknowledge-replaces-installed-app'] === true,
    runRoot: dryRun
      ? path.join(os.tmpdir(), 'qingji-ios-benchmark-dry-run')
      : fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-ios-benchmark-')),
  };
  if (dryRun) {
    const plan = createPlan(options);
    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'IOS_BENCHMARK_DRY_RUN',
          requiresPhysicalDevice: true,
          replacesInstalledApp: true,
          commands: Object.fromEntries(
            Object.entries(plan.commands).map(([name, command]) => [
              name,
              displayCommand(command),
            ]),
          ),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const receipt = execute(options);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createPlan, displayCommand, execute };
