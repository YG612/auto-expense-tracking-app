package com.qingjiai.speech.embedded

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SpeechGenerationTest {
  @Test
  fun `accepts only positive lossless JavaScript integers`() {
    assertEquals(1L, parseSpeechGeneration(1.0))
    assertEquals(9_007_199_254_740_991L, parseSpeechGeneration(9_007_199_254_740_991.0))
    assertNull(parseSpeechGeneration(0.0))
    assertNull(parseSpeechGeneration(-1.0))
    assertNull(parseSpeechGeneration(1.5))
    assertNull(parseSpeechGeneration(Double.NaN))
    assertNull(parseSpeechGeneration(Double.POSITIVE_INFINITY))
    assertNull(parseSpeechGeneration(9_007_199_254_740_992.0))
  }
}
