package com.qingjiai.speech.embedded

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ManualStopSessionGateTest {
  @Test
  fun `decoder is unreachable until the user explicitly stops`() {
    val gate = ManualStopSessionGate()

    assertTrue(gate.shouldCapture())
    assertFalse(gate.mayDecode())
    assertTrue(gate.markListening())
    assertTrue(gate.shouldCapture())
    assertFalse(gate.mayDecode())

    assertTrue(gate.requestUserStop())
    assertFalse(gate.shouldCapture())
    assertTrue(gate.mayDecode())
  }

  @Test
  fun `cancel never becomes a decode request`() {
    val gate = ManualStopSessionGate()
    gate.markListening()

    assertTrue(gate.cancel())
    assertFalse(gate.shouldCapture())
    assertFalse(gate.mayDecode())
    assertEquals(ManualStopSessionState.CANCELLED, gate.stateForTest())
    assertTrue(gate.finish())
    assertEquals(ManualStopSessionState.TERMINAL, gate.stateForTest())
  }

  @Test
  fun `user stop is idempotent and terminal`() {
    val gate = ManualStopSessionGate()

    assertTrue(gate.requestUserStop())
    assertFalse(gate.requestUserStop())
    assertTrue(gate.finish())
    assertFalse(gate.requestUserStop())
    assertFalse(gate.markListening())
  }
}
