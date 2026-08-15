import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { openIosSimulatorReview } from '../agent/IosReviewBridge';

describe('iOS agent review boundary', () => {
  it('dry-run exposes review-only behavior without returning bill text', () => {
    const result = openIosSimulatorReview({
      text: '午饭25元，微信',
      dryRun: true,
    });
    expect(result.status).toBe('DRY_RUN');
    expect(result).not.toHaveProperty('text');
    expect(result.safety).toContain('不会启动 Simulator 或写入账本');
  });

  it('forwards qingjiai URLs to React Native Linking on iOS', () => {
    const source = readFileSync(
      resolve(__dirname, '../../ios/QingJiAI/AppDelegate.swift'),
      'utf8',
    );
    expect(source).toContain('RCTLinkingManager.application(');
    expect(source).toContain('open url: URL');
  });

  it('registers review-only App Intents backed by a protected temporary inbox', () => {
    const root = resolve(__dirname, '../..');
    const intents = readFileSync(
      resolve(root, 'ios/QingJiAI/AgentAppIntents.swift'),
      'utf8',
    );
    const delegate = readFileSync(
      resolve(root, 'ios/QingJiAI/AppDelegate.swift'),
      'utf8',
    );
    const project = readFileSync(
      resolve(root, 'ios/QingJiAI.xcodeproj/project.pbxproj'),
      'utf8',
    );
    const navigation = readFileSync(
      resolve(root, 'src/navigation/RootNavigator.tsx'),
      'utf8',
    );
    const qualityGate = readFileSync(
      resolve(root, '.github/workflows/quality-gate.yml'),
      'utf8',
    );

    expect(intents).toContain('struct QingJiPreviewBillIntent: AppIntent');
    expect(intents).toContain(
      'struct QingJiPreparePendingBillIntent: AppIntent',
    );
    expect(intents).toContain('struct QingJiOpenPendingBillsIntent: AppIntent');
    expect(intents).toContain('FileManager.default.temporaryDirectory');
    expect(intents).toContain('[.atomic, .completeFileProtection]');
    expect(intents).toContain('private static let maxTextLength = 500');
    expect(intents).toContain('!text.contains("\\0")');
    expect(intents).not.toMatch(/SQLite|createPendingAgentBills|CONFIRMED/u);
    expect(delegate).toContain('QingJiAgentIntentInbox.consumeURL()');
    expect(project).toContain('AgentAppIntents.swift in Sources');
    expect(navigation).toContain("linking: 'pending'");
    expect(qualityGate).toContain('-target arm64-apple-ios16.0-simulator');
    expect(qualityGate).toContain('ios/QingJiAI/AgentAppIntents.swift');
  });
});
