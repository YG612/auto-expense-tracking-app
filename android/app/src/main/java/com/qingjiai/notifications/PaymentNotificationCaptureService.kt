package com.qingjiai.notifications

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.ArrayDeque

data class PaymentNotificationSnapshot(
  val key: String,
  val packageName: String,
  val title: String,
  val text: String,
  val postedAt: Long,
)

class PaymentNotificationCaptureService : NotificationListenerService() {
  override fun onListenerConnected() {
    super.onListenerConnected()
    synchronized(lock) { connectedService = this }
  }

  override fun onListenerDisconnected() {
    synchronized(lock) {
      if (connectedService === this) connectedService = null
    }
    super.onListenerDisconnected()
  }

  override fun onNotificationPosted(notification: StatusBarNotification?) {
    val snapshot = notification?.let(::snapshot) ?: return
    synchronized(lock) {
      if (snapshot.key in acknowledgedKeys) return
      if (queue.any { it.key == snapshot.key }) return
      while (queue.size >= MAX_QUEUE_SIZE) queue.removeFirst()
      queue.addLast(snapshot)
    }
  }

  companion object {
    private val allowedPackages = setOf(
      "com.tencent.mm",
      "com.eg.android.AlipayGphone",
    )
    private val paymentCues = listOf(
      "支付成功",
      "付款成功",
      "已付款",
      "消费成功",
      "扣款成功",
      "收款到账",
      "收款成功",
      "退款成功",
    )
    private val lock = Any()
    private val queue = ArrayDeque<PaymentNotificationSnapshot>()
    private val acknowledgedKeys = LinkedHashSet<String>()
    private var connectedService: PaymentNotificationCaptureService? = null
    private const val MAX_QUEUE_SIZE = 100
    private const val MAX_ACKNOWLEDGED_KEYS = 500
    private const val MAX_TITLE_CHARACTERS = 256
    private const val MAX_TEXT_CHARACTERS = 2_000

    private fun snapshot(value: StatusBarNotification): PaymentNotificationSnapshot? {
      if (value.packageName !in allowedPackages) return null
      val extras = value.notification.extras
      val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
      val text = listOf(
        extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
        extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
        extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString(),
      ).filterNotNull().filter { it.isNotBlank() }.distinct().joinToString("\n")
      if (title.isBlank() && text.isBlank()) return null
      if (paymentCues.none { cue -> title.contains(cue) || text.contains(cue) }) return null
      return PaymentNotificationSnapshot(
        key = "${value.key.take(480)}|${value.postTime}",
        packageName = value.packageName,
        title = title.take(MAX_TITLE_CHARACTERS),
        text = text.take(MAX_TEXT_CHARACTERS),
        postedAt = value.postTime,
      )
    }

    fun queuedCount(): Int = synchronized(lock) { queue.size }

    fun listPending(): List<PaymentNotificationSnapshot> = synchronized(lock) {
      val results = LinkedHashMap<String, PaymentNotificationSnapshot>()
      queue.filterNot { it.key in acknowledgedKeys }.forEach { results[it.key] = it }
      try {
        connectedService?.activeNotifications
          ?.mapNotNull(::snapshot)
          ?.filterNot { it.key in acknowledgedKeys }
          ?.forEach { results[it.key] = it }
      } catch (_: SecurityException) {
        // The OS may revoke notification access between the status check and read.
      }
      results.values.sortedBy { it.postedAt }.takeLast(MAX_QUEUE_SIZE)
    }

    fun acknowledge(keys: Set<String>) = synchronized(lock) {
      queue.removeAll { it.key in keys }
      keys.forEach { key ->
        acknowledgedKeys.remove(key)
        acknowledgedKeys.add(key)
      }
      while (acknowledgedKeys.size > MAX_ACKNOWLEDGED_KEYS) {
        acknowledgedKeys.remove(acknowledgedKeys.first())
      }
    }

    fun clear() = synchronized(lock) {
      queue.clear()
      acknowledgedKeys.clear()
      try {
        connectedService?.activeNotifications
          ?.mapNotNull(::snapshot)
          ?.mapTo(acknowledgedKeys) { it.key }
        while (acknowledgedKeys.size > MAX_ACKNOWLEDGED_KEYS) {
          acknowledgedKeys.remove(acknowledgedKeys.first())
        }
      } catch (_: SecurityException) {
        // Notification access can be revoked while local capture is cleared.
      }
    }
  }
}
