'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const { verifyReleaseIdentity } = require('./verify-release-identity.cjs');

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

function validGradle() {
  return `android {
    defaultConfig {
      applicationId "com.qingjiai"
      versionCode 8
      versionName "1.0.7"
    }
    signingConfigs {
      debug {}
      productionRelease {
        storeFile file(System.getenv("QINGJI_ANDROID_RELEASE_STORE_FILE"))
        storePassword System.getenv("QINGJI_ANDROID_RELEASE_STORE_PASSWORD")
        keyAlias System.getenv("QINGJI_ANDROID_RELEASE_KEY_ALIAS")
        keyPassword System.getenv("QINGJI_ANDROID_RELEASE_KEY_PASSWORD")
      }
    }
    buildTypes {
      debug {
        applicationIdSuffix ".debug"
        signingConfig signingConfigs.debug
      }
      release {
        signingConfig signingConfigs.productionRelease
      }
      internal {
        initWith release
        applicationIdSuffix ".internal"
        signingConfig signingConfigs.debug
      }
    }
  }`;
}

function validXcodeProject() {
  return `buildSettings = {
    CURRENT_PROJECT_VERSION = 8;
    MARKETING_VERSION = 1.0.7;
    PRODUCT_BUNDLE_IDENTIFIER = com.qingjiai;
  };
  buildSettings = {
    CURRENT_PROJECT_VERSION = 8;
    MARKETING_VERSION = 1.0.7;
    PRODUCT_BUNDLE_IDENTIFIER = com.qingjiai;
  };
  buildSettings = {
    CURRENT_PROJECT_VERSION = 8;
    MARKETING_VERSION = 1.0.7;
    PRODUCT_BUNDLE_IDENTIFIER = com.qingjiai.share;
  };
  buildSettings = {
    CURRENT_PROJECT_VERSION = 8;
    MARKETING_VERSION = 1.0.7;
    PRODUCT_BUNDLE_IDENTIFIER = com.qingjiai.share;
  };`;
}

function createFixture({ gradle, xcodeProject, packageVersion } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qingji-identity-'));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'android', 'app'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ios', 'QingJiAI.xcodeproj'), {
    recursive: true,
  });

  const metadata = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'config', 'release-identity.json'),
      'utf8',
    ),
  );
  fs.writeFileSync(
    path.join(root, 'config', 'release-identity.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ version: packageVersion ?? '1.0.7' })}\n`,
  );
  fs.writeFileSync(
    path.join(root, 'android', 'app', 'build.gradle'),
    gradle ?? validGradle(),
  );
  fs.writeFileSync(
    path.join(root, 'ios', 'QingJiAI.xcodeproj', 'project.pbxproj'),
    xcodeProject ?? validXcodeProject(),
  );

  return root;
}

function errorCodes(result) {
  return result.errors.map(error => error.code);
}

test('accepts aligned identities and externally referenced release signing', () => {
  const result = verifyReleaseIdentity({ projectRoot: createFixture() });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
});

test('rejects an unapproved iOS extension bundle identifier', () => {
  const xcodeProject = validXcodeProject().replaceAll(
    'com.qingjiai.share',
    'com.qingjiai.unapproved',
  );
  const result = verifyReleaseIdentity({
    projectRoot: createFixture({ xcodeProject }),
  });

  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes('IDENTITY_IOS_BUNDLE_ID'));
});

test('rejects a production build wired to the public debug key', () => {
  const gradle = validGradle().replace(
    'signingConfig signingConfigs.productionRelease',
    'signingConfig signingConfigs.debug',
  );
  const result = verifyReleaseIdentity({
    projectRoot: createFixture({ gradle }),
  });

  assert.equal(result.ok, false);
  assert.ok(
    errorCodes(result).includes('IDENTITY_ANDROID_RELEASE_DEBUG_SIGNED'),
  );
  assert.ok(
    errorCodes(result).includes('IDENTITY_ANDROID_RELEASE_SIGNING_WIRING'),
  );
});

test('does not accept a commented suffix as internal-track isolation', () => {
  const gradle = validGradle().replace(
    'applicationIdSuffix ".internal"',
    '// applicationIdSuffix ".internal"',
  );
  const result = verifyReleaseIdentity({
    projectRoot: createFixture({ gradle }),
  });

  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes('IDENTITY_ANDROID_INTERNAL_SUFFIX'));
});

test('rejects Android, iOS and package version drift independently', () => {
  const gradle = validGradle()
    .replace('versionCode 8', 'versionCode 7')
    .replace('versionName "1.0.7"', 'versionName "1.0.6"');
  const xcodeProject = validXcodeProject()
    .replaceAll('CURRENT_PROJECT_VERSION = 8', 'CURRENT_PROJECT_VERSION = 7')
    .replaceAll('MARKETING_VERSION = 1.0.7', 'MARKETING_VERSION = 1.0.6')
    .replaceAll('com.qingjiai', 'org.reactjs.native.example.QingJiAI');
  const result = verifyReleaseIdentity({
    projectRoot: createFixture({
      gradle,
      packageVersion: '0.0.1',
      xcodeProject,
    }),
  });
  const codes = errorCodes(result);

  assert.equal(result.ok, false);
  assert.ok(codes.includes('IDENTITY_PACKAGE_VERSION'));
  assert.ok(codes.includes('IDENTITY_ANDROID_BUILD'));
  assert.ok(codes.includes('IDENTITY_ANDROID_VERSION'));
  assert.ok(codes.includes('IDENTITY_IOS_BUILD'));
  assert.ok(codes.includes('IDENTITY_IOS_VERSION'));
  assert.ok(codes.includes('IDENTITY_IOS_BUNDLE_ID'));
  assert.ok(codes.includes('IDENTITY_IOS_TEMPLATE_ID'));
});

test('rejects hardcoded production signing material', () => {
  const gradle = validGradle().replace(
    'keyPassword System.getenv("QINGJI_ANDROID_RELEASE_KEY_PASSWORD")',
    'keyPassword "do-not-commit" // QINGJI_ANDROID_RELEASE_KEY_PASSWORD',
  );
  const result = verifyReleaseIdentity({
    projectRoot: createFixture({ gradle }),
  });

  assert.equal(result.ok, false);
  assert.ok(
    errorCodes(result).includes('IDENTITY_ANDROID_HARDCODED_SIGNING_SECRET'),
  );
  assert.ok(
    errorCodes(result).includes('IDENTITY_ANDROID_SIGNING_SECRET_REFERENCE'),
  );
});
