#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

const trackedFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: projectRoot,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean)
  .map(file => file.replaceAll('\\', '/'));

const violations = [];
const forbiddenTrackedPatterns = [
  {
    label: 'generated Android/package artifact',
    pattern: /(^|\/)(?:artifacts|build|\.gradle|\.cxx|node_modules)(\/|$)/,
  },
  {
    label: 'generated installable binary',
    pattern: /\.(?:apk|aab)$/i,
  },
  {
    label: 'retired SenseVoice executable path',
    pattern: /(?:^|\/)(?:embeddedAsr|embedded-asr)(?:\/|$)/i,
  },
  {
    label: 'retired SenseVoice/ONNX runtime file',
    pattern: /(?:sensevoice|sherpa-onnx|onnxruntime)/i,
  },
];

for (const file of trackedFiles) {
  for (const rule of forbiddenTrackedPatterns) {
    if (rule.pattern.test(file)) {
      violations.push(`${rule.label}: ${file}`);
    }
  }
}

const contentOwners = new Map();
for (const file of trackedFiles) {
  const absolutePath = path.join(projectRoot, file);
  if (!fs.existsSync(absolutePath)) {
    continue;
  }
  const stat = fs.statSync(absolutePath);
  if (stat.size === 0) {
    continue;
  }
  const digest = crypto
    .createHash('sha256')
    .update(fs.readFileSync(absolutePath))
    .digest('hex');
  const owner = contentOwners.get(digest);
  if (owner) {
    violations.push(`exact duplicate content: ${owner} == ${file}`);
  } else {
    contentOwners.set(digest, file);
  }
}

const requiredStreamingPaths = [
  'android/app/src/internal/streaming-asr-lock.json',
  'scripts/prepare-android-streaming-asr.ps1',
  'scripts/build-android-sherpa-ncnn-streaming-runtime.ps1',
  'scripts/package-android-sherpa-ncnn-streaming-runtime.ps1',
];
for (const file of requiredStreamingPaths) {
  if (!trackedFiles.includes(file)) {
    violations.push(`missing tracked streaming source or lock: ${file}`);
  }
}

const retiredRuntimeFiles = [
  'android/app/src/internal/embedded-asr-lock.json',
  'scripts/prepare-android-embedded-asr.ps1',
  'scripts/build-android-sherpa-tts-free-runtime.ps1',
  'scripts/package-android-sherpa-tts-free-runtime.ps1',
];
for (const file of retiredRuntimeFiles) {
  if (fs.existsSync(path.join(projectRoot, file))) {
    violations.push(`retired runtime still exists in worktree: ${file}`);
  }
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
);
for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  if (/EmbeddedAsr|offline-asr|prepare-android-embedded-asr/i.test(command)) {
    violations.push(`retired package script remains: ${name}`);
  }
}

const gradle = fs.readFileSync(
  path.join(projectRoot, 'android', 'app', 'build.gradle'),
  'utf8',
);
for (const marker of [
  'embeddedAsrEnabled',
  'verifyEmbeddedSpeechInternalAssets',
  'src/embeddedAsr',
  'assets/speech/sensevoice',
]) {
  if (gradle.includes(marker)) {
    violations.push(`retired Gradle marker remains: ${marker}`);
  }
}

if (violations.length > 0) {
  console.error('Repository hygiene check failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(
  `Repository hygiene PASS: ${trackedFiles.length} tracked files; no generated APKs, legacy SenseVoice runtime, or retired build entry points.`,
);
