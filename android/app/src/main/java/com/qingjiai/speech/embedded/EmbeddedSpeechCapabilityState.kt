package com.qingjiai.speech.embedded

internal const val EMBEDDED_MODEL_READY = "READY"
internal const val EMBEDDED_MODEL_DOWNLOADING = "DOWNLOADING"
internal const val EMBEDDED_MODEL_UNSUPPORTED = "UNSUPPORTED"
internal const val EMBEDDED_DIAGNOSTIC_WARMING = "embedded-streaming-zipformer-warming"

internal fun embeddedModelState(
  ready: Boolean,
  diagnosticCode: String?,
): String =
  when {
    ready -> EMBEDDED_MODEL_READY
    diagnosticCode == EMBEDDED_DIAGNOSTIC_WARMING -> EMBEDDED_MODEL_DOWNLOADING
    else -> EMBEDDED_MODEL_UNSUPPORTED
  }
