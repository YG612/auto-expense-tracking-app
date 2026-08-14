package com.qingjiai.files

import android.app.Activity
import android.content.Intent
import android.provider.OpenableColumns
import android.util.Base64
import android.net.Uri
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.BufferedWriter
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets

class LedgerFilePortalModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private data class PendingSave(
    val content: String,
    val promise: Promise,
  )

  private var pendingSave: PendingSave? = null
  private var pendingOpen: Promise? = null

  private val activityListener =
    object : ActivityEventListener {
      override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?,
      ) {
        if (requestCode == OPEN_TEXT_REQUEST_CODE) {
          handleOpenResult(resultCode, data)
          return
        }
        if (requestCode != SAVE_TEXT_REQUEST_CODE) return
        val pending = pendingSave ?: return
        pendingSave = null

        if (resultCode == Activity.RESULT_CANCELED) {
          pending.promise.resolve(result("CANCELLED"))
          return
        }
        if (resultCode != Activity.RESULT_OK) {
          pending.promise.reject(
            "ledger-file-save-result",
            "The system file picker returned an unexpected result.",
          )
          return
        }

        val uri = data?.data
        if (uri == null) {
          pending.promise.reject(
            "ledger-file-save-uri",
            "The system file picker did not return a destination.",
          )
          return
        }

        writeText(uri, pending)
      }

      override fun onNewIntent(intent: Intent) = Unit
    }

  init {
    reactContext.addActivityEventListener(activityListener)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun saveText(
    suggestedFileName: String,
    mimeType: String,
    content: String,
    promise: Promise,
  ) {
    if (pendingSave != null) {
      promise.reject(
        "ledger-file-save-busy",
        "Another ledger file operation is already active.",
      )
      return
    }

    val safeName = sanitizeFileName(suggestedFileName)
    if (safeName == null) {
      promise.reject("ledger-file-save-name", "The export file name is invalid.")
      return
    }
    if (!MIME_TYPE_PATTERN.matches(mimeType)) {
      promise.reject("ledger-file-save-mime", "The export MIME type is invalid.")
      return
    }
    if (content.toByteArray(StandardCharsets.UTF_8).size > MAX_TEXT_BYTES) {
      promise.reject("ledger-file-save-size", "The export content is too large.")
      return
    }

    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject(
        "ledger-file-save-activity",
        "No foreground activity is available for the system file picker.",
      )
      return
    }

    pendingSave = PendingSave(content = content, promise = promise)
    val intent =
      Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = mimeType
        putExtra(Intent.EXTRA_TITLE, safeName)
        addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      }

    try {
      activity.startActivityForResult(intent, SAVE_TEXT_REQUEST_CODE)
    } catch (error: Exception) {
      pendingSave = null
      promise.reject(
        "ledger-file-save-launch",
        "The system file picker could not be opened.",
        error,
      )
    }
  }

  @ReactMethod
  fun openText(mimeTypes: com.facebook.react.bridge.ReadableArray, promise: Promise) {
    if (pendingSave != null || pendingOpen != null) {
      promise.reject("ledger-file-open-busy", "Another ledger file operation is already active.")
      return
    }
    val types = (0 until mimeTypes.size()).mapNotNull { mimeTypes.getString(it) }
    if (types.isEmpty() || types.size > 8 || types.any { !MIME_TYPE_PATTERN.matches(it) }) {
      promise.reject("ledger-file-open-mime", "The accepted MIME types are invalid.")
      return
    }
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("ledger-file-open-activity", "No foreground activity is available for the system file picker.")
      return
    }
    pendingOpen = promise
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = if (types.size == 1) types.first() else "*/*"
      if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    try {
      activity.startActivityForResult(intent, OPEN_TEXT_REQUEST_CODE)
    } catch (error: Exception) {
      pendingOpen = null
      promise.reject("ledger-file-open-launch", "The system file picker could not be opened.", error)
    }
  }

  private fun handleOpenResult(resultCode: Int, data: Intent?) {
    val promise = pendingOpen ?: return
    pendingOpen = null
    if (resultCode == Activity.RESULT_CANCELED) {
      promise.resolve(result("CANCELLED"))
      return
    }
    val uri = data?.data
    if (resultCode != Activity.RESULT_OK || uri == null) {
      promise.reject("ledger-file-open-result", "The system file picker did not return a readable file.")
      return
    }
    try {
      val stream = reactContext.contentResolver.openInputStream(uri)
        ?: throw IllegalStateException("The selected file is not readable.")
      val bytes = stream.use { input ->
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        var total = 0
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          total += count
          require(total <= MAX_TEXT_BYTES) { "The selected file is too large." }
          output.write(buffer, 0, count)
        }
        output.toByteArray()
      }
      val decoded = runCatching {
        StandardCharsets.UTF_8.newDecoder()
          .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
          .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
          .decode(java.nio.ByteBuffer.wrap(bytes)).toString()
      }.getOrNull()
      val content = decoded ?: Base64.encodeToString(bytes, Base64.NO_WRAP)
      promise.resolve(Arguments.createMap().apply {
        putString("status", "OPENED")
        putString("content", content)
        putString("encoding", if (decoded == null) "BASE64" else "UTF8")
        putString("uri", uri.toString())
        reactContext.contentResolver.query(
          uri,
          arrayOf(OpenableColumns.DISPLAY_NAME),
          null,
          null,
          null,
        )?.use { cursor ->
          if (cursor.moveToFirst()) {
            putString("fileName", cursor.getString(0))
          }
        }
      })
    } catch (error: Exception) {
      promise.reject("ledger-file-open-read", "The selected ledger file could not be read.", error)
    }
  }

  private fun writeText(uri: Uri, pending: PendingSave) {
    try {
      val output = reactContext.contentResolver.openOutputStream(uri, "wt")
        ?: throw IllegalStateException("The selected destination is not writable.")
      output.use { stream ->
        BufferedWriter(OutputStreamWriter(stream, StandardCharsets.UTF_8)).use { writer ->
          writer.write(pending.content)
          writer.flush()
        }
      }
      pending.promise.resolve(result("SAVED", uri))
    } catch (error: Exception) {
      pending.promise.reject(
        "ledger-file-save-write",
        "The ledger export could not be written to the selected destination.",
        error,
      )
    }
  }

  override fun invalidate() {
    pendingSave?.promise?.reject(
      "ledger-file-save-invalidated",
      "The ledger file operation ended before completion.",
    )
    pendingSave = null
    pendingOpen?.reject(
      "ledger-file-open-invalidated",
      "The ledger file operation ended before completion.",
    )
    pendingOpen = null
    reactContext.removeActivityEventListener(activityListener)
    super.invalidate()
  }

  private fun result(status: String, uri: Uri? = null) =
    Arguments.createMap().apply {
      putString("status", status)
      if (uri != null) putString("uri", uri.toString())
    }

  private fun sanitizeFileName(value: String): String? {
    val trimmed = value.trim()
    if (trimmed.isEmpty() || trimmed.length > MAX_FILE_NAME_CHARACTERS) return null
    val sanitized = INVALID_FILE_NAME_CHARACTERS.replace(trimmed, "_")
    if (sanitized == "." || sanitized == "..") return null
    return sanitized
  }

  companion object {
    const val NAME = "LedgerFilePortal"
    private const val SAVE_TEXT_REQUEST_CODE = 0x514A
    private const val OPEN_TEXT_REQUEST_CODE = 0x514B
    private const val MAX_TEXT_BYTES = 50 * 1024 * 1024
    private const val MAX_FILE_NAME_CHARACTERS = 128
    private val MIME_TYPE_PATTERN = Regex("^[a-zA-Z0-9][a-zA-Z0-9.+-]*/[a-zA-Z0-9][a-zA-Z0-9.+-]*$")
    private val INVALID_FILE_NAME_CHARACTERS = Regex("[\\u0000-\\u001F\\\\/:*?\"<>|]")
  }
}
