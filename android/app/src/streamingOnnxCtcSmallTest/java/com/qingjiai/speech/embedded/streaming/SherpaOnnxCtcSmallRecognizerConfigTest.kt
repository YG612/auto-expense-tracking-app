package com.qingjiai.speech.embedded.streaming

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class SherpaOnnxCtcSmallRecognizerConfigTest {
  @Test
  fun `locks the small CTC asset paths and decoder policy`() {
    assertEquals(
      "speech/zipformer-small-ctc-zh-int8-2025-04-01/model.int8.onnx",
      MODEL_ASSET,
    )
    assertEquals(
      "speech/zipformer-small-ctc-zh-int8-2025-04-01/tokens.txt",
      TOKENS_ASSET,
    )
    assertEquals(16_000, SAMPLE_RATE_HZ)
    assertEquals(80, FEATURE_DIM)
    assertEquals(2, DECODER_THREADS)
    assertEquals("cpu", PROVIDER)
    assertEquals("greedy_search", DECODING_METHOD)
    assertFalse(ENABLE_ENDPOINT)
  }
}
