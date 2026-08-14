package com.qingjiai.speech.embedded.streaming

import android.content.Context
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineRecognizer
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig
import com.qingjiai.speech.embedded.StreamingRecognizerAdapter
import com.qingjiai.speech.embedded.StreamingRecognizerAdapterFactory
import java.util.concurrent.atomic.AtomicBoolean

internal class SherpaOnnxStreamingRecognizerAdapter(context: Context) :
  StreamingRecognizerAdapter {
  private val closed = AtomicBoolean(false)
  private val recognizer =
    OnlineRecognizer(
      assetManager = context.assets,
      config =
        OnlineRecognizerConfig(
          featConfig = FeatureConfig(sampleRate = SAMPLE_RATE_HZ, featureDim = FEATURE_DIM),
          modelConfig =
            OnlineModelConfig(
              transducer =
                OnlineTransducerModelConfig(
                  encoder = "$MODEL_ROOT/encoder-epoch-99-avg-1.int8.onnx",
                  decoder = "$MODEL_ROOT/decoder-epoch-99-avg-1.onnx",
                  joiner = "$MODEL_ROOT/joiner-epoch-99-avg-1.int8.onnx",
                ),
              tokens = "$MODEL_ROOT/tokens.txt",
              numThreads = DECODER_THREADS,
              debug = false,
              provider = "cpu",
            ),
          enableEndpoint = false,
          decodingMethod = "greedy_search",
          maxActivePaths = 1,
        ),
    )
  private val stream: OnlineStream = recognizer.createStream()

  override fun acceptSamples(samples: FloatArray) {
    checkOpen()
    stream.acceptWaveform(samples, SAMPLE_RATE_HZ)
  }
  override fun isReady(): Boolean { checkOpen(); return recognizer.isReady(stream) }
  override fun decode() { checkOpen(); recognizer.decode(stream) }
  override fun inputFinished() { checkOpen(); stream.inputFinished() }
  override fun text(): String { checkOpen(); return recognizer.getResult(stream).text }
  override fun close() {
    if (closed.compareAndSet(false, true)) {
      stream.release()
      recognizer.release()
    }
  }
  private fun checkOpen() = check(!closed.get()) { "Streaming recognizer is closed." }

  companion object {
    private const val MODEL_ROOT = "speech/zipformer-zh-14m-onnx"
    private const val SAMPLE_RATE_HZ = 16_000
    private const val FEATURE_DIM = 80
    private const val DECODER_THREADS = 2
  }
}

internal class SherpaOnnxStreamingRecognizerAdapterFactory :
  StreamingRecognizerAdapterFactory {
  override fun create(context: Context): StreamingRecognizerAdapter =
    SherpaOnnxStreamingRecognizerAdapter(context.applicationContext)
}
