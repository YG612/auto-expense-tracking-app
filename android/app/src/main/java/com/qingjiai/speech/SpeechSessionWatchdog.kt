package com.qingjiai.speech

internal enum class SpeechWatchdogPhase(
  val timeoutMs: Long,
  val diagnosticStage: String,
) {
  STARTING(12_000L, "start"),
  LISTENING(35_000L, "listening"),
  FINAL_RESULT(8_000L, "result"),
  SYSTEM_ACTIVITY(60_000L, "start"),
  SYSTEM_ACTIVITY_RETURN(5_000L, "result"),
}

internal data class SpeechWatchdogToken(
  val sessionId: String,
  val generation: Int,
  val phase: SpeechWatchdogPhase,
  val sequence: Long,
)

/**
 * Pure validity gate for Handler-backed speech timeouts.
 *
 * Every arm operation creates a new sequence. A Runnable from an old phase or
 * old session therefore cannot consume the current token, even if Android had
 * already dequeued that Runnable when cleanup removed its callback.
 */
internal class SpeechSessionWatchdogGate {
  private var nextSequence = 0L
  private var activeToken: SpeechWatchdogToken? = null

  fun arm(
    sessionId: String,
    generation: Int,
    phase: SpeechWatchdogPhase,
  ): SpeechWatchdogToken {
    require(sessionId.isNotBlank())
    nextSequence += 1
    return SpeechWatchdogToken(
      sessionId = sessionId,
      generation = generation,
      phase = phase,
      sequence = nextSequence,
    ).also { activeToken = it }
  }

  fun consume(token: SpeechWatchdogToken): Boolean {
    if (activeToken != token) {
      return false
    }
    activeToken = null
    return true
  }

  fun activePhase(
    sessionId: String,
    generation: Int,
  ): SpeechWatchdogPhase? =
    activeToken
      ?.takeIf { it.sessionId == sessionId && it.generation == generation }
      ?.phase

  fun disarm(
    sessionId: String,
    generation: Int,
  ): Boolean {
    val token = activeToken ?: return false
    if (token.sessionId != sessionId || token.generation != generation) {
      return false
    }
    activeToken = null
    return true
  }

  fun reset() {
    activeToken = null
  }
}

internal object SpeechSessionWatchdogPolicy {
  fun failureFor(phase: SpeechWatchdogPhase): SpeechFailure =
    when (phase) {
      SpeechWatchdogPhase.STARTING ->
        SpeechFailure(
          SpeechFailureCode.SERVICE_INCOMPATIBLE,
          "The direct speech service did not become ready in time.",
          retryable = true,
        )
      SpeechWatchdogPhase.LISTENING ->
        SpeechFailure(
          SpeechFailureCode.NO_SPEECH,
          "The speech session timed out without usable input.",
          retryable = true,
        )
      SpeechWatchdogPhase.FINAL_RESULT ->
        SpeechFailure(
          SpeechFailureCode.NO_SPEECH,
          "The speech service did not return a final result in time.",
          retryable = true,
        )
      SpeechWatchdogPhase.SYSTEM_ACTIVITY ->
        SpeechFailure(
          SpeechFailureCode.SERVICE_INCOMPATIBLE,
          "The system speech input did not return to the app in time.",
          retryable = true,
        )
      SpeechWatchdogPhase.SYSTEM_ACTIVITY_RETURN ->
        SpeechFailure(
          SpeechFailureCode.SERVICE_INCOMPATIBLE,
          "The system speech input returned without delivering a result.",
          retryable = true,
        )
    }
}
