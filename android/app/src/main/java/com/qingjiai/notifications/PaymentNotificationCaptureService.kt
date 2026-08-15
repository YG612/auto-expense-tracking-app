package com.qingjiai.notifications

import android.app.Notification
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

data class PaymentNotificationSnapshot(
  val key: String,
  val packageName: String,
  val title: String,
  val text: String,
  val postedAt: Long,
)

class PaymentNotificationCaptureService : NotificationListenerService() {
  private val store by lazy { PaymentNotificationStore(this) }

  override fun onNotificationPosted(notification: StatusBarNotification?) {
    val snapshot = notification?.let(::snapshot) ?: return
    val enqueued = try {
      store.enqueue(snapshot)
    } catch (_: Exception) {
      // Storage pressure must not crash the system-bound notification listener.
      false
    }
    if (enqueued) {
      try {
        startService(Intent(this, PaymentNotificationImportService::class.java))
      } catch (_: Exception) {
        // OEM background limits may reject immediate JS startup. The durable outbox is retried
        // automatically when the app next starts or returns to the foreground.
      }
    }
  }

  companion object {
    private const val MAX_TITLE_CHARACTERS = 256
    private const val MAX_TEXT_CHARACTERS = 2_000

    private fun snapshot(value: StatusBarNotification): PaymentNotificationSnapshot? {
      val extras = value.notification.extras
      val title = listOfNotNull(
        extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
        extras.getCharSequence(Notification.EXTRA_TITLE_BIG)?.toString(),
      ).firstOrNull { it.isNotBlank() }.orEmpty()
      val text = listOf(
        extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
        extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
        extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString(),
        extras.getCharSequence(Notification.EXTRA_INFO_TEXT)?.toString(),
        extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString(),
        value.notification.tickerText?.toString(),
        extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.joinToString("\n"),
      ).filterNotNull().filter { it.isNotBlank() }.distinct().joinToString("\n")
      val conversationLike =
        value.notification.category == Notification.CATEGORY_MESSAGE ||
          extras.containsKey(Notification.EXTRA_MESSAGES)
      if (!PaymentNotificationClassifier.isCandidate(value.packageName, title, text, conversationLike)) {
        return null
      }
      return PaymentNotificationSnapshot(
        key = "${value.key.take(480)}|${value.postTime}",
        packageName = value.packageName,
        title = title.take(MAX_TITLE_CHARACTERS),
        text = text.take(MAX_TEXT_CHARACTERS),
        postedAt = value.postTime,
      )
    }
  }
}
