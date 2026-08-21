package com.qingjiai.speech.embedded

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WholeUtteranceDecodeGateTest {
  @Test
  fun `decode becomes ready only after input finished and runs once`() {
    val gate = WholeUtteranceDecodeGate()

    assertTrue(gate.canAcceptSamples())
    assertFalse(gate.isReady())
    assertFalse(gate.beginDecode())

    gate.markInputFinished()

    assertFalse(gate.canAcceptSamples())
    assertTrue(gate.isReady())
    assertTrue(gate.beginDecode())
    assertTrue(gate.hasDecoded())
    assertFalse(gate.isReady())
    assertFalse(gate.beginDecode())
  }

  @Test
  fun `repeated finish remains idempotent`() {
    val gate = WholeUtteranceDecodeGate()

    gate.markInputFinished()
    gate.markInputFinished()

    assertTrue(gate.isReady())
    assertTrue(gate.beginDecode())
    assertFalse(gate.beginDecode())
  }
}
