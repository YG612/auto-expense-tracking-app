package com.qingjiai.notifications

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONObject

internal class PaymentNotificationStore(context: Context) {
  private val applicationContext = context.applicationContext
  private val preferences = applicationContext.getSharedPreferences(
    PREFERENCES_NAME,
    Context.MODE_PRIVATE,
  )
  private val outbox = AtomicFile(
    File(applicationContext.noBackupFilesDir, OUTBOX_FILE_NAME),
  )

  fun isEnabled(): Boolean = synchronized(lock) {
    preferences.getBoolean(KEY_ENABLED, false)
  }

  fun setEnabled(enabled: Boolean) = synchronized(lock) {
    val wasEnabled = preferences.getBoolean(KEY_ENABLED, false)
    if (wasEnabled == enabled) return@synchronized
    val editor = preferences.edit().putBoolean(KEY_ENABLED, enabled)
    if (enabled) editor.putLong(KEY_ENABLED_AT, System.currentTimeMillis())
    else editor.remove(KEY_ENABLED_AT)
    check(editor.commit()) { "Unable to persist payment notification consent." }
    if (!enabled) outbox.delete()
  }

  fun enqueue(snapshot: PaymentNotificationSnapshot): Boolean = synchronized(lock) {
    if (!preferences.getBoolean(KEY_ENABLED, false)) return@synchronized false
    val enabledAt = preferences.getLong(KEY_ENABLED_AT, Long.MAX_VALUE)
    if (snapshot.postedAt < enabledAt) return@synchronized false
    val current = readValidated(System.currentTimeMillis()).toMutableList()
    if (current.any { it.key == snapshot.key }) return@synchronized false
    current.add(snapshot)
    while (current.size > MAX_QUEUE_SIZE) current.removeAt(0)
    write(current)
    true
  }

  fun listPending(): List<PaymentNotificationSnapshot> = synchronized(lock) {
    if (!preferences.getBoolean(KEY_ENABLED, false)) return@synchronized emptyList()
    val current = readValidated(System.currentTimeMillis())
    write(current)
    current
  }

  fun queuedCount(): Int = listPending().size

  fun acknowledge(keys: Set<String>) = synchronized(lock) {
    if (keys.isEmpty()) return@synchronized
    write(readValidated(System.currentTimeMillis()).filterNot { it.key in keys })
  }

  fun clear() = synchronized(lock) { outbox.delete() }

  private fun readValidated(now: Long): List<PaymentNotificationSnapshot> {
    if (!outbox.baseFile.isFile) return emptyList()
    return try {
      val root = JSONObject(
        outbox.openRead().use { input ->
          String(input.readBytes(), StandardCharsets.UTF_8)
        },
      )
      if (root.optInt("version") != OUTBOX_VERSION) throw IllegalStateException("version")
      val values = root.getJSONArray("notifications")
      buildList {
        for (index in 0 until values.length()) {
          val item = values.getJSONObject(index)
          val snapshot = PaymentNotificationSnapshot(
            key = item.getString("key"),
            packageName = item.getString("packageName"),
            title = item.getString("title"),
            text = item.getString("text"),
            postedAt = item.getLong("postedAt"),
          )
          if (
            snapshot.key.isNotEmpty() && snapshot.key.length <= MAX_KEY_CHARACTERS &&
            snapshot.packageName in ALLOWED_PACKAGES &&
            snapshot.title.length <= MAX_TITLE_CHARACTERS &&
            snapshot.text.length <= MAX_TEXT_CHARACTERS &&
            snapshot.postedAt >= now - MAX_AGE_MILLIS &&
            snapshot.postedAt <= now + MAX_FUTURE_SKEW_MILLIS
          ) add(snapshot)
        }
      }.distinctBy { it.key }.sortedBy { it.postedAt }.takeLast(MAX_QUEUE_SIZE)
    } catch (_: Exception) {
      // A malformed financial outbox is discarded instead of being partially trusted or leaked.
      outbox.delete()
      emptyList()
    }
  }

  private fun write(values: List<PaymentNotificationSnapshot>) {
    if (values.isEmpty()) {
      outbox.delete()
      return
    }
    val notifications = JSONArray()
    values.forEach { value ->
      notifications.put(JSONObject().apply {
        put("key", value.key)
        put("packageName", value.packageName)
        put("title", value.title)
        put("text", value.text)
        put("postedAt", value.postedAt)
      })
    }
    val bytes = JSONObject().apply {
      put("version", OUTBOX_VERSION)
      put("notifications", notifications)
    }.toString().toByteArray(StandardCharsets.UTF_8)
    val stream = outbox.startWrite()
    try {
      stream.write(bytes)
      stream.flush()
      outbox.finishWrite(stream)
    } catch (error: Exception) {
      outbox.failWrite(stream)
      throw error
    }
  }

  private companion object {
    val lock = Any()
    val ALLOWED_PACKAGES = setOf("com.tencent.mm", "com.eg.android.AlipayGphone")
    const val PREFERENCES_NAME = "payment_notification_capture"
    const val KEY_ENABLED = "enabled"
    const val KEY_ENABLED_AT = "enabled_at"
    const val OUTBOX_FILE_NAME = "payment-notification-outbox.json"
    const val OUTBOX_VERSION = 1
    const val MAX_QUEUE_SIZE = 100
    const val MAX_KEY_CHARACTERS = 512
    const val MAX_TITLE_CHARACTERS = 256
    const val MAX_TEXT_CHARACTERS = 2_000
    const val MAX_AGE_MILLIS = 7L * 24 * 60 * 60 * 1_000
    const val MAX_FUTURE_SKEW_MILLIS = 5L * 60 * 1_000
  }
}
