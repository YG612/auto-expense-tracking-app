package com.qingjiai.speech.embedded

import android.content.Context

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
      } catch (_: ReflectiveOperationException) {
        return EmbeddedSpeechEngineLoadResult(
          engine = null,
          diagnosticCode = "embedded-engine-factory-failed",
        )
      } catch (_: LinkageError) {
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
}
