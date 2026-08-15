package com.qingjiai.agent

import android.content.Context
import android.system.Os
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.time.Instant

data class AgentCommandSnapshot(
  val key: String,
  val callerId: String,
  val idempotencyKey: String,
  val text: String,
  val referenceDate: String?,
  val timezoneOffsetMinutes: Int?,
)

class AgentCommandInboxStore(context: Context) {
  private val directory = File(context.noBackupFilesDir, DIRECTORY_NAME)
  private val resultsDirectory = File(context.noBackupFilesDir, RESULTS_DIRECTORY_NAME)

  fun listPending(): List<AgentCommandSnapshot> {
    val files = directory.listFiles { file -> FILE_NAME.matches(file.name) }
      ?.sortedBy { it.name }
      ?.take(MAX_COMMANDS)
      ?: emptyList()
    return files.mapNotNull { file ->
      try {
        parse(file)
      } catch (_: Exception) {
        // Invalid or oversized external input must reach a terminal state
        // without retaining financial text or being retried forever.
        rejectInvalid(file)
        null
      }
    }
  }

  private fun rejectInvalid(file: File) {
    val key = file.name.removeSuffix(".json")
    try {
      complete(
        key = key,
        status = "REJECTED",
        transactionIds = emptyList(),
        completedAt = Instant.now().toString(),
        errorCode = "AGENT-COMMAND-INVALID",
      )
    } catch (_: Exception) {
      // If a receipt cannot be committed, still remove untrusted financial
      // text so a malformed command cannot become a durable poison item.
      file.delete()
    }
  }

  fun complete(
    key: String,
    status: String,
    transactionIds: List<String>,
    completedAt: String,
    errorCode: String?,
  ) {
    require(KEY.matches(key)) { "Agent command key is invalid." }
    require(COMPLETION_STATUSES.contains(status)) { "Agent result status is invalid." }
    require(transactionIds.size <= MAX_TRANSACTION_IDS &&
      transactionIds.distinct().size == transactionIds.size &&
      transactionIds.all { TRANSACTION_ID.matches(it) }
    ) { "Agent result transaction IDs are invalid." }
    require(completedAt.length in 20..64) { "Agent result timestamp is invalid." }
    require(errorCode == null || ERROR_CODE.matches(errorCode)) {
      "Agent result error code is invalid."
    }
    require((status == "REJECTED") == (errorCode != null)) {
      "Agent result rejection code is inconsistent."
    }
    require(
      when (status) {
        "COMMITTED", "ALREADY_COMMITTED" -> transactionIds.isNotEmpty()
        "CONSUMED_DELETED", "REJECTED" -> transactionIds.isEmpty()
        else -> false
      },
    ) { "Agent result transaction IDs do not match its status." }

    if (!resultsDirectory.isDirectory && !resultsDirectory.mkdirs()) {
      throw IllegalStateException("Agent result directory could not be created.")
    }
    val result = JSONObject().apply {
      put("schemaVersion", 1)
      put("command", "bill.create-pending")
      put("requestKey", key)
      put("status", status)
      put("transactionIds", JSONArray(transactionIds))
      put("completedAt", completedAt)
      if (errorCode != null) put("errorCode", errorCode)
    }.toString()
    val temporary = File(resultsDirectory, "$key.tmp")
    val destination = File(resultsDirectory, "$key.json")
    try {
      FileOutputStream(temporary).use { output ->
        output.write(result.toByteArray(Charsets.UTF_8))
        output.fd.sync()
      }
      // rename(2) atomically replaces an older receipt for the same request key.
      Os.rename(temporary.absolutePath, destination.absolutePath)
    } catch (error: Exception) {
      temporary.delete()
      throw IllegalStateException("Agent result could not be committed atomically.", error)
    }
    // A committed result always precedes command deletion. A crash between the
    // two steps only causes a safe idempotent replay on the next foreground run.
    File(directory, "$key.json").delete()
    pruneResults(key)
  }

  private fun pruneResults(currentKey: String) {
    resultsDirectory.listFiles { file -> FILE_NAME.matches(file.name) }
      ?.filter { it.name != "$currentKey.json" }
      ?.sortedByDescending { it.lastModified() }
      ?.drop(MAX_RESULTS - 1)
      ?.forEach { it.delete() }
  }

  private fun parse(file: File): AgentCommandSnapshot {
    if (!file.isFile || file.length() <= 0 || file.length() > MAX_FILE_BYTES) {
      throw IllegalArgumentException("Agent command file size is invalid.")
    }
    val value = JSONObject(file.readText(Charsets.UTF_8))
    if (value.getInt("schemaVersion") != 1 ||
      value.getString("command") != "bill.create-pending"
    ) {
      throw IllegalArgumentException("Agent command schema is unsupported.")
    }
    val callerId = value.getString("callerId")
    val idempotencyKey = value.getString("idempotencyKey")
    val text = value.getString("text").trim()
    if (!IDENTIFIER.matches(callerId) || !IDENTIFIER.matches(idempotencyKey) ||
      text.isEmpty() || text.codePointCount(0, text.length) > MAX_TEXT_LENGTH
    ) {
      throw IllegalArgumentException("Agent command fields are invalid.")
    }
    val referenceDate = value.optString("referenceDate", "")
      .takeIf { it.isNotEmpty() && it != "null" }
    if (referenceDate != null && referenceDate.length > 64) {
      throw IllegalArgumentException("Agent reference date is invalid.")
    }
    val timezoneOffsetMinutes = if (
      value.has("timezoneOffsetMinutes") && !value.isNull("timezoneOffsetMinutes")
    ) {
      value.getInt("timezoneOffsetMinutes").also {
        require(it in -840..840) { "Agent timezone offset is invalid." }
      }
    } else {
      null
    }
    return AgentCommandSnapshot(
      key = file.name.removeSuffix(".json"),
      callerId = callerId,
      idempotencyKey = idempotencyKey,
      text = text,
      referenceDate = referenceDate,
      timezoneOffsetMinutes = timezoneOffsetMinutes,
    )
  }

  companion object {
    private const val DIRECTORY_NAME = "agent-command-inbox"
    private const val RESULTS_DIRECTORY_NAME = "agent-command-results"
    private const val MAX_COMMANDS = 20
    private const val MAX_RESULTS = 100
    private const val MAX_TRANSACTION_IDS = 20
    private const val MAX_FILE_BYTES = 16_384L
    private const val MAX_TEXT_LENGTH = 500
    private val FILE_NAME = Regex("^[a-f0-9]{64}\\.json$")
    private val KEY = Regex("^[a-f0-9]{64}$")
    private val IDENTIFIER = Regex("^[A-Za-z0-9._:-]{1,128}$")
    private val TRANSACTION_ID = Regex("^[A-Za-z0-9._:-]{1,128}$")
    private val ERROR_CODE = Regex("^[A-Z0-9._:-]{1,128}$")
    private val COMPLETION_STATUSES = setOf(
      "COMMITTED",
      "ALREADY_COMMITTED",
      "CONSUMED_DELETED",
      "REJECTED",
    )
  }
}
