package com.qingjiai.speech.embedded.streaming

import android.content.Context
import com.qingjiai.speech.embedded.EmbeddedSpeechEngine
import com.qingjiai.speech.embedded.EmbeddedSpeechEngineFactory

/** Internal-only whole-utterance Paraformer candidate. */
class StreamingOnnxSpeechEngineFactory : EmbeddedSpeechEngineFactory {
  override fun create(context: Context): EmbeddedSpeechEngine =
    StreamingZipformerSpeechEngine(
      context = context.applicationContext,
      recognizerFactory = SherpaOnnxParaformerSmallRecognizerAdapterFactory(),
    )
}
