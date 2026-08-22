package com.qingjiai.speech.embedded.streaming

import android.content.Context
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineRecognizer
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineZipformer2CtcModelConfig
import com.qingjiai.speech.embedded.StreamingRecognizerAdapter
import com.qingjiai.speech.embedded.StreamingRecognizerAdapterFactory
import java.util.concurrent.atomic.AtomicBoolean

/** App-owned adapter for the small Chinese streaming Zipformer2 CTC model. */
internal class SherpaOnnxCtcSmallRecognizerAdapter(
  context: Context,
) : StreamingRecognizerAdapter {
  private val closed = AtomicBoolean(false)
  private val recognizer =
    OnlineRecognizer(
      assetManager = context.assets,
      config =
        OnlineRecognizerConfig(
          featConfig = FeatureConfig(sampleRate = SAMPLE_RATE_HZ, featureDim = FEATURE_DIM),
          modelConfig =
            OnlineModelConfig(
              zipformer2Ctc =
                OnlineZipformer2CtcModelConfig(
                  model = MODEL_ASSET,
                ),
              tokens = TOKENS_ASSET,
              numThreads = DECODER_THREADS,
              debug = false,
              provider = PROVIDER,
            ),
          enableEndpoint = ENABLE_ENDPOINT,
          decodingMethod = DECODING_METHOD,
          maxActivePaths = 1,
        ),
    )
  private val stream: OnlineStream = recognizer.createStream()

  override fun acceptSamples(samples: FloatArray) {
    checkOpen()
    stream.acceptWaveform(samples, SAMPLE_RATE_HZ)
  }

  override fun isReady(): Boolean {
    checkOpen()
    return recognizer.isReady(stream)
  }

  override fun decode() {
    checkOpen()
    recognizer.decode(stream)
  }

  override fun inputFinished() {
    checkOpen()
    stream.inputFinished()
  }

  override fun text(): String {
    checkOpen()
    return recognizer.getResult(stream).text
  }

  override fun close() {
    if (closed.compareAndSet(false, true)) {
      stream.release()
      recognizer.release()
    }
  }

  private fun checkOpen() = check(!closed.get()) { "Streaming recognizer is closed." }

}

internal const val MODEL_ROOT =
  "speech/zipformer-small-ctc-zh-int8-2025-04-01"
internal const val MODEL_ASSET = "$MODEL_ROOT/model.int8.onnx"
internal const val TOKENS_ASSET = "$MODEL_ROOT/tokens.txt"
internal const val SAMPLE_RATE_HZ = 16_000
internal const val FEATURE_DIM = 80
internal const val DECODER_THREADS = 2
internal const val PROVIDER = "cpu"
internal const val DECODING_METHOD = "greedy_search"
internal const val ENABLE_ENDPOINT = false

internal class SherpaOnnxCtcSmallRecognizerAdapterFactory :
  StreamingRecognizerAdapterFactory {
  override val requiredAssets = listOf(MODEL_ASSET, TOKENS_ASSET)

  override fun create(context: Context): StreamingRecognizerAdapter =
    SherpaOnnxCtcSmallRecognizerAdapter(context.applicationContext)
}
