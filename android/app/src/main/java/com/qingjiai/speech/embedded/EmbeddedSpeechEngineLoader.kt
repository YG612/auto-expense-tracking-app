package com.qingjiai.speech.embedded

import android.content.Context
import android.util.Log

data class EmbeddedSpeechEngineLoadResult(
  val engine: EmbeddedSpeechEngine?,
  val diagnosticCode: String,
)

object EmbeddedSpeechEngineLoader {
  private val factoryClasses =
    listOf(
      "com.qingjiai.speech.embedded.streaming.StreamingOnnxSpeechEngineFactory",
      "com.qingjiai.speech.embedded.streaming.StreamingZipformerSpeechEngineFactory",
    )

  fun load(context: Context): EmbeddedSpeechEngineLoadResult {
    var foundFactory = false
    factoryClasses.forEach { className ->
      try {
        val factoryClass = Class.forName(className)
        foundFactory = true
        val factory =
          factoryClass.getDeclaredConstructor().newInstance() as EmbeddedSpeechEngineFactory
        return EmbeddedSpeechEngineLoadResult(
          engine = factory.create(context.applicationContext),
          diagnosticCode = "embedded-streaming-zipformer-ready",
        )
      } catch (_: ClassNotFoundException) {
        // Optional source set is absent; try the next implementation.
      } catch (error: ReflectiveOperationException) {
        Log.e(TAG, "Embedded speech engine factory failed: $className", error)
        return EmbeddedSpeechEngineLoadResult(
          engine = null,
          diagnosticCode = "embedded-engine-factory-failed",
        )
      } catch (error: LinkageError) {
        Log.e(TAG, "Embedded speech runtime failed to link: $className", error)
        return EmbeddedSpeechEngineLoadResult(
          engine = null,
          diagnosticCode = "embedded-runtime-load-failed",
        )
      }
    }
    return EmbeddedSpeechEngineLoadResult(
      engine = null,
      diagnosticCode =
        if (foundFactory) "embedded-engine-factory-failed" else "embedded-engine-not-in-this-build",
    )
  }

  private const val TAG = "QingJiEmbeddedSpeech"
}
