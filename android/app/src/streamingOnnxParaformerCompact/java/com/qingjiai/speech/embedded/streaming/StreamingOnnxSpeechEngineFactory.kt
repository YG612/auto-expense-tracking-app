package com.qingjiai.speech.embedded.streaming

import android.content.Context
import com.qingjiai.speech.embedded.EmbeddedSpeechEngine
import com.qingjiai.speech.embedded.EmbeddedSpeechEngineFactory

/** Internal-only compact Paraformer candidate with a process-resident recognizer. */
class StreamingOnnxSpeechEngineFactory : EmbeddedSpeechEngineFactory {
  override fun create(context: Context): EmbeddedSpeechEngine =
    StreamingZipformerSpeechEngine(
      context = context.applicationContext,
      recognizerFactory =
        SherpaOnnxParaformerCompactRecognizerAdapterFactory(context.applicationContext),
    )
}
