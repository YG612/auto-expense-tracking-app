package com.qingjiai.speech.embedded

import android.content.Context

data class EmbeddedSpeechAvailability(
  val ready: Boolean,
  val diagnosticCode: String? = null,
)

interface EmbeddedSpeechEngineCallback {
  fun onListening(
    sessionId: String,
    generation: Long,
  )

  fun onPartial(
    sessionId: String,
    generation: Long,
    text: String,
  )

  fun onFinal(
    sessionId: String,
    generation: Long,
    text: String,
  )

  fun onError(
    sessionId: String,
    generation: Long,
    code: String,
    message: String,
    retryable: Boolean,
  )
}

/**
 * Native, app-owned microphone and decoder boundary.
 *
 * Implementations must not persist/upload PCM and must not infer an endpoint.
 * [stop] is the only normal path from capture to decoding.
 */
interface EmbeddedSpeechEngine {
  fun availability(locale: String): EmbeddedSpeechAvailability

  fun start(
    sessionId: String,
    generation: Long,
    locale: String,
    callback: EmbeddedSpeechEngineCallback,
  )

  fun stop(sessionId: String): Boolean

  fun cancel(sessionId: String): Boolean

  fun destroy()
}

interface EmbeddedSpeechEngineFactory {
  fun create(context: Context): EmbeddedSpeechEngine
}
