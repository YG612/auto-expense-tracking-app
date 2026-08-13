package com.qingjiai.speech.embedded

enum class ManualStopSessionState {
  STARTING,
  LISTENING,
  USER_STOP_REQUESTED,
  CANCELLED,
  TERMINAL,
}

/**
 * The decoder is reachable only after an explicit user stop request. Silence,
 * VAD and provider callbacks have no transition that can request decoding.
 */
class ManualStopSessionGate {
  private var state = ManualStopSessionState.STARTING

  @Synchronized
  fun markListening(): Boolean {
    if (state != ManualStopSessionState.STARTING) {
      return false
    }
    state = ManualStopSessionState.LISTENING
    return true
  }

  @Synchronized
  fun requestUserStop(): Boolean {
    if (
      state != ManualStopSessionState.STARTING &&
      state != ManualStopSessionState.LISTENING
    ) {
      return false
    }
    state = ManualStopSessionState.USER_STOP_REQUESTED
    return true
  }

  @Synchronized
  fun cancel(): Boolean {
    if (state == ManualStopSessionState.CANCELLED || state == ManualStopSessionState.TERMINAL) {
      return false
    }
    state = ManualStopSessionState.CANCELLED
    return true
  }

  @Synchronized
  fun finish(): Boolean {
    if (
      state != ManualStopSessionState.USER_STOP_REQUESTED &&
      state != ManualStopSessionState.CANCELLED
    ) {
      return false
    }
    state = ManualStopSessionState.TERMINAL
    return true
  }

  @Synchronized
  fun shouldCapture(): Boolean =
    state == ManualStopSessionState.STARTING || state == ManualStopSessionState.LISTENING

  @Synchronized
  fun mayDecode(): Boolean = state == ManualStopSessionState.USER_STOP_REQUESTED

  @Synchronized
  internal fun stateForTest() = state
}
