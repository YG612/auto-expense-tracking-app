package com.qingjiai.speech.embedded

import android.content.Context
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Small boundary around the pinned sherpa-ncnn runtime.
 *
 * It lives in the model-free source set so lifecycle logic can be unit tested
 * without loading JNI. The concrete adapter exists only in `streamingAsr`.
 */
interface StreamingRecognizerAdapter : AutoCloseable {
  fun acceptSamples(samples: FloatArray)

  fun isReady(): Boolean

  fun decode()

  fun inputFinished()

  fun text(): String

  fun acousticConfidence(): Double? = null

  override fun close()
}

interface StreamingRecognizerAdapterFactory {
  val requiredAssets: List<String>

  val availableModels: List<EmbeddedSpeechModel>
    get() = emptyList()

  val selectedModelId: String?
    get() = null

  fun selectModel(modelId: String): Boolean = false

  fun create(context: Context): StreamingRecognizerAdapter

  /** Preloads persistent model state off the UI thread. */
  fun warmUp(context: Context) {
    create(context).close()
  }

  /** Releases only factory-owned idle model state. */
  fun releaseIdleResources() = Unit
}

/**
 * Makes a non-streaming recognizer conform to the capture engine's drain loop.
 * It remains not-ready while audio is arriving, becomes ready exactly once
 * after manual stop, and never permits a duplicate whole-utterance decode.
 */
class WholeUtteranceDecodeGate {
  private val inputFinished = AtomicBoolean(false)
  private val decoded = AtomicBoolean(false)

  fun canAcceptSamples(): Boolean = !inputFinished.get()

  fun markInputFinished() {
    inputFinished.set(true)
  }

  fun isReady(): Boolean = inputFinished.get() && !decoded.get()

  fun beginDecode(): Boolean = inputFinished.get() && decoded.compareAndSet(false, true)

  fun hasDecoded(): Boolean = decoded.get()
}
