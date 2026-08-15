#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KEY_MATERIAL_EXTENSIONS = new Set([
  '.jks',
  '.keystore',
  '.mobileprovision',
  '.p12',
]);
const WALK_EXCLUSIONS = new Set([
  '.bundle',
  '.cxx',
  '.git',
  '.gradle',
  'Pods',
  'build',
  'coverage',
  'node_modules',
]);
const ALLOWED_REPOSITORY_KEY_MATERIAL = new Set(['android/app/debug.keystore']);

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

function addError(errors, code, message) {
  errors.push({ code, message });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function stripComments(source) {
  let output = '';
  let index = 0;
  let state = 'code';
  let quote = '';

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (state === 'line-comment') {
      if (current === '\n') {
        state = 'code';
        output += current;
      } else {
        output += ' ';
      }
      index += 1;
      continue;
    }

    if (state === 'block-comment') {
      if (current === '*' && next === '/') {
        output += '  ';
        index += 2;
        state = 'code';
      } else {
        output += current === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }

    if (state === 'string') {
      output += current;
      if (current === '\\') {
        if (next !== undefined) {
          output += next;
          index += 2;
        } else {
          index += 1;
        }
        continue;
      }
      if (current === quote) {
        state = 'code';
        quote = '';
      }
      index += 1;
      continue;
    }

    if (current === '/' && next === '/') {
      output += '  ';
      index += 2;
      state = 'line-comment';
      continue;
    }
    if (current === '/' && next === '*') {
      output += '  ';
      index += 2;
      state = 'block-comment';
      continue;
    }
    if (current === '"' || current === "'") {
      quote = current;
      state = 'string';
    }
    output += current;
    index += 1;
  }

  return output;
}

function scanBlock(source, openingBraceIndex) {
  let depth = 0;
  let quote = '';

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    const current = source[index];

    if (quote.length > 0) {
      if (current === '\\') {
        index += 1;
      } else if (current === quote) {
        quote = '';
      }
      continue;
    }

    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }
    if (current === '{') {
      depth += 1;
    } else if (current === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openingBraceIndex + 1, index);
      }
    }
  }

  return undefined;
}

function extractNamedBlock(source, name) {
  const expression = new RegExp(`\\b${name}\\b\\s*\\{`, 'g');
  const match = expression.exec(source);
  if (match === null) {
    return undefined;
  }
  const openingBraceIndex = source.indexOf('{', match.index);
  return scanBlock(source, openingBraceIndex);
}

function extractStringValue(source, key) {
  const expression = new RegExp(`\\b${key}\\b\\s*(?:=\\s*)?["']([^"']+)["']`);
  return expression.exec(source)?.[1];
}

function extractIntegerValue(source, key) {
  const expression = new RegExp(`\\b${key}\\b\\s*(?:=\\s*)?(\\d+)`);
  const value = expression.exec(source)?.[1];
  return value === undefined ? undefined : Number(value);
}

function uniqueProjectValues(source, key) {
  const expression = new RegExp(`\\b${key}\\s*=\\s*([^;]+);`, 'g');
  return [
    ...new Set(
      [...source.matchAll(expression)].map(match =>
        match[1].trim().replace(/^"|"$/g, ''),
      ),
    ),
  ];
}

function validateMetadata(metadata, errors) {
  if (metadata?.schemaVersion !== 1) {
    addError(
      errors,
      'IDENTITY_METADATA_SCHEMA',
      'config/release-identity.json must use schemaVersion 1.',
    );
    return false;
  }

  if (!/^\d+\.\d+\.\d+$/.test(metadata.marketingVersion ?? '')) {
    addError(
      errors,
      'IDENTITY_MARKETING_VERSION_INVALID',
      'marketingVersion must use MAJOR.MINOR.PATCH.',
    );
  }
  if (!Number.isInteger(metadata.buildNumber) || metadata.buildNumber <= 0) {
    addError(
      errors,
      'IDENTITY_BUILD_NUMBER_INVALID',
      'buildNumber must be a positive integer.',
    );
  }
  if (metadata.packageVersion !== metadata.marketingVersion) {
    addError(
      errors,
      'IDENTITY_PACKAGE_VERSION_POLICY',
      'packageVersion must match marketingVersion.',
    );
  }

  const previousReleases = Array.isArray(metadata.previousReleases)
    ? metadata.previousReleases
    : [];
  const previousBuilds = previousReleases.map(release => release?.buildNumber);
  if (
    previousBuilds.some(
      buildNumber => !Number.isInteger(buildNumber) || buildNumber <= 0,
    )
  ) {
    addError(
      errors,
      'IDENTITY_HISTORY_INVALID',
      'Every previous release must have a positive integer buildNumber.',
    );
  } else if (
    previousBuilds.some(buildNumber => buildNumber >= metadata.buildNumber)
  ) {
    addError(
      errors,
      'IDENTITY_BUILD_NOT_MONOTONIC',
      'buildNumber must be greater than every recorded previous release.',
    );
  }

  const productionApplicationId = metadata.android?.productionApplicationId;
  const internalSuffix = metadata.android?.internal?.applicationIdSuffix;
  const iosBundleIdentifier = metadata.ios?.productionBundleIdentifier;
  const iosShareExtensionBundleIdentifier =
    metadata.ios?.shareExtensionBundleIdentifier;
  if (
    !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/i.test(
      productionApplicationId ?? '',
    )
  ) {
    addError(
      errors,
      'IDENTITY_ANDROID_ID_INVALID',
      'android.productionApplicationId is not a valid reverse-domain identifier.',
    );
  }
  if (!/^\.[a-z][a-z0-9.]*$/i.test(internalSuffix ?? '')) {
    addError(
      errors,
      'IDENTITY_INTERNAL_SUFFIX_INVALID',
      'android.internal.applicationIdSuffix must be a non-empty dotted suffix.',
    );
  }
  if (
    !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/i.test(iosBundleIdentifier ?? '')
  ) {
    addError(
      errors,
      'IDENTITY_IOS_ID_INVALID',
      'ios.productionBundleIdentifier is not a valid reverse-domain identifier.',
    );
  }
  if (
    !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/i.test(
      iosShareExtensionBundleIdentifier ?? '',
    ) ||
    iosShareExtensionBundleIdentifier === iosBundleIdentifier
  ) {
    addError(
      errors,
      'IDENTITY_IOS_SHARE_EXTENSION_ID_INVALID',
      'ios.shareExtensionBundleIdentifier must be a distinct valid reverse-domain identifier.',
    );
  }
  if (metadata.android?.production?.allowDebugSigning !== false) {
    addError(
      errors,
      'IDENTITY_PRODUCTION_DEBUG_POLICY',
      'The production Android track must explicitly forbid debug signing.',
    );
  }
  if (metadata.android?.internal?.allowDebugSigning !== true) {
    addError(
      errors,
      'IDENTITY_INTERNAL_SIGNING_POLICY',
      'The internal track must explicitly document its debug-signing policy.',
    );
  }
  const secretNames =
    metadata.android?.production?.requiredSecretEnvironmentVariables;
  if (
    !Array.isArray(secretNames) ||
    secretNames.length !== 4 ||
    new Set(secretNames).size !== secretNames.length ||
    secretNames.some(name => !/^[A-Z][A-Z0-9_]+$/.test(name))
  ) {
    addError(
      errors,
      'IDENTITY_SIGNING_SECRET_POLICY',
      'Production Android signing must declare four unique environment variable names.',
    );
  }

  return errors.length === 0;
}

function findKeyMaterial(projectRoot) {
  const findings = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && WALK_EXCLUSIONS.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!KEY_MATERIAL_EXTENSIONS.has(extension)) {
        continue;
      }
      const relativePath = normalizeRelativePath(
        path.relative(projectRoot, absolutePath),
      );
      if (!ALLOWED_REPOSITORY_KEY_MATERIAL.has(relativePath)) {
        findings.push(relativePath);
      }
    }
  }

  visit(projectRoot);
  return findings.sort();
}

function verifyAndroid(projectRoot, metadata, errors, facts) {
  const filePath = path.join(projectRoot, 'android', 'app', 'build.gradle');
  const source = stripComments(fs.readFileSync(filePath, 'utf8'));
  const androidBlock = extractNamedBlock(source, 'android');
  if (androidBlock === undefined) {
    addError(
      errors,
      'IDENTITY_ANDROID_BLOCK_MISSING',
      'Android configuration is missing.',
    );
    return;
  }

  const defaultConfig = extractNamedBlock(androidBlock, 'defaultConfig');
  const signingConfigs = extractNamedBlock(androidBlock, 'signingConfigs');
  const buildTypes = extractNamedBlock(androidBlock, 'buildTypes');
  if (
    defaultConfig === undefined ||
    signingConfigs === undefined ||
    buildTypes === undefined
  ) {
    addError(
      errors,
      'IDENTITY_ANDROID_STRUCTURE',
      'Android defaultConfig, signingConfigs and buildTypes must all exist.',
    );
    return;
  }

  const applicationId = extractStringValue(defaultConfig, 'applicationId');
  const versionCode = extractIntegerValue(defaultConfig, 'versionCode');
  const versionName = extractStringValue(defaultConfig, 'versionName');
  facts.android = { applicationId, versionCode, versionName };

  if (applicationId !== metadata.android.productionApplicationId) {
    addError(
      errors,
      'IDENTITY_ANDROID_APPLICATION_ID',
      `Android applicationId must be ${metadata.android.productionApplicationId}.`,
    );
  }
  if (versionCode !== metadata.buildNumber) {
    addError(
      errors,
      'IDENTITY_ANDROID_BUILD',
      `Android versionCode must be ${metadata.buildNumber}.`,
    );
  }
  if (versionName !== metadata.marketingVersion) {
    addError(
      errors,
      'IDENTITY_ANDROID_VERSION',
      `Android versionName must be ${metadata.marketingVersion}.`,
    );
  }

  const internalBuildType = metadata.android.internal.buildType;
  const internalBlock = extractNamedBlock(buildTypes, internalBuildType);
  if (internalBlock === undefined) {
    addError(
      errors,
      'IDENTITY_ANDROID_INTERNAL_TRACK',
      `Android build type ${internalBuildType} is missing.`,
    );
  } else {
    const suffix = extractStringValue(internalBlock, 'applicationIdSuffix');
    if (suffix !== metadata.android.internal.applicationIdSuffix) {
      addError(
        errors,
        'IDENTITY_ANDROID_INTERNAL_SUFFIX',
        `Android ${internalBuildType} must use applicationIdSuffix ${metadata.android.internal.applicationIdSuffix}.`,
      );
    }
  }

  const releaseConfigName = metadata.android.production.signingConfig;
  const releaseSigningBlock = extractNamedBlock(
    signingConfigs,
    releaseConfigName,
  );
  const productionBuildType = metadata.android.production.buildType;
  const productionBlock = extractNamedBlock(buildTypes, productionBuildType);
  if (releaseSigningBlock === undefined) {
    addError(
      errors,
      'IDENTITY_ANDROID_RELEASE_SIGNING_CONFIG',
      `Android signing config ${releaseConfigName} is missing.`,
    );
  }
  if (productionBlock === undefined) {
    addError(
      errors,
      'IDENTITY_ANDROID_PRODUCTION_TRACK',
      `Android build type ${productionBuildType} is missing.`,
    );
  } else {
    if (
      /\bsigningConfig\s*(?:=\s*)?signingConfigs\.debug\b/.test(productionBlock)
    ) {
      addError(
        errors,
        'IDENTITY_ANDROID_RELEASE_DEBUG_SIGNED',
        'Production Android builds must never use signingConfigs.debug.',
      );
    }
    const requiredSigningExpression = new RegExp(
      `\\bsigningConfig\\s*(?:=\\s*)?signingConfigs\\.${releaseConfigName}\\b`,
    );
    if (!requiredSigningExpression.test(productionBlock)) {
      addError(
        errors,
        'IDENTITY_ANDROID_RELEASE_SIGNING_WIRING',
        `Android ${productionBuildType} must use signingConfigs.${releaseConfigName}.`,
      );
    }
  }

  if (releaseSigningBlock !== undefined) {
    const literalSecret =
      /\b(?:storePassword|keyPassword|keyAlias)\b\s*(?:=\s*)?["'][^"']+["']/;
    const literalStoreFile = /\bstoreFile\b[^\n]*file\s*\(\s*["']/;
    if (
      literalSecret.test(releaseSigningBlock) ||
      literalStoreFile.test(releaseSigningBlock)
    ) {
      addError(
        errors,
        'IDENTITY_ANDROID_HARDCODED_SIGNING_SECRET',
        'Production signing material must come from external secret references, not literals.',
      );
    }
  }

  for (const secretName of metadata.android.production
    .requiredSecretEnvironmentVariables) {
    if (!source.includes(secretName)) {
      addError(
        errors,
        'IDENTITY_ANDROID_SIGNING_SECRET_REFERENCE',
        `Android release signing does not reference required environment variable ${secretName}.`,
      );
    }
  }
}

function verifyIos(projectRoot, metadata, errors, facts) {
  const projectPath = path.join(
    projectRoot,
    'ios',
    'QingJiAI.xcodeproj',
    'project.pbxproj',
  );
  const source = fs.readFileSync(projectPath, 'utf8');
  const versions = uniqueProjectValues(source, 'MARKETING_VERSION');
  const builds = uniqueProjectValues(source, 'CURRENT_PROJECT_VERSION');
  const bundleIdentifiers = uniqueProjectValues(
    source,
    'PRODUCT_BUNDLE_IDENTIFIER',
  );
  facts.ios = { versions, builds, bundleIdentifiers };

  if (versions.length !== 1 || versions[0] !== metadata.marketingVersion) {
    addError(
      errors,
      'IDENTITY_IOS_VERSION',
      `Every iOS configuration must use MARKETING_VERSION ${metadata.marketingVersion}.`,
    );
  }
  if (builds.length !== 1 || Number(builds[0]) !== metadata.buildNumber) {
    addError(
      errors,
      'IDENTITY_IOS_BUILD',
      `Every iOS configuration must use CURRENT_PROJECT_VERSION ${metadata.buildNumber}.`,
    );
  }
  const expectedBundleIdentifiers = [
    metadata.ios.productionBundleIdentifier,
    metadata.ios.shareExtensionBundleIdentifier,
  ].sort();
  if (
    bundleIdentifiers.length !== expectedBundleIdentifiers.length ||
    bundleIdentifiers
      .slice()
      .sort()
      .some(
        (bundleIdentifier, index) =>
          bundleIdentifier !== expectedBundleIdentifiers[index],
      )
  ) {
    addError(
      errors,
      'IDENTITY_IOS_BUNDLE_ID',
      `iOS configurations must use exactly these bundle identifiers: ${expectedBundleIdentifiers.join(', ')}.`,
    );
  }
  if (source.includes('org.reactjs.native.example')) {
    addError(
      errors,
      'IDENTITY_IOS_TEMPLATE_ID',
      'The React Native template bundle identifier must not remain in the project.',
    );
  }
}

function verifyReleaseIdentity(options = {}) {
  const projectRoot = path.resolve(
    options.projectRoot ?? path.join(__dirname, '..'),
  );
  const metadataPath = path.resolve(
    options.metadataPath ??
      path.join(projectRoot, 'config', 'release-identity.json'),
  );
  const errors = [];
  const facts = {};

  let metadata;
  try {
    metadata = readJson(metadataPath);
  } catch (error) {
    addError(
      errors,
      'IDENTITY_METADATA_READ',
      `Cannot read release identity metadata: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    return { ok: false, errors, facts };
  }

  if (!validateMetadata(metadata, errors)) {
    return { ok: false, errors, facts };
  }
  facts.expected = {
    marketingVersion: metadata.marketingVersion,
    buildNumber: metadata.buildNumber,
    productionAndroidApplicationId: metadata.android.productionApplicationId,
    internalAndroidApplicationId: `${metadata.android.productionApplicationId}${metadata.android.internal.applicationIdSuffix}`,
    productionIosBundleIdentifier: metadata.ios.productionBundleIdentifier,
  };

  try {
    const packageJson = readJson(path.join(projectRoot, 'package.json'));
    facts.packageVersion = packageJson.version;
    if (packageJson.version !== metadata.packageVersion) {
      addError(
        errors,
        'IDENTITY_PACKAGE_VERSION',
        `package.json version must be ${metadata.packageVersion}.`,
      );
    }
  } catch (error) {
    addError(
      errors,
      'IDENTITY_PACKAGE_READ',
      `Cannot read package.json: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  try {
    verifyAndroid(projectRoot, metadata, errors, facts);
  } catch (error) {
    addError(
      errors,
      'IDENTITY_ANDROID_READ',
      `Cannot verify Android release identity: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
  try {
    verifyIos(projectRoot, metadata, errors, facts);
  } catch (error) {
    addError(
      errors,
      'IDENTITY_IOS_READ',
      `Cannot verify iOS release identity: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  try {
    const keyMaterial = findKeyMaterial(projectRoot);
    facts.unapprovedKeyMaterial = keyMaterial;
    if (keyMaterial.length > 0) {
      addError(
        errors,
        'IDENTITY_KEY_MATERIAL_IN_REPOSITORY',
        `Unapproved signing material exists in the repository: ${keyMaterial.join(', ')}.`,
      );
    }
  } catch (error) {
    addError(
      errors,
      'IDENTITY_KEY_SCAN',
      `Cannot scan signing material: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  return { ok: errors.length === 0, errors, facts };
}

function runCli() {
  const jsonOutput = process.argv.slice(2).includes('--json');
  const result = verifyReleaseIdentity();

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(
      `[release-identity] PASS ${result.facts.expected.marketingVersion} (${result.facts.expected.buildNumber})\n`,
    );
  } else {
    process.stderr.write('[release-identity] FAIL\n');
    for (const error of result.errors) {
      process.stderr.write(`- ${error.code}: ${error.message}\n`);
    }
  }

  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) {
  runCli();
}

module.exports = {
  extractNamedBlock,
  stripComments,
  verifyReleaseIdentity,
};
