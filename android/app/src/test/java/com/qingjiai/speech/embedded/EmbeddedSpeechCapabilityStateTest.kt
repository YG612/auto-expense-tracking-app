package com.qingjiai.speech.embedded

import org.junit.Assert.assertEquals
import org.junit.Test

class EmbeddedSpeechCapabilityStateTest {
  @Test
  fun `warming is preparing rather than unsupported`() {
    assertEquals(
      EMBEDDED_MODEL_DOWNLOADING,
      embeddedModelState(false, EMBEDDED_DIAGNOSTIC_WARMING),
    )
  }

  @Test
  fun `settled states remain ready or unsupported`() {
    assertEquals(EMBEDDED_MODEL_READY, embeddedModelState(true, "ready"))
    assertEquals(EMBEDDED_MODEL_UNSUPPORTED, embeddedModelState(false, "missing"))
  }
}
