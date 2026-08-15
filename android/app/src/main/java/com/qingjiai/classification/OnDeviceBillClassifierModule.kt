package com.qingjiai.classification

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import org.json.JSONObject

class OnDeviceBillClassifierModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val executor = Executors.newSingleThreadExecutor()
  private val stateLock = Any()
  @Volatile private var handle = 0L
  @Volatile private var loadFailure: String? = null
  private var metadata: ModelMetadata? = null

  override fun getName(): String = NAME

  init {
    executor.execute {
      try {
        val installed = installVerifiedAssets()
        val created = nativeCreate(installed.directory.absolutePath)
        require(created != 0L) { "Native classifier could not be created." }
        synchronized(stateLock) {
          metadata = installed.metadata
          handle = created
        }
      } catch (error: Exception) {
        loadFailure = error.message ?: error.javaClass.simpleName
      }
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    executor.execute {
      val current = metadata
      promise.resolve(Arguments.createMap().apply {
        putBoolean("available", loadFailure == null)
        putBoolean("loaded", handle != 0L)
        current?.let {
          putString("modelId", it.modelId)
          putString("modelVersion", it.modelVersion)
          putInt("taxonomyVersion", it.taxonomyVersion)
        }
        loadFailure?.let { putString("reason", it.take(200)) }
      })
    }
  }

  @ReactMethod
  fun classify(text: String, transactionType: String, promise: Promise) {
    executor.execute {
      try {
        require(text.isNotBlank() && text.length <= MAX_TEXT_LENGTH) {
          "Classification text is invalid."
        }
        require(transactionType == "EXPENSE" || transactionType == "INCOME") {
          "Unsupported transaction type."
        }
        val (currentMetadata, nativeResult) = synchronized(stateLock) {
          val currentHandle = handle
          val loadedMetadata = metadata
          require(currentHandle != 0L && loadedMetadata != null) {
            "On-device model is not loaded."
          }
          loadedMetadata to nativeClassify(currentHandle, text, transactionType)
        }
        val fields = nativeResult.split('\t')
        require(fields.size == 8) { "Native classifier result is malformed." }
        promise.resolve(Arguments.createMap().apply {
          putString("modelId", currentMetadata.modelId)
          putString("modelVersion", currentMetadata.modelVersion)
          putInt("taxonomyVersion", currentMetadata.taxonomyVersion)
          fields[0].takeIf(String::isNotEmpty)?.let { putString("parentCategoryKey", it) }
          fields[1].takeIf(String::isNotEmpty)?.let { putString("subcategoryKey", it) }
          putDouble("top1Probability", fields[2].toDouble())
          putDouble("top2Probability", fields[3].toDouble())
          putDouble("calibratedConfidence", fields[4].toDouble())
          putBoolean("abstained", fields[5] == "1")
          fields[6].takeIf(String::isNotEmpty)?.let { putString("reason", it) }
          putDouble("latencyMs", fields[7].toDouble())
        })
      } catch (error: Exception) {
        promise.reject("bill-classifier-failed", "On-device classification failed.", error)
      }
    }
  }

  @ReactMethod
  fun close(promise: Promise) {
    executor.execute {
      synchronized(stateLock) {
        if (handle != 0L) nativeDestroy(handle)
        handle = 0L
      }
      promise.resolve(null)
    }
  }

  override fun invalidate() {
    synchronized(stateLock) {
      if (handle != 0L) nativeDestroy(handle)
      handle = 0L
    }
    executor.shutdown()
    super.invalidate()
  }

  private fun installVerifiedAssets(): InstalledModel {
    val manifestText = reactContext.assets.open("bill-classifier/manifest.json")
      .bufferedReader(Charsets.UTF_8).use { it.readText() }
    val manifest = JSONObject(manifestText)
    require(manifest.getInt("schemaVersion") == 1) { "Unsupported model manifest." }
    val metadata = ModelMetadata(
      manifest.getString("modelId"),
      manifest.getString("modelVersion"),
      manifest.getInt("taxonomyVersion"),
    )
    val destination = File(reactContext.noBackupFilesDir, "bill-classifier/${metadata.modelVersion}")
    require(destination.mkdirs() || destination.isDirectory) {
      "Model directory could not be created."
    }
    val models = manifest.getJSONArray("models")
    for (index in 0 until models.length()) {
      val spec = models.getJSONObject(index)
      val name = spec.getString("name")
      require(MODEL_NAME.matches(name)) { "Invalid model asset name." }
      val target = File(destination, name)
      if (!target.isFile || target.length() != spec.getLong("sizeBytes") ||
          sha256(target) != spec.getString("sha256")) {
        reactContext.assets.open("bill-classifier/$name").use { input ->
          target.outputStream().use { output -> input.copyTo(output) }
        }
      }
      require(target.length() == spec.getLong("sizeBytes") &&
          sha256(target) == spec.getString("sha256")) {
        "Model asset failed integrity verification."
      }
    }
    return InstalledModel(destination, metadata)
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        digest.update(buffer, 0, count)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private external fun nativeCreate(modelDirectory: String): Long
  private external fun nativeClassify(handle: Long, text: String, transactionType: String): String
  private external fun nativeDestroy(handle: Long)

  private data class ModelMetadata(
    val modelId: String,
    val modelVersion: String,
    val taxonomyVersion: Int,
  )

  private data class InstalledModel(val directory: File, val metadata: ModelMetadata)

  companion object {
    const val NAME = "OnDeviceBillClassifier"
    private const val MAX_TEXT_LENGTH = 500
    private val MODEL_NAME = Regex("^(?:parent-(?:expense|income)|child-expense\\.[a-z_]+)\\.ftz$")

    init {
      System.loadLibrary("qingji_bill_classifier")
    }
  }
}
