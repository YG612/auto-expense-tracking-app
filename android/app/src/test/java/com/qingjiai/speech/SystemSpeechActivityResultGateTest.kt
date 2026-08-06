package com.qingjiai.speech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SystemSpeechActivityResultGateTest {
  @Test
  fun `wrong request code does not consume the pending launch`() {
    val gate = gate()
    val launch = requireNotNull(gate.begin("session-1", generation = 1))

    assertNull(gate.consume(launch.requestCode + 1))
    assertTrue(gate.hasPendingLaunch)
    assertEquals(launch, gate.consume(launch.requestCode))
  }

  @Test
  fun `pending launch rejects another system Activity`() {
    val gate = gate()
    requireNotNull(gate.begin("session-1", generation = 1))

    assertNull(gate.begin("session-2", generation = 2))
    assertTrue(gate.hasPendingLaunch)
  }

  @Test
  fun `cancelled old result cannot match a newer session`() {
    val gate = gate()
    val oldLaunch = requireNotNull(gate.begin("session-old", generation = 1))

    assertTrue(gate.markCancelled("session-old", generation = 1))
    assertNull(gate.begin("session-new", generation = 2))

    val cancelledResult = requireNotNull(gate.consume(oldLaunch.requestCode))
    assertTrue(cancelledResult.cancelled)
    assertEquals("session-old", cancelledResult.sessionId)

    val newLaunch = requireNotNull(gate.begin("session-new", generation = 2))
    assertNotEquals(oldLaunch.requestCode, newLaunch.requestCode)
    assertNull(gate.consume(oldLaunch.requestCode))
    assertEquals(newLaunch, gate.consume(newLaunch.requestCode))
  }

  @Test
  fun `correct result is consumed exactly once`() {
    val gate = gate()
    val launch = requireNotNull(gate.begin("session-1", generation = 7))

    assertEquals(launch, gate.consume(launch.requestCode))
    assertFalse(gate.hasPendingLaunch)
    assertNull(gate.consume(launch.requestCode))
  }

  private fun gate() =
    SystemSpeechActivityResultGate(
      requestCodeStart = 100,
      requestCodeEndInclusive = 110,
    )
}
