import fs from 'node:fs';
import path from 'node:path';

describe('trusted intelligence privacy contract', () => {
  it('adds no network path to classification, learning, risk, or insight code', () => {
    const files = [
      'src/classification/parseTextTransactions.ts',
      'src/domain/services/financialInsights.ts',
      'src/database/repositories/ClassificationFeedbackRepository.ts',
      'src/database/repositories/UserRuleRepository.ts',
    ];
    const forbidden = /\b(fetch|XMLHttpRequest|WebSocket|axios|https?:\/\/)/u;
    for (const file of files) {
      const source = fs.readFileSync(path.resolve(file), 'utf8');
      expect(source).not.toMatch(forbidden);
    }
  });
});
