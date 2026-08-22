package com.qingjiai.speech.embedded.streaming

import android.content.Context
import com.qingjiai.speech.embedded.EmbeddedSpeechEngine
import com.qingjiai.speech.embedded.EmbeddedSpeechEngineFactory

/** Small CTC decoder with the existing app-owned capture and session boundary. */
class StreamingOnnxSpeechEngineFactory : EmbeddedSpeechEngineFactory {
  override fun create(context: Context): EmbeddedSpeechEngine =
    StreamingZipformerSpeechEngine(
      context = context.applicationContext,
      recognizerFactory = SherpaOnnxCtcSmallRecognizerAdapterFactory(),
    )
}
