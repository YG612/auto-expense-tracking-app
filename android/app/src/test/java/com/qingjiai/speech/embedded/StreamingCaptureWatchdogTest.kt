package com.qingjiai.speech.embedded

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamingCaptureWatchdogTest {
  @Test
  fun `watchdog fires while decoder worker is blocked`() {
    val scheduler = Executors.newSingleThreadScheduledExecutor()
    val decoderBlocked = CountDownLatch(1)
    val timeoutObserved = CountDownLatch(1)
    val calls = AtomicInteger(0)
    val watchdog =
      StreamingCaptureWatchdog(scheduler, TimeUnit.MILLISECONDS.toNanos(20L)) {
        calls.incrementAndGet()
        timeoutObserved.countDown()
      }

    watchdog.arm()
    assertEquals(1L, decoderBlocked.count)
    assertTrue(timeoutObserved.await(1, TimeUnit.SECONDS))
    assertEquals(1, calls.get())
    scheduler.shutdownNow()
  }

  @Test
  fun `cancel before deadline suppresses timeout`() {
    val scheduler = Executors.newSingleThreadScheduledExecutor()
    val calls = AtomicInteger(0)
    val watchdog =
      StreamingCaptureWatchdog(scheduler, TimeUnit.MILLISECONDS.toNanos(100L)) {
        calls.incrementAndGet()
      }

    assertTrue(watchdog.arm())
    watchdog.cancel()
    assertFalse(scheduler.awaitTermination(150L, TimeUnit.MILLISECONDS))
    assertEquals(0, calls.get())
    scheduler.shutdownNow()
  }
}
