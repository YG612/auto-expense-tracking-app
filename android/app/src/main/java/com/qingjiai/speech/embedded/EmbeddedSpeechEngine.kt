package com.qingjiai.speech.embedded

import android.content.Context

data class EmbeddedSpeechAvailability(
  val ready: Boolean,
  val diagnosticCode: String? = null,
)

data class EmbeddedSpeechModel(
  val id: String,
  val label: String,
  val description: String,
  val compressedSizeBytes: Long,
)

data class EmbeddedAudioQuality(
  val estimatedSnrDb: Double?,
  val clippingRatio: Double,
  val voicedDurationMs: Long,
  val noiseTooHigh: Boolean,
)

data class EmbeddedAudioState(
  val volumeLevel: Double,
  val speechDetected: Boolean,
  val trailingSilenceMs: Long,
  val endpointHinted: Boolean,
)

data class EmbeddedRecognitionResult(
  val text: String,
  val acousticConfidence: Double? = null,
  val audioQuality: EmbeddedAudioQuality? = null,
  val endpointHinted: Boolean = false,
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

  fun onFinalResult(
    sessionId: String,
    generation: Long,
    result: EmbeddedRecognitionResult,
  ) {
    onFinal(sessionId, generation, result.text)
  }

  /** Contains derived levels only. PCM never crosses this boundary. */
  fun onAudioState(
    sessionId: String,
    generation: Long,
    state: EmbeddedAudioState,
  ) = Unit

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
  fun availableModels(): List<EmbeddedSpeechModel> = emptyList()

  fun selectedModelId(): String? = null

  /** Returns false when the model is unknown or a recording is active. */
  fun selectModel(modelId: String): Boolean = false

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
