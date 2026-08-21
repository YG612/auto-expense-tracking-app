package com.qingjiai.speech.embedded.streaming

import android.content.Context
import com.qingjiai.BuildConfig
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineParaformerModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineStream
import com.qingjiai.speech.embedded.EmbeddedSpeechModel
import com.qingjiai.speech.embedded.StreamingRecognizerAdapter
import com.qingjiai.speech.embedded.StreamingRecognizerAdapterFactory
import com.qingjiai.speech.embedded.WholeUtteranceDecodeGate
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.GZIPInputStream

/** One stream borrowing a process-resident, worker-confined Paraformer recognizer. */
internal class SherpaOnnxParaformerCompactRecognizerAdapter(
  private val recognizer: OfflineRecognizer,
) : StreamingRecognizerAdapter {
  private val closed = AtomicBoolean(false)
  private val decodeGate = WholeUtteranceDecodeGate()
  private val stream: OfflineStream = recognizer.createStream()

  override fun acceptSamples(samples: FloatArray) {
    checkOpen()
    check(decodeGate.canAcceptSamples()) { "Whole-utterance input is already finished." }
    stream.acceptWaveform(samples, COMPACT_SAMPLE_RATE_HZ)
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
    if (closed.compareAndSet(false, true)) stream.release()
  }

  private fun checkOpen() = check(!closed.get()) { "Compact Paraformer stream is closed." }
}

internal const val COMPACT_MODEL_ROOT = "speech/paraformer-zh-compact"
internal const val COMPACT_TOKENS_ASSET = "$COMPACT_MODEL_ROOT/tokens.txt"
internal const val COMPACT_TOKENS_BYTES = 75_352L
internal const val COMPACT_TOKENS_SHA256 =
  "4b2d964e18b9cf139b473003b6698fb2ed9a2a5ec55b93daa677b28f578897aa"
internal const val COMPACT_SAMPLE_RATE_HZ = 16_000
internal const val COMPACT_FEATURE_DIM = 80
internal const val COMPACT_DECODER_THREADS = 2
internal const val DEFAULT_COMPACT_MODEL_ID = "baseline-int8"

internal data class CompactParaformerModelSpec(
  val id: String,
  val label: String,
  val description: String,
  val assetName: String,
  val compressedSizeBytes: Long,
  val compressedSha256: String,
  val unpackedSizeBytes: Long,
  val unpackedSha256: String,
) {
  val assetPath: String = "$COMPACT_MODEL_ROOT/$assetName"

  fun publicModel() =
    EmbeddedSpeechModel(
      id = id,
      label = label,
      description = description,
      compressedSizeBytes = compressedSizeBytes,
    )
}

internal val COMPACT_MODEL_SPECS =
  listOf(
    CompactParaformerModelSpec(
      id = "baseline-int8",
      label = "原始 Paraformer INT8",
      description = "81.8 MB 准确率基线",
      assetName = "model.baseline-int8.qgz",
      compressedSizeBytes = 74_343_945L,
      compressedSha256 = "1a62cbe5f6b1633194abb2325bb089ecd6a9971328ce87d6779e82a1efaec369",
      unpackedSizeBytes = 81_828_675L,
      unpackedSha256 = "3ef6c19369b912f7caf3cef8e545c5ccd1a33d9d7ec792a46668dc41c4b229ec",
    ),
    CompactParaformerModelSpec(
      id = "rtn-safe",
      label = "RTN 安全层 INT4",
      description = "自动评测零退化，当前主候选",
      assetName = "model.rtn-safe.qgz",
      compressedSizeBytes = 63_510_652L,
      compressedSha256 = "9ae585e851047a5d896591a2f0c9e7f51d0d16f42f6495ee812409be3fab3583",
      unpackedSizeBytes = 72_355_603L,
      unpackedSha256 = "39cd81e97e74705900569ecd1d0d27d58e9855b6cb451bce2e8c1b2d30dc3782",
    ),
    CompactParaformerModelSpec(
      id = "hqq-safe",
      label = "HQQ 安全层 INT4",
      description = "validation 改善，重点测试真机速度",
      assetName = "model.hqq-safe.qgz",
      compressedSizeBytes = 64_611_962L,
      compressedSha256 = "e2ee88d190a0a8642c67f8d6d408d6b0e02d03c995aee28c74280c41467d8f15",
      unpackedSizeBytes = 73_180_485L,
      unpackedSha256 = "8e1e00fb4336795b2ab6517617b73746723d41b026b61bc84c0c97396d12bb58",
    ),
    CompactParaformerModelSpec(
      id = "asym-ffn",
      label = "非对称 INT4 · FFN",
      description = "较保守的小体积方案",
      assetName = "model.asym-ffn.qgz",
      compressedSizeBytes = 55_101_450L,
      compressedSha256 = "8c6cb48607dc519a7af0761d96a1cc36008186a38d6f3d1edbd19b48c6c316fe",
      unpackedSizeBytes = 63_584_888L,
      unpackedSha256 = "a63df157d5987374d48bd304c06afd1e25ede264fe239c9b286462836884e73b",
    ),
    CompactParaformerModelSpec(
      id = "asym-ffn-decoder",
      label = "非对称 INT4 · FFN+解码器",
      description = "中等压缩方案",
      assetName = "model.asym-ffn-decoder.qgz",
      compressedSizeBytes = 52_891_738L,
      compressedSha256 = "dfca35b24100dd3b5600c3d7b9e636846efd4af5758872365b6c30e961df9582",
      unpackedSizeBytes = 61_718_939L,
      unpackedSha256 = "f13cd5005a5d6e4318bd0f085d322f6cba8a45bc6be9be3daf7b2eafcd911487",
    ),
    CompactParaformerModelSpec(
      id = "asym-full",
      label = "非对称 INT4 · FFN+解码器+注意力",
      description = "最小模型，重点观察准确率",
      assetName = "model.asym-full.qgz",
      compressedSizeBytes = 45_137_197L,
      compressedSha256 = "6c49bb14b81bef721d16fbffa790fd584b8339073593c3557c17e951267c6cc7",
      unpackedSizeBytes = 55_360_963L,
      unpackedSha256 = "ced10ecc75ba09e682a156b2ab0c40bae5043a7df361c7f1844cf3d7263e6c62",
    ),
  )

internal class SherpaOnnxParaformerCompactRecognizerAdapterFactory(
  context: Context,
) : StreamingRecognizerAdapterFactory {
  private val applicationContext = context.applicationContext
  private val packagedModels =
    BuildConfig.PARAFORMER_COMPACT_MODEL_ID
      .takeIf(String::isNotBlank)
      ?.let { packagedId -> COMPACT_MODEL_SPECS.filter { it.id == packagedId } }
      ?: COMPACT_MODEL_SPECS
  private val defaultModelId = packagedModels.singleOrNull()?.id ?: DEFAULT_COMPACT_MODEL_ID
  private val preferences =
    applicationContext.getSharedPreferences("paraformer-model-lab", Context.MODE_PRIVATE)
  private val selected =
    AtomicReference(
      preferences.getString("selected-model-id", defaultModelId)
        ?.takeIf { candidate -> packagedModels.any { it.id == candidate } }
        ?: defaultModelId,
    )
  private val recognizerLock = Any()
  private var residentModelId: String? = null
  private var residentRecognizer: OfflineRecognizer? = null

  override val requiredAssets: List<String>
    get() = listOf(selectedSpec().assetPath, COMPACT_TOKENS_ASSET)

  override val availableModels = packagedModels.map { it.publicModel() }

  override val selectedModelId: String
    get() = selected.get()

  override fun selectModel(modelId: String): Boolean {
    if (packagedModels.none { it.id == modelId }) return false
    selected.set(modelId)
    preferences.edit().putString("selected-model-id", modelId).apply()
    return true
  }

  override fun warmUp(context: Context) {
    obtainRecognizer()
  }

  override fun create(context: Context): StreamingRecognizerAdapter =
    SherpaOnnxParaformerCompactRecognizerAdapter(obtainRecognizer())

  override fun releaseIdleResources() {
    synchronized(recognizerLock) {
      residentRecognizer?.release()
      residentRecognizer = null
      residentModelId = null
    }
  }

  private fun selectedSpec(): CompactParaformerModelSpec =
    packagedModels.first { it.id == selected.get() }

  private fun obtainRecognizer(): OfflineRecognizer {
    val requested = selectedSpec()
    synchronized(recognizerLock) {
      residentRecognizer?.let { recognizer ->
        if (residentModelId == requested.id) return recognizer
        recognizer.release()
        residentRecognizer = null
        residentModelId = null
      }
      val installed = CompactParaformerAssetInstaller.install(applicationContext, requested)
      val recognizer =
        OfflineRecognizer(
          assetManager = null,
          config =
            OfflineRecognizerConfig(
              featConfig =
                FeatureConfig(
                  sampleRate = COMPACT_SAMPLE_RATE_HZ,
                  featureDim = COMPACT_FEATURE_DIM,
                ),
              modelConfig =
                OfflineModelConfig(
                  paraformer = OfflineParaformerModelConfig(model = installed.model.absolutePath),
                  tokens = installed.tokens.absolutePath,
                  numThreads = COMPACT_DECODER_THREADS,
                  debug = false,
                  provider = "cpu",
                  modelType = "paraformer",
                ),
              decodingMethod = "greedy_search",
              maxActivePaths = 1,
            ),
        )
      residentRecognizer = recognizer
      residentModelId = requested.id
      return recognizer
    }
  }
}

internal data class CompactParaformerFiles(val model: File, val tokens: File)

/** Installs one losslessly compressed test model into no-backup storage on first use. */
internal object CompactParaformerAssetInstaller {
  @Synchronized
  fun install(
    context: Context,
    spec: CompactParaformerModelSpec,
  ): CompactParaformerFiles {
    val root = File(context.noBackupFilesDir, "offline-asr/paraformer-lab-v1/${spec.id}")
    check(root.isDirectory || root.mkdirs()) { "Unable to create compact model directory." }
    val model = File(root, "model.onnx")
    if (!isVerified(model, spec.unpackedSizeBytes, spec.unpackedSha256)) {
      context.assets.open(spec.assetPath).use { compressed ->
        GZIPInputStream(compressed, COPY_BUFFER_BYTES).use { unpacked ->
          installVerified(unpacked, model, spec.unpackedSizeBytes, spec.unpackedSha256)
        }
      }
    }
    val tokens = File(root, "tokens.txt")
    if (!isVerified(tokens, COMPACT_TOKENS_BYTES, COMPACT_TOKENS_SHA256)) {
      context.assets.open(COMPACT_TOKENS_ASSET).use { source ->
        installVerified(source, tokens, COMPACT_TOKENS_BYTES, COMPACT_TOKENS_SHA256)
      }
    }
    return CompactParaformerFiles(model, tokens)
  }

  internal fun installVerified(
    source: InputStream,
    destination: File,
    expectedBytes: Long,
    expectedSha256: String,
  ) {
    check(expectedBytes > 0L)
    check(expectedSha256.matches(Regex("[a-f0-9]{64}")))
    val temporary = File(destination.parentFile, "${destination.name}.tmp")
    if (temporary.exists()) check(temporary.delete()) { "Unable to remove stale compact model temp file." }
    val digest = MessageDigest.getInstance("SHA-256")
    var written = 0L
    try {
      FileOutputStream(temporary).use { output ->
        val buffer = ByteArray(COPY_BUFFER_BYTES)
        while (true) {
          val count = source.read(buffer)
          if (count < 0) break
          if (count == 0) continue
          written += count
          check(written <= expectedBytes) { "Compact model expands beyond its locked size." }
          digest.update(buffer, 0, count)
          output.write(buffer, 0, count)
        }
        output.fd.sync()
      }
      check(written == expectedBytes) { "Compact model size verification failed." }
      check(digest.digest().toHex() == expectedSha256) { "Compact model SHA-256 verification failed." }
      if (destination.exists()) check(destination.delete()) { "Unable to replace stale compact model." }
      check(temporary.renameTo(destination)) { "Unable to publish verified compact model." }
    } catch (failure: Throwable) {
      temporary.delete()
      throw failure
    }
  }

  private fun isVerified(
    file: File,
    expectedBytes: Long,
    expectedSha256: String,
  ): Boolean =
    file.isFile && file.length() == expectedBytes && file.inputStream().use { input ->
      val digest = MessageDigest.getInstance("SHA-256")
      val buffer = ByteArray(COPY_BUFFER_BYTES)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        if (count > 0) digest.update(buffer, 0, count)
      }
      digest.digest().toHex() == expectedSha256
    }

  private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

  private const val COPY_BUFFER_BYTES = 1024 * 1024
}
