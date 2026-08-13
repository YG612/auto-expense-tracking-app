package com.qingjiai.speech.embedded.streaming

import android.content.Context
import com.k2fsa.sherpa.ncnn.DecoderConfig
import com.k2fsa.sherpa.ncnn.FeatureExtractorConfig
import com.k2fsa.sherpa.ncnn.ModelConfig
import com.k2fsa.sherpa.ncnn.RecognizerConfig
import com.k2fsa.sherpa.ncnn.SherpaNcnn
import com.qingjiai.speech.embedded.StreamingRecognizerAdapter
import com.qingjiai.speech.embedded.StreamingRecognizerAdapterFactory
import java.util.concurrent.atomic.AtomicBoolean

/** Thin, source-set-local adapter around the pinned sherpa-ncnn runtime. */
internal class SherpaNcnnStreamingRecognizerAdapter(
  context: Context,
) : StreamingRecognizerAdapter {
  private val closed = AtomicBoolean(false)
  private val recognizer =
    SherpaNcnn(
      config =
        RecognizerConfig(
          featConfig =
            FeatureExtractorConfig(
              sampleRate = SAMPLE_RATE_HZ.toFloat(),
              featureDim = FEATURE_DIM,
            ),
          modelConfig =
            ModelConfig(
              encoderParam = "$MODEL_ROOT/encoder_jit_trace-pnnx.ncnn.param",
              encoderBin = "$MODEL_ROOT/encoder_jit_trace-pnnx.ncnn.bin",
              decoderParam = "$MODEL_ROOT/decoder_jit_trace-pnnx.ncnn.param",
              decoderBin = "$MODEL_ROOT/decoder_jit_trace-pnnx.ncnn.bin",
              joinerParam = "$MODEL_ROOT/joiner_jit_trace-pnnx.ncnn.param",
              joinerBin = "$MODEL_ROOT/joiner_jit_trace-pnnx.ncnn.bin",
              tokens = "$MODEL_ROOT/tokens.txt",
              numThreads = DECODER_THREADS,
              useGPU = false,
            ),
          decoderConfig =
            DecoderConfig(
              method = "greedy_search",
              numActivePaths = 1,
            ),
          // Endpoint detection is deliberately disabled. Silence may update a
          // partial transcript, but only the app's explicit stop command can
          // request inputFinished() and produce a final result.
          enableEndpoint = false,
        ),
      assetManager = context.assets,
    )

  override fun acceptSamples(samples: FloatArray) {
    checkOpen()
    recognizer.acceptSamples(samples)
  }

  override fun isReady(): Boolean {
    checkOpen()
    return recognizer.isReady()
  }

  override fun decode() {
    checkOpen()
    recognizer.decode()
  }

  override fun inputFinished() {
    checkOpen()
    recognizer.inputFinished()
  }

  override fun text(): String {
    checkOpen()
    return recognizer.text
  }

  override fun close() {
    if (closed.compareAndSet(false, true)) {
      // The pinned wrapper is patched with an idempotent release(). Native
      // model/session memory is not left to finalization after a terminal turn.
      recognizer.release()
    }
  }

  private fun checkOpen() = check(!closed.get()) { "Streaming recognizer is closed." }

  companion object {
    private const val MODEL_ROOT = "speech/zipformer-zh-14m"
    private const val SAMPLE_RATE_HZ = 16_000
    private const val FEATURE_DIM = 80
    private const val DECODER_THREADS = 2
  }
}

internal class SherpaNcnnStreamingRecognizerAdapterFactory :
  StreamingRecognizerAdapterFactory {
  override fun create(context: Context): StreamingRecognizerAdapter =
    SherpaNcnnStreamingRecognizerAdapter(context.applicationContext)
}
