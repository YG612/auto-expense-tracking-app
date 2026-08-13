package com.qingjiai.speech.embedded

/**
 * Absolute recording limit backed by a monotonic clock supplied by the caller.
 *
 * The deadline never depends on PCM progress, so repeated zero-length audio
 * reads cannot keep a microphone session alive indefinitely.
 */
internal class RecordingWallClockDeadline(
  private val startedAtNanos: Long,
  private val maxDurationNanos: Long,
) {
  init {
    require(maxDurationNanos > 0L) { "maxDurationNanos must be positive." }
  }

  fun hasExpired(nowNanos: Long): Boolean =
    nowNanos - startedAtNanos >= maxDurationNanos
}
