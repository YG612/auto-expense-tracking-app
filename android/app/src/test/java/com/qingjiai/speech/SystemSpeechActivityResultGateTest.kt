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
  fun `retired old result cannot match a newer session`() {
    val gate = gate()
    val oldLaunch = requireNotNull(gate.begin("session-old", generation = 1))

    assertEquals(oldLaunch, gate.retire("session-old", generation = 1))
    val newLaunch = requireNotNull(gate.begin("session-new", generation = 2))
    assertNotEquals(oldLaunch.requestCode, newLaunch.requestCode)
    assertNull(gate.consume(oldLaunch.requestCode))
    assertEquals(newLaunch, gate.consume(newLaunch.requestCode))
  }

  @Test
  fun `retire only clears the matching session generation`() {
    val gate = gate()
    val launch = requireNotNull(gate.begin("session-1", generation = 7))

    assertNull(gate.retire("session-1", generation = 6))
    assertNull(gate.retire("other", generation = 7))
    assertEquals(launch, gate.consume(launch.requestCode))
  }

  @Test
  fun `request codes are never reused and exhaustion fails closed`() {
    val gate =
      SystemSpeechActivityResultGate(
        requestCodeStart = 100,
        requestCodeEndInclusive = 101,
      )
    val first = requireNotNull(gate.begin("one", 1))
    gate.retire("one", 1)
    val second = requireNotNull(gate.begin("two", 2))
    gate.retire("two", 2)

    assertNotEquals(first.requestCode, second.requestCode)
    assertNull(gate.begin("three", 3))
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
