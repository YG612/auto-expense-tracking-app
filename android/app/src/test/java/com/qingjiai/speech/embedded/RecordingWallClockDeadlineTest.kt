package com.qingjiai.speech.embedded

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordingWallClockDeadlineTest {
  @Test
  fun `zero sample reads cannot extend the recording deadline`() {
    val oneSecondNanos = 1_000_000_000L
    val deadline =
      RecordingWallClockDeadline(
        startedAtNanos = 5L * oneSecondNanos,
        maxDurationNanos = 30L * oneSecondNanos,
      )

    var nowNanos = 5L * oneSecondNanos
    var totalSamples = 0
    var readAttempts = 0
    var timedOut = false
    while (!timedOut && readAttempts < 1_000) {
      // Mirrors the capture loop's check immediately before AudioRecord.read().
      assertFalse(deadline.hasExpired(nowNanos))
      val simulatedReadCount = 0
      totalSamples += simulatedReadCount
      readAttempts += 1
      nowNanos += 100_000_000L
      // Mirrors the capture loop's check immediately after AudioRecord.read().
      timedOut = deadline.hasExpired(nowNanos)
    }

    assertTrue(timedOut)
    assertEquals(300, readAttempts)
    assertEquals(0, totalSamples)
  }

  @Test
  fun `deadline is absolute and does not rearm after PCM progress`() {
    val deadline =
      RecordingWallClockDeadline(
        startedAtNanos = 10L,
        maxDurationNanos = 60L,
      )

    assertFalse(deadline.hasExpired(nowNanos = 69L))
    assertTrue(deadline.hasExpired(nowNanos = 70L))
    assertTrue(deadline.hasExpired(nowNanos = 100L))
  }

  @Test
  fun `duration must be positive`() {
    assertThrows(IllegalArgumentException::class.java) {
      RecordingWallClockDeadline(startedAtNanos = 0L, maxDurationNanos = 0L)
    }
  }
}
