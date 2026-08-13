package com.qingjiai.speech.embedded

/**
 * Serializes capture, user-stop and terminal races for a streaming session.
 *
 * A user stop grants the decoder permission to flush. Cancellation and a
 * capture timeout are terminal and can never be converted into a final result.
 */
class StreamingSessionControl {
  private val gate = ManualStopSessionGate()
  private var terminal = false

  @Synchronized
  fun markListening(): Boolean = !terminal && gate.markListening()

  @Synchronized
  fun requestUserStop(): Boolean = !terminal && gate.requestUserStop()

  @Synchronized
  fun cancel(): Boolean {
    if (terminal || !gate.cancel()) return false
    terminal = true
    gate.finish()
    return true
  }

  /** Wins only while capture is still active; a prior user stop wins the race. */
  @Synchronized
  fun terminateCaptureError(): Boolean {
    if (terminal || !gate.shouldCapture()) return false
    terminal = true
    gate.cancel()
    gate.finish()
    return true
  }

  /** Covers preparation, capture and decoder failures, including flush. */
  @Synchronized
  fun terminateError(): Boolean {
    if (terminal) return false
    terminal = true
    gate.cancel()
    gate.finish()
    return true
  }

  @Synchronized
  fun completeAfterUserStop(): Boolean {
    if (terminal || !gate.mayDecode()) return false
    terminal = true
    gate.finish()
    return true
  }

  @Synchronized
  fun shouldCapture(): Boolean = !terminal && gate.shouldCapture()

  @Synchronized
  fun mayDecode(): Boolean = !terminal && gate.mayDecode()

  @Synchronized
  fun isTerminal(): Boolean = terminal

  @Synchronized
  internal fun outcomeForTest(): String =
    when {
      terminal -> "terminal"
      gate.mayDecode() -> "user-stop"
      gate.shouldCapture() -> "capture"
      else -> "cancelled"
    }
}
