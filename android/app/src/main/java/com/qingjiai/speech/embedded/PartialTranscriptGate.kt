package com.qingjiai.speech.embedded

/**
 * Suppresses duplicate decoder snapshots and bounds React Native event traffic.
 *
 * The first non-empty transcript is emitted immediately. Later changes are
 * emitted at most once per [minimumIntervalNanos]. A final result never passes
 * through this gate, so throttling cannot hide the user-requested final text.
 */
class PartialTranscriptGate(
  private val minimumIntervalNanos: Long,
) {
  private var lastEmittedText = ""
  private var lastEmittedAtNanos = Long.MIN_VALUE

  init {
    require(minimumIntervalNanos >= 0L) { "minimumIntervalNanos must not be negative." }
  }

  @Synchronized
  fun takeIfDue(
    text: String,
    nowNanos: Long,
  ): String? {
    val normalized = text.trim()
    if (normalized.isEmpty() || normalized == lastEmittedText) {
      return null
    }
    val firstEmission = lastEmittedAtNanos == Long.MIN_VALUE
    val intervalElapsed =
      firstEmission || nowNanos - lastEmittedAtNanos >= minimumIntervalNanos
    if (!intervalElapsed) {
      return null
    }
    lastEmittedText = normalized
    lastEmittedAtNanos = nowNanos
    return normalized
  }
}
