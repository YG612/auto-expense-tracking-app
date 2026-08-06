package com.qingjiai.speech

internal data class SystemSpeechActivityLaunch(
  val requestCode: Int,
  val sessionId: String,
  val generation: Int,
  val cancelled: Boolean = false,
)

/**
 * Owns the single outstanding OEM speech Activity result.
 *
 * A cancelled launch intentionally remains pending until Android returns its result. This prevents
 * a late result from an old Activity being associated with a newer speech session.
 */
internal class SystemSpeechActivityResultGate(
  private val requestCodeStart: Int = DEFAULT_REQUEST_CODE_START,
  private val requestCodeEndInclusive: Int = DEFAULT_REQUEST_CODE_END,
) {
  private var nextRequestCode = requestCodeStart
  private var pendingLaunch: SystemSpeechActivityLaunch? = null

  init {
    require(requestCodeStart >= 0)
    require(requestCodeEndInclusive >= requestCodeStart)
    require(requestCodeEndInclusive <= 0xFFFF)
  }

  val hasPendingLaunch: Boolean
    get() = pendingLaunch != null

  fun begin(sessionId: String, generation: Int): SystemSpeechActivityLaunch? {
    if (pendingLaunch != null) {
      return null
    }

    val launch =
      SystemSpeechActivityLaunch(
        requestCode = nextRequestCode,
        sessionId = sessionId,
        generation = generation,
      )
    nextRequestCode =
      if (nextRequestCode == requestCodeEndInclusive) {
        requestCodeStart
      } else {
        nextRequestCode + 1
      }
    pendingLaunch = launch
    return launch
  }

  fun markCancelled(sessionId: String, generation: Int): Boolean {
    val pending = pendingLaunch ?: return false
    if (pending.sessionId != sessionId || pending.generation != generation) {
      return false
    }
    pendingLaunch = pending.copy(cancelled = true)
    return true
  }

  fun abandon(launch: SystemSpeechActivityLaunch): Boolean {
    val pending = pendingLaunch ?: return false
    if (!pending.matches(launch)) {
      return false
    }
    pendingLaunch = null
    return true
  }

  fun consume(requestCode: Int): SystemSpeechActivityLaunch? {
    val pending = pendingLaunch ?: return null
    if (pending.requestCode != requestCode) {
      return null
    }
    pendingLaunch = null
    return pending
  }

  fun reset() {
    pendingLaunch = null
  }

  private fun SystemSpeechActivityLaunch.matches(other: SystemSpeechActivityLaunch) =
    requestCode == other.requestCode &&
      sessionId == other.sessionId &&
      generation == other.generation

  private companion object {
    const val DEFAULT_REQUEST_CODE_START = 0x4000
    const val DEFAULT_REQUEST_CODE_END = 0x7FFE
  }
}
