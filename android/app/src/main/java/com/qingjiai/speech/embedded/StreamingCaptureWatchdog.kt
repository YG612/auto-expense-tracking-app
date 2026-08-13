package com.qingjiai.speech.embedded

import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** One-shot wall-clock guard independent from AudioRecord and decoder progress. */
class StreamingCaptureWatchdog(
  private val scheduler: ScheduledExecutorService,
  private val timeoutNanos: Long,
  private val onTimeout: () -> Unit,
) {
  private val future = AtomicReference<ScheduledFuture<*>?>(null)

  init {
    require(timeoutNanos > 0L) { "timeoutNanos must be positive." }
  }

  fun arm(): Boolean {
    val scheduled = scheduler.schedule({ onTimeout() }, timeoutNanos, TimeUnit.NANOSECONDS)
    if (future.compareAndSet(null, scheduled)) return true
    scheduled.cancel(false)
    return false
  }

  fun cancel() {
    future.getAndSet(null)?.cancel(false)
  }
}
