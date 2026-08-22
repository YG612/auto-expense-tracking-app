package com.qingjiai.speech.embedded

import kotlin.math.PI
import kotlin.math.sin
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AdaptiveVoiceActivityDetectorTest {
  @Test
  fun `long silence is advisory and never appears before speech`() {
    val detector = AdaptiveVoiceActivityDetector()
    val silence = ShortArray(1_600)

    repeat(15) {
      assertFalse(detector.accept(silence, silence.size).endpointHinted)
    }
    assertFalse(detector.hasDetectedSpeech())
    assertEquals(0L, detector.quality().voicedDurationMs)
  }

  @Test
  fun `speech followed by nine hundred milliseconds produces endpoint hint`() {
    val detector = AdaptiveVoiceActivityDetector()
    val silence = ShortArray(1_600)
    val speech = tone(amplitude = 5_000)
    repeat(3) { detector.accept(silence, silence.size) }
    repeat(3) { detector.accept(speech, speech.size) }

    var state = detector.accept(silence, silence.size)
    repeat(8) { state = detector.accept(silence, silence.size) }

    assertTrue(state.speechDetected)
    assertTrue(state.endpointHinted)
    assertTrue(state.trailingSilenceMs >= 900)
  }

  @Test
  fun `quality reports clipping without retaining pcm`() {
    val detector = AdaptiveVoiceActivityDetector()
    val silence = ShortArray(1_600)
    repeat(3) { detector.accept(silence, silence.size) }
    val clipped = ShortArray(1_600) { if (it % 2 == 0) Short.MAX_VALUE else Short.MIN_VALUE }

    detector.accept(clipped, clipped.size)

    assertTrue(detector.quality().clippingRatio > 0.2)
  }

  private fun tone(amplitude: Int): ShortArray =
    ShortArray(1_600) { index ->
      (sin(2.0 * PI * 200.0 * index / 16_000.0) * amplitude).toInt().toShort()
    }
}
