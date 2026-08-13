package com.qingjiai.speech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechSessionWatchdogTest {
  @Test
  fun `rearming a session invalidates its previous phase token`() {
    val gate = SpeechSessionWatchdogGate()
    val starting = gate.arm("session-1", 1, SpeechWatchdogPhase.STARTING)
    val listening = gate.arm("session-1", 1, SpeechWatchdogPhase.LISTENING)

    assertFalse(gate.consume(starting))
    assertEquals(
      SpeechWatchdogPhase.LISTENING,
      gate.activePhase("session-1", 1),
    )
    assertTrue(gate.consume(listening))
    assertNull(gate.activePhase("session-1", 1))
  }

  @Test
  fun `a reset old session token cannot consume a new session watchdog`() {
    val gate = SpeechSessionWatchdogGate()
    val oldToken = gate.arm("session-1", 1, SpeechWatchdogPhase.FINAL_RESULT)
    gate.reset()
    val newToken = gate.arm("session-2", 3, SpeechWatchdogPhase.STARTING)

    assertFalse(gate.consume(oldToken))
    assertEquals(
      SpeechWatchdogPhase.STARTING,
      gate.activePhase("session-2", 3),
    )
    assertTrue(gate.consume(newToken))
  }

  @Test
  fun `disarm only clears the matching session generation`() {
    val gate = SpeechSessionWatchdogGate()
    gate.arm("session-2", 7, SpeechWatchdogPhase.LISTENING)

    assertFalse(gate.disarm("session-2", 6))
    assertFalse(gate.disarm("session-1", 7))
    assertTrue(gate.disarm("session-2", 7))
    assertNull(gate.activePhase("session-2", 7))
  }

  @Test
  fun `watchdog phases use bounded positive deadlines`() {
    assertEquals(12_000L, SpeechWatchdogPhase.STARTING.timeoutMs)
    assertEquals(35_000L, SpeechWatchdogPhase.LISTENING.timeoutMs)
    assertEquals(8_000L, SpeechWatchdogPhase.FINAL_RESULT.timeoutMs)
    assertEquals(60_000L, SpeechWatchdogPhase.SYSTEM_ACTIVITY.timeoutMs)
    assertEquals(5_000L, SpeechWatchdogPhase.SYSTEM_ACTIVITY_RETURN.timeoutMs)
  }

  @Test
  fun `starting timeout is a service route failure and later phases are no speech`() {
    assertEquals(
      SpeechFailureCode.SERVICE_INCOMPATIBLE,
      SpeechSessionWatchdogPolicy.failureFor(SpeechWatchdogPhase.STARTING).code,
    )
    assertEquals(
      SpeechFailureCode.NO_SPEECH,
      SpeechSessionWatchdogPolicy.failureFor(SpeechWatchdogPhase.LISTENING).code,
    )
    assertEquals(
      SpeechFailureCode.NO_SPEECH,
      SpeechSessionWatchdogPolicy.failureFor(SpeechWatchdogPhase.FINAL_RESULT).code,
    )
    assertEquals(
      SpeechFailureCode.SERVICE_INCOMPATIBLE,
      SpeechSessionWatchdogPolicy.failureFor(SpeechWatchdogPhase.SYSTEM_ACTIVITY).code,
    )
    assertEquals(
      SpeechFailureCode.SERVICE_INCOMPATIBLE,
      SpeechSessionWatchdogPolicy.failureFor(SpeechWatchdogPhase.SYSTEM_ACTIVITY_RETURN).code,
    )
  }
}
