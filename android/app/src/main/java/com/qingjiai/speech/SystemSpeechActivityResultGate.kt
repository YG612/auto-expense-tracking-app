package com.qingjiai.speech

internal data class SystemSpeechActivityLaunch(
  val requestCode: Int,
  val sessionId: String,
  val generation: Int,
)

/**
 * Owns the single outstanding OEM speech Activity result.
 *
 * Request codes are never reused during this gate's lifetime. A cancelled or timed-out launch can
 * therefore be retired immediately: its late result cannot be associated with a newer session.
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
    if (pendingLaunch != null || nextRequestCode > requestCodeEndInclusive) {
      return null
    }

    val launch =
      SystemSpeechActivityLaunch(
        requestCode = nextRequestCode,
        sessionId = sessionId,
        generation = generation,
      )
    nextRequestCode += 1
    pendingLaunch = launch
    return launch
  }

  fun retire(sessionId: String, generation: Int): SystemSpeechActivityLaunch? {
    val pending = pendingLaunch ?: return null
    if (pending.sessionId != sessionId || pending.generation != generation) {
      return null
    }
    pendingLaunch = null
    return pending
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
