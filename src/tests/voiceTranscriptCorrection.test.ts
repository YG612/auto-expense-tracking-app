import type { Merchant } from '../domain/entities';
import {
  correctVoiceTranscript,
  type VoiceTranscriptCorrectionRule,
} from '../speech/voiceTranscriptCorrection';

const merchant: Merchant = {
  id: 'merchant-1',
  canonicalName: '一鸣真鲜奶吧',
  normalizedName: '一鸣真鲜奶吧',
  aliases: ['一明真鲜奶吧'],
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
};

function rule(
  id: string,
  from: string,
  to: string,
): VoiceTranscriptCorrectionRule {
  return { id, from, to, source: 'CURATED' };
}

describe('voice transcript correction', () => {
  it('canonicalizes an exact local merchant alias without changing the amount', () => {
    expect(
      correctVoiceTranscript('一明真鲜奶吧12元', { merchants: [merchant] }),
    ).toMatchObject({
      rawText: '一明真鲜奶吧12元',
      correctedText: '一鸣真鲜奶吧12元',
      edits: [
        {
          source: 'MERCHANT_ALIAS',
          original: '一明真鲜奶吧',
          replacement: '一鸣真鲜奶吧',
        },
      ],
    });
  });

  it('uses the longest non-overlapping explicit rule', () => {
    const result = correctVoiceTranscript('沙线小吃午饭25元', {
      rules: [
        rule('short', '沙线', '沙县'),
        rule('long', '沙线小吃', '沙县小吃'),
      ],
    });
    expect(result.correctedText).toBe('沙县小吃午饭25元');
    expect(result.edits.map(edit => edit.ruleId)).toEqual(['long']);
  });

  it('rejects ambiguous rules for the same source text', () => {
    const result = correctVoiceTranscript('同音词20元', {
      rules: [
        rule('left', '同音词', '候选甲'),
        rule('right', '同音词', '候选乙'),
      ],
    });
    expect(result.correctedText).toBe('同音词20元');
    expect(result.edits).toEqual([]);
  });

  it('never accepts rules that contain numeric concepts', () => {
    const result = correctVoiceTranscript('午饭二十五元', {
      rules: [rule('unsafe', '二十五', '三十五')],
    });
    expect(result.correctedText).toBe('午饭二十五元');
    expect(result.edits).toEqual([]);
  });

  it('does not rewrite amount, date, or time units around protected numbers', () => {
    const result = correctVoiceTranscript('八月二十一日十二点付了30元', {
      rules: [
        rule('amount-unit', '30元', '30块'),
        rule('date-unit', '二十一日', '二十一号'),
        rule('time-unit', '十二点', '十二时'),
      ],
    });

    expect(result.correctedText).toBe('八月二十一日十二点付了30元');
    expect(result.edits).toEqual([]);
  });

  it('keeps multiple transaction numeric lexemes byte-identical', () => {
    const result = correctVoiceTranscript('沙线午饭25，打车18.5', {
      rules: [rule('merchant', '沙线', '沙县')],
    });
    expect(result.correctedText).toBe('沙县午饭25，打车18.5');
    expect(result.rawText.match(/\d+(?:\.\d+)?/gu)).toEqual(
      result.correctedText.match(/\d+(?:\.\d+)?/gu),
    );
  });

  it('accepts only explicit versioned financial vocabulary rules', () => {
    const financialRule: VoiceTranscriptCorrectionRule = {
      id: 'finance:payment:reviewed-1',
      from: '支富宝',
      to: '支付宝',
      source: 'FINANCIAL_VOCABULARY',
    };
    const result = correctVoiceTranscript('支富宝支付88元', {
      financialRules: [financialRule],
    });

    expect(result.correctedText).toBe('支付宝支付88元');
    expect(result.edits).toMatchObject([
      { ruleId: 'finance:payment:reviewed-1', source: 'FINANCIAL_VOCABULARY' },
    ]);
  });
});
