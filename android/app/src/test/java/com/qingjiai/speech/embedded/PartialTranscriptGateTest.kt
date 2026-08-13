package com.qingjiai.speech.embedded

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PartialTranscriptGateTest {
  @Test
  fun `first partial is immediate and duplicate snapshots are suppressed`() {
    val gate = PartialTranscriptGate(minimumIntervalNanos = 100L)

    assertEquals("milk", gate.takeIfDue("  milk  ", nowNanos = 10L))
    assertNull(gate.takeIfDue("milk", nowNanos = 200L))
  }

  @Test
  fun `changed partial is throttled until the interval elapses`() {
    val gate = PartialTranscriptGate(minimumIntervalNanos = 100L)

    assertEquals("buy", gate.takeIfDue("buy", nowNanos = 1_000L))
    assertNull(gate.takeIfDue("buy milk", nowNanos = 1_050L))
    assertEquals("buy milk", gate.takeIfDue("buy milk", nowNanos = 1_100L))
  }

  @Test
  fun `empty decoder snapshots are never emitted`() {
    val gate = PartialTranscriptGate(minimumIntervalNanos = 0L)

    assertNull(gate.takeIfDue("   ", nowNanos = 1L))
  }
}
