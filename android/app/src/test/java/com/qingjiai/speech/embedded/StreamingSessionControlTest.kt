package com.qingjiai.speech.embedded

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamingSessionControlTest {
  @Test
  fun `stop before worker starts remains flushable and reaches one final`() {
    val control = StreamingSessionControl()

    assertTrue(control.requestUserStop())
    assertFalse(control.shouldCapture())
    assertTrue(control.mayDecode())
    assertTrue(control.completeAfterUserStop())
    assertFalse(control.completeAfterUserStop())
  }

  @Test
  fun `cancel during decode wins without permitting a final`() {
    val control = StreamingSessionControl()
    control.markListening()
    control.requestUserStop()

    assertTrue(control.cancel())
    assertFalse(control.mayDecode())
    assertFalse(control.completeAfterUserStop())
  }

  @Test
  fun `timeout versus stop produces exactly one terminal winner`() {
    repeat(100) {
      val control = StreamingSessionControl()
      control.markListening()
      val ready = CountDownLatch(2)
      val go = CountDownLatch(1)
      val pool = Executors.newFixedThreadPool(2)
      val stop = pool.submit<Boolean> {
        ready.countDown()
        go.await()
        control.requestUserStop()
      }
      val timeout = pool.submit<Boolean> {
        ready.countDown()
        go.await()
        control.terminateCaptureError()
      }
      assertTrue(ready.await(1, TimeUnit.SECONDS))
      go.countDown()
      val stopWon = stop.get(1, TimeUnit.SECONDS)
      val timeoutWon = timeout.get(1, TimeUnit.SECONDS)
      pool.shutdownNow()

      assertEquals(1, listOf(stopWon, timeoutWon).count { won -> won })
      if (stopWon) {
        assertTrue(control.mayDecode())
        assertTrue(control.completeAfterUserStop())
      } else {
        assertFalse(control.mayDecode())
        assertFalse(control.completeAfterUserStop())
      }
    }
  }

  @Test
  fun `stop before timeout keeps the explicit-stop decode grant`() {
    val control = StreamingSessionControl()
    control.markListening()

    assertTrue(control.requestUserStop())
    assertFalse(control.terminateCaptureError())
    assertEquals("user-stop", control.outcomeForTest())
    assertTrue(control.completeAfterUserStop())
  }

  @Test
  fun `timeout before stop is an error and can never final`() {
    val control = StreamingSessionControl()
    control.markListening()

    assertTrue(control.terminateCaptureError())
    assertFalse(control.requestUserStop())
    assertEquals("terminal", control.outcomeForTest())
    assertFalse(control.completeAfterUserStop())
  }

  @Test
  fun `late callbacks cannot change a terminal session`() {
    val control = StreamingSessionControl()
    assertTrue(control.cancel())

    assertFalse(control.markListening())
    assertFalse(control.requestUserStop())
    assertFalse(control.terminateError())
    assertFalse(control.completeAfterUserStop())
  }
}
