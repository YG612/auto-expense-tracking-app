package com.qingjiai.speech.embedded.streaming

import android.content.Context
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineParaformerModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineStream
import com.qingjiai.speech.embedded.StreamingRecognizerAdapter
import com.qingjiai.speech.embedded.StreamingRecognizerAdapterFactory
import com.qingjiai.speech.embedded.WholeUtteranceDecodeGate
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Whole-utterance, CPU-only Paraformer adapter.
 *
 * Audio is accepted incrementally by the native OfflineStream while the shared
 * capture engine enforces its 30-second ceiling. Decoding starts only after a
 * user stop, so this adapter intentionally emits no speculative partial text.
 */
internal class SherpaOnnxParaformerSmallRecognizerAdapter(
  context: Context,
) : StreamingRecognizerAdapter {
  private val closed = AtomicBoolean(false)
  private val decodeGate = WholeUtteranceDecodeGate()
  private val recognizer =
    OfflineRecognizer(
      assetManager = context.assets,
      config =
        OfflineRecognizerConfig(
          featConfig = FeatureConfig(sampleRate = SAMPLE_RATE_HZ, featureDim = FEATURE_DIM),
          modelConfig =
            OfflineModelConfig(
              paraformer = OfflineParaformerModelConfig(model = MODEL_ASSET),
              tokens = TOKENS_ASSET,
              numThreads = DECODER_THREADS,
              debug = false,
              provider = PROVIDER,
              modelType = MODEL_TYPE,
            ),
          decodingMethod = DECODING_METHOD,
          maxActivePaths = 1,
        ),
    )
  private val stream: OfflineStream = recognizer.createStream()

  override fun acceptSamples(samples: FloatArray) {
    checkOpen()
    check(decodeGate.canAcceptSamples()) { "Whole-utterance input is already finished." }
    stream.acceptWaveform(samples, SAMPLE_RATE_HZ)
  }

  override fun isReady(): Boolean {
    checkOpen()
    return decodeGate.isReady()
  }

  override fun decode() {
    checkOpen()
    check(decodeGate.beginDecode()) { "Whole-utterance decode is not ready or already ran." }
    recognizer.decode(stream)
  }

  override fun inputFinished() {
    checkOpen()
    decodeGate.markInputFinished()
  }

  override fun text(): String {
    checkOpen()
    return if (decodeGate.hasDecoded()) recognizer.getResult(stream).text else ""
  }

  override fun close() {
    if (closed.compareAndSet(false, true)) {
      stream.release()
      recognizer.release()
    }
  }

  private fun checkOpen() = check(!closed.get()) { "Paraformer recognizer is closed." }
}

internal const val MODEL_ROOT = "speech/paraformer-zh-small-int8-2024-03-09"
internal const val MODEL_ASSET = "$MODEL_ROOT/model.int8.onnx"
internal const val TOKENS_ASSET = "$MODEL_ROOT/tokens.txt"
internal const val SAMPLE_RATE_HZ = 16_000
internal const val FEATURE_DIM = 80
internal const val DECODER_THREADS = 2
internal const val PROVIDER = "cpu"
internal const val MODEL_TYPE = "paraformer"
internal const val DECODING_METHOD = "greedy_search"

internal class SherpaOnnxParaformerSmallRecognizerAdapterFactory :
  StreamingRecognizerAdapterFactory {
  override val requiredAssets = listOf(MODEL_ASSET, TOKENS_ASSET)

  override fun create(context: Context): StreamingRecognizerAdapter =
    SherpaOnnxParaformerSmallRecognizerAdapter(context.applicationContext)
}
