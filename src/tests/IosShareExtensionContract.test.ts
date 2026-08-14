import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('iOS share extension contract', () => {
  it('accepts one text or image item and never persists shared pixels', () => {
    const info = read('ios/QingJiAIShare/Info.plist');
    const controller = read('ios/QingJiAIShare/ShareViewController.swift');
    const project = read('ios/QingJiAI.xcodeproj/project.pbxproj');

    expect(info).toContain('NSExtensionActivationSupportsImageWithMaxCount');
    expect(info).toContain('NSExtensionActivationSupportsText');
    expect(controller).toContain('VNRecognizeTextRequest()');
    expect(controller).toContain('Data(contentsOf: url)');
    expect(controller).not.toMatch(/write\(|createFile|UserDefaults/u);
    expect(controller).toContain('prefix(2_000)');
    expect(controller).toContain('打开轻记 AI 核对');
    expect(project).toContain('QingJiAIShare.appex in Embed App Extensions');
    expect(project).toContain('ShareViewController.swift in Sources');
    expect(project).toContain('APPLICATION_EXTENSION_API_ONLY = YES');
  });
});
