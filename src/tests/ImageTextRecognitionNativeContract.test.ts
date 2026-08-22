import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('on-device image text recognition contract', () => {
  it('bundles Android Chinese ML Kit and never uses a network OCR client', () => {
    const gradle = read('android/app/build.gradle');
    const module = read(
      'android/app/src/main/java/com/qingjiai/ocr/ImageTextRecognitionModule.kt',
    );
    const application = read(
      'android/app/src/main/java/com/qingjiai/MainApplication.kt',
    );

    expect(gradle).toContain(
      'com.google.mlkit:text-recognition-chinese:16.0.1',
    );
    expect(gradle).not.toContain(
      'play-services-mlkit-text-recognition-chinese',
    );
    expect(module).toContain('ChineseTextRecognizerOptions.Builder()');
    expect(module).toContain('uri.scheme == "content"');
    expect(module).toContain('MAX_IMAGE_PIXELS');
    expect(module).not.toMatch(/Http|URLConnection|Retrofit|OkHttp/u);
    expect(application).toContain('add(ImageTextRecognitionPackage())');
  });

  it('uses Apple Vision locally with Chinese and English recognition', () => {
    const module = read('ios/QingJiAI/ImageTextRecognition.swift');
    const project = read('ios/QingJiAI.xcodeproj/project.pbxproj');

    expect(module).toContain('VNRecognizeTextRequest()');
    expect(module).toContain('["zh-Hans", "en-US"]');
    expect(module).toContain('kCGImagePropertyPixelWidth');
    expect(module).toContain('24_000_000');
    expect(module).not.toMatch(/URLSession|dataTask|uploadTask/u);
    expect(project).toContain('ImageTextRecognition.swift in Sources');
    expect(project).toContain('ImageTextRecognitionBridge.m in Sources');
  });
});
