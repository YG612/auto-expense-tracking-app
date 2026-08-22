import type { VoiceTranscriptCorrectionRule } from './voiceTranscriptCorrection';

/**
 * Versioned, reviewable finance substitutions only. Do not add fuzzy pinyin
 * or edit-distance guesses here: every entry needs evidence from an
 * authorized failure recording and must preserve all numeric lexemes.
 */
export const FINANCIAL_VOICE_VOCABULARY_VERSION = 1;

export const FINANCIAL_VOICE_VOCABULARY_RULES: readonly VoiceTranscriptCorrectionRule[] =
  [];
