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
        val created = nativeCreate(
          installed.directory.absolutePath,
          installed.metadata.unifiedConfidence,
          installed.metadata.unifiedMargin,
          installed.metadata.calibrationTemperature,
        )
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
          putString("deploymentMode", it.deploymentMode)
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
        require(fields.size == 9) { "Native classifier result is malformed." }
        val categoryKey = fields[0].takeIf(String::isNotEmpty)
        val calibratedConfidence = fields[4].toDouble()
        val calibratedTop2Probability = fields[5].toDouble()
        var abstained = fields[6] == "1"
        var reason = fields[7].takeIf(String::isNotEmpty)
        if (!abstained && currentMetadata.schemaVersion == 2 && categoryKey != null) {
          val policy = currentMetadata.categoryPolicies[categoryKey]
          if (policy?.enabled != true) {
            abstained = true
            reason = "CATEGORY_DISABLED"
          } else if (calibratedConfidence < policy.confidenceThreshold ||
            calibratedConfidence - calibratedTop2Probability < policy.marginThreshold) {
            abstained = true
            reason = "CATEGORY_THRESHOLD"
          }
        }
        promise.resolve(Arguments.createMap().apply {
          putString("modelId", currentMetadata.modelId)
          putString("modelVersion", currentMetadata.modelVersion)
          putInt("taxonomyVersion", currentMetadata.taxonomyVersion)
          putString("deploymentMode", currentMetadata.deploymentMode)
          categoryKey?.let { putString("parentCategoryKey", it) }
          fields[1].takeIf(String::isNotEmpty)?.let { putString("subcategoryKey", it) }
          putDouble("top1Probability", fields[2].toDouble())
          putDouble("top2Probability", fields[3].toDouble())
          putDouble("calibratedConfidence", calibratedConfidence)
          putDouble("calibratedTop2Probability", calibratedTop2Probability)
          putBoolean("abstained", abstained)
          reason?.let { putString("reason", it) }
          putDouble("latencyMs", fields[8].toDouble())
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
    val schemaVersion = manifest.getInt("schemaVersion")
    require(schemaVersion in 1..2) { "Unsupported model manifest." }
    require(schemaVersion != 2 || !manifest.has("candidateStatus")) {
      "Unapproved candidate models cannot be loaded."
    }
    var deploymentMode = "LEGACY"
    if (schemaVersion == 2) {
      val deployment = manifest.getJSONObject("deployment")
      val mode = deployment.getString("mode")
      deploymentMode = mode
      require(!deployment.getBoolean("allowAutoCommit")) {
        "Unified model deployment cannot enable automatic commits."
      }
      val evidence = when (mode) {
        "SHADOW" -> listOf(
          "selection_report.json" to "selectionReportSha256",
          "MODEL_SELECTION_COMPLETE.json" to "completionReceiptSha256",
          "shadow-activation.json" to "activationSha256",
        )
        "BENCHMARK_ONLY" -> listOf(
          "candidate-manifest.json" to "candidateManifestSha256",
          "evaluation-report.json" to "evaluationReportSha256",
          "error_slices.json" to "errorSlicesSha256",
          "frozen-evaluation-lock.json" to "frozenLockSha256",
        )
        else -> error("Unsupported unified model deployment mode.")
      }
      require(evidence.all { (_, hashKey) ->
        SHA256_HEX.matches(deployment.getString(hashKey))
      }) { "Unified model deployment hashes are invalid." }
      require(evidence.all { (file, hashKey) ->
        val bytes = reactContext.assets.open("bill-classifier/$file").use { it.readBytes() }
        sha256(bytes) == deployment.getString(hashKey)
      }) {
        "Unified model deployment evidence failed integrity verification."
      }
    }
    val thresholds = manifest.getJSONObject("thresholds")
    val categoryPolicies = if (schemaVersion == 2) {
      val values = manifest.getJSONObject("categoryPolicies")
      val policyLabels = mutableSetOf<String>()
      val policyKeys = values.keys()
      while (policyKeys.hasNext()) policyLabels.add(policyKeys.next())
      require(policyLabels == SIMPLIFIED_LABELS) {
        "Unified category policy labels are invalid."
      }
      SIMPLIFIED_LABELS.associateWith { label ->
        val value = values.getJSONObject(label)
        val enabled = value.getBoolean("enabled")
        CategoryPolicy(
          enabled,
          if (enabled) value.getDouble("confidenceThreshold") else 1.0,
          if (enabled) value.getDouble("marginThreshold") else 1.0,
        )
      }.also {
        require(it.getValue("expense.other_expense").enabled.not()) {
          "Other expense must remain user-explicit."
        }
      }
    } else {
      emptyMap()
    }
    val metadata = ModelMetadata(
      schemaVersion,
      manifest.getString("modelId"),
      manifest.getString("modelVersion"),
      manifest.getInt("taxonomyVersion"),
      deploymentMode,
      if (schemaVersion == 2) thresholds.getDouble("unifiedConfidence") else 0.75,
      if (schemaVersion == 2) thresholds.getDouble("unifiedMargin") else 0.12,
      if (schemaVersion == 2) manifest.getDouble("calibrationTemperature") else 1.0,
      categoryPolicies,
    )
    val destination = File(reactContext.noBackupFilesDir, "bill-classifier/${metadata.modelVersion}")
    require(destination.mkdirs() || destination.isDirectory) {
      "Model directory could not be created."
    }
    val models = manifest.getJSONArray("models")
    require(models.length() == if (schemaVersion == 2) 1 else 15) {
      "Unexpected model asset count."
    }
    for (index in 0 until models.length()) {
      val spec = models.getJSONObject(index)
      val name = spec.getString("name")
      require(MODEL_NAME.matches(name)) { "Invalid model asset name." }
      require(schemaVersion != 2 || name == "category-v3.ftz") {
        "Unified manifest must contain only category-v3.ftz."
      }
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

  private fun sha256(bytes: ByteArray): String {
    return MessageDigest.getInstance("SHA-256").digest(bytes)
      .joinToString("") { "%02x".format(it) }
  }

  private external fun nativeCreate(
    modelDirectory: String,
    unifiedConfidence: Double,
    unifiedMargin: Double,
    calibrationTemperature: Double,
  ): Long
  private external fun nativeClassify(handle: Long, text: String, transactionType: String): String
  private external fun nativeDestroy(handle: Long)

  private data class ModelMetadata(
    val schemaVersion: Int,
    val modelId: String,
    val modelVersion: String,
    val taxonomyVersion: Int,
    val deploymentMode: String,
    val unifiedConfidence: Double,
    val unifiedMargin: Double,
    val calibrationTemperature: Double,
    val categoryPolicies: Map<String, CategoryPolicy>,
  )

  private data class CategoryPolicy(
    val enabled: Boolean,
    val confidenceThreshold: Double,
    val marginThreshold: Double,
  )

  private data class InstalledModel(val directory: File, val metadata: ModelMetadata)

  companion object {
    const val NAME = "OnDeviceBillClassifier"
    private const val MAX_TEXT_LENGTH = 500
    private val SIMPLIFIED_LABELS = setOf(
      "income",
      "expense.food",
      "expense.transport",
      "expense.shopping",
      "expense.housing",
      "expense.entertainment",
      "expense.healthcare",
      "expense.education",
      "expense.other_expense",
    )
    private val MODEL_NAME = Regex("^(?:category-v3|parent-(?:expense|income)|child-expense\\.[a-z_]+)\\.ftz$")
    private val SHA256_HEX = Regex("^[a-f0-9]{64}$")

    init {
      System.loadLibrary("qingji_bill_classifier")
    }
  }
}
