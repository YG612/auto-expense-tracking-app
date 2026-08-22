import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');

describe('on-device bill classifier native contract', () => {
  it('keeps Android native classification local and verified', () => {
    const module = fs.readFileSync(
      path.join(
        root,
        'android/app/src/main/java/com/qingjiai/classification/OnDeviceBillClassifierModule.kt',
      ),
      'utf8',
    );
    expect(module).toContain('assets.open("bill-classifier/manifest.json")');
    expect(module).toContain('MessageDigest.getInstance("SHA-256")');
    expect(module).toContain('noBackupFilesDir');
    expect(module).toContain('category-v3.ftz');
    expect(module).toContain('unifiedConfidence');
    expect(module).toContain('categoryPolicies');
    expect(module).toContain('fields.size == 9');
    expect(module).toContain('scoreCounterpartyCandidates');
    expect(module).toContain('counterparty-candidate-v1.ftz');
    expect(module).toMatch(
      /val \(currentMetadata, scoredFields\) = synchronized\(stateLock\) \{(?:(?!\n {8}\}).)*nativeScoreCounterpartyCandidate\(handle, modelText\)/su,
    );
    expect(module).toContain('Unapproved candidate models cannot be loaded.');
    expect(module).toContain('selection_report.json');
    expect(module).toContain('MODEL_SELECTION_COMPLETE.json');
    expect(module).toContain('BENCHMARK_ONLY');
    expect(module).toContain(
      'deployment evidence failed integrity verification',
    );
    expect(module).not.toMatch(/SQLite|fetch\(|https?:\/\//u);
  });

  it('compiles the same fastText core and model directory on iOS', () => {
    const project = fs.readFileSync(
      path.join(root, 'ios/QingJiAI.xcodeproj/project.pbxproj'),
      'utf8',
    );
    const module = fs.readFileSync(
      path.join(root, 'ios/QingJiAI/OnDeviceBillClassifier.mm'),
      'utf8',
    );
    expect(project).toContain('OnDeviceBillClassifierCore.cc in Sources');
    expect(project).toContain('fasttext.cc in Sources');
    expect(project).toContain('bill-classifier in Resources');
    expect(project).toContain('$(BILL_CLASSIFIER_ASSETS_ROOT)/bill-classifier');
    expect(project).toContain('BILL_CLASSIFIER_ASSETS_ROOT');
    expect(module).toContain('CC_SHA256_Init');
    expect(module).toContain('OnDeviceBillClassifierCore');
    expect(module).toContain('category-v3');
    expect(module).toContain('calibrationTemperature');
    expect(module).toContain('_categoryPolicies');
    expect(module).toContain('calibratedTop2Probability');
    expect(module).toContain('scoreCounterpartyCandidates');
    expect(module).toContain('counterparty-candidate-v1.ftz');
    expect(module).toContain('Unapproved candidate models cannot be loaded.');
    expect(module).toContain('selection_report.json');
    expect(module).toContain('MODEL_SELECTION_COMPLETE.json');
    expect(module).toContain('BENCHMARK_ONLY');
    expect(module).toContain(
      'deployment evidence failed integrity verification',
    );
    expect(module).toContain('runBenchmarkIfRequested');
    expect(module).toContain('--qingji-bill-classifier-benchmark');
    expect(module).toContain('IOS_ARM64_BENCHMARK_ONLY_APP');
    expect(module).toContain('TARGET_OS_SIMULATOR');
    expect(module).not.toMatch(/NSURLSession|https?:\/\//u);
  });
});
