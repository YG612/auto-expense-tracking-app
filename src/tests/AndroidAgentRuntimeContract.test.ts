import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Android Internal agent runtime contract', () => {
  it('keeps React Native appmodules linked alongside the classifier library', () => {
    const cmake = read('android/app/CMakeLists.txt');

    expect(cmake).toContain('project(appmodules LANGUAGES CXX)');
    expect(cmake).toContain(
      'include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)',
    );
    expect(cmake).toContain('qingji_bill_classifier');
  });

  it('uses matching debug native artifacts without enabling Metro for Internal', () => {
    const gradle = read('android/app/build.gradle');
    const application = read(
      'android/app/src/main/java/com/qingjiai/MainApplication.kt',
    );

    expect(gradle).toContain('matchingFallbacks = ["debug"]');
    expect(application).toContain(
      'useDevSupport = BuildConfig.APPLICATION_ID.endsWith(".debug")',
    );
  });

  it('keeps the optional embedded speech factories across R8 shrinking', () => {
    const proguard = read('android/app/proguard-rules.pro');
    const gradle = read('android/app/build.gradle');

    expect(proguard).toContain(
      '-keep class com.qingjiai.speech.embedded.streaming.StreamingOnnxSpeechEngineFactory',
    );
    expect(proguard).toContain(
      '-keep class com.qingjiai.speech.embedded.streaming.StreamingZipformerSpeechEngineFactory',
    );
    expect(gradle).toContain(
      'R8 removed the reflectively loaded embedded speech engine factory.',
    );
  });
});
