package com.qingjiai.speech.embedded

private const val MAX_JAVASCRIPT_SAFE_INTEGER = 9_007_199_254_740_991.0

/** Returns a lossless positive JavaScript generation, or null when untrusted. */
internal fun parseSpeechGeneration(value: Double): Long? {
  if (!value.isFinite() || value < 1.0 || value > MAX_JAVASCRIPT_SAFE_INTEGER) return null
  if (value % 1.0 != 0.0) return null
  return value.toLong()
}
