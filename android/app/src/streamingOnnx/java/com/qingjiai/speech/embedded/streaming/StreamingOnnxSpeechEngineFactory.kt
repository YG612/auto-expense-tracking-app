package com.qingjiai.speech.embedded.streaming

import android.content.Context
import com.qingjiai.speech.embedded.EmbeddedSpeechEngine
import com.qingjiai.speech.embedded.EmbeddedSpeechEngineFactory

/** Same capture/session semantics as ncnn, with sherpa-onnx as decoder. */
class StreamingOnnxSpeechEngineFactory : EmbeddedSpeechEngineFactory {
  override fun create(context: Context): EmbeddedSpeechEngine =
    StreamingZipformerSpeechEngine(
      context = context.applicationContext,
      recognizerFactory = SherpaOnnxStreamingRecognizerAdapterFactory(),
    )
}
