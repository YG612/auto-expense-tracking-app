package com.qingjiai.notifications

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.qingjiai.MainActivity
import com.qingjiai.R

class PaymentNotificationCaptureModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val store = PaymentNotificationStore(reactContext)

  override fun getName(): String = NAME

  private fun accessGranted(): Boolean {
    val target = ComponentName(reactContext, PaymentNotificationCaptureService::class.java)
    val enabled = Settings.Secure.getString(
      reactContext.contentResolver,
      "enabled_notification_listeners",
    ).orEmpty()
    return enabled.split(':')
      .mapNotNull(ComponentName::unflattenFromString)
      .any { it == target }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    try {
      promise.resolve(Arguments.createMap().apply {
        putBoolean("supported", true)
        putBoolean("permissionGranted", accessGranted())
        putBoolean("captureEnabled", store.isEnabled())
        putInt("queuedCount", store.queuedCount())
      })
    } catch (error: Exception) {
      promise.reject("notification-status-read-failed", "Notification capture status could not be read.", error)
    }
  }

  @ReactMethod
  fun setCaptureEnabled(enabled: Boolean, promise: Promise) {
    try {
      store.setEnabled(enabled)
      if (enabled) {
        if (store.queuedCount() > 0) PaymentNotificationImportScheduler.schedule(reactContext)
      } else {
        PaymentNotificationImportScheduler.cancel(reactContext)
      }
      getStatus(promise)
    } catch (error: Exception) {
      promise.reject("notification-consent-save-failed", "Notification capture consent could not be saved.", error)
    }
  }

  @ReactMethod
  fun openSettings(promise: Promise) {
    try {
      reactContext.startActivity(
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
      )
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("notification-settings-unavailable", "Notification access settings are unavailable.", error)
    }
  }

  @ReactMethod
  fun listPending(promise: Promise) {
    if (!store.isEnabled()) {
      promise.reject("notification-capture-disabled", "Payment notification capture is disabled.")
      return
    }
    try {
      val result = Arguments.createArray()
      store.listPending().forEach { snapshot ->
        result.pushMap(Arguments.createMap().apply {
          putString("key", snapshot.key)
          putString("packageName", snapshot.packageName)
          putString("title", snapshot.title)
          putString("text", snapshot.text)
          putDouble("postedAt", snapshot.postedAt.toDouble())
        })
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("notification-outbox-read-failed", "Payment notification outbox could not be read.", error)
    }
  }

  @ReactMethod
  fun acknowledge(keys: com.facebook.react.bridge.ReadableArray, promise: Promise) {
    val values = (0 until keys.size()).mapNotNull { keys.getString(it) }.toSet()
    if (values.size > 100 || values.any { it.isEmpty() || it.length > 512 }) {
      promise.reject("notification-acknowledgement-invalid", "Notification acknowledgement keys are invalid.")
      return
    }
    try {
      store.acknowledge(values)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("notification-acknowledgement-failed", "Payment notifications could not be acknowledged.", error)
    }
  }

  @ReactMethod
  fun notifyPendingReview(importedCount: Double, promise: Promise) {
    val count = importedCount.toInt()
    if (importedCount != count.toDouble() || count !in 1..100) {
      promise.reject("notification-review-count-invalid", "Pending review count is invalid.")
      return
    }
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      reactContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      promise.resolve(false)
      return
    }
    try {
      val manager = reactContext.getSystemService(NotificationManager::class.java)
        ?: throw IllegalStateException("NotificationManager is unavailable.")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.createNotificationChannel(
          NotificationChannel(
            REVIEW_CHANNEL_ID,
            "待确认账单",
            NotificationManager.IMPORTANCE_DEFAULT,
          ).apply {
            description = "提示由支付通知生成、等待用户核对的账单"
          },
        )
      }
      val reviewIntent = Intent(
        Intent.ACTION_VIEW,
        Uri.parse("qingjiai://pending"),
        reactContext,
        MainActivity::class.java,
      ).apply {
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
      val pendingIntent = PendingIntent.getActivity(
        reactContext,
        REVIEW_NOTIFICATION_ID,
        reviewIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      @Suppress("DEPRECATION")
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(reactContext, REVIEW_CHANNEL_ID)
      } else {
        Notification.Builder(reactContext)
      }
      val notification = builder
        .setSmallIcon(R.drawable.ic_stat_qingji)
        .setContentTitle("有新账单待确认")
        .setContentText("已从支付通知生成 ${count} 笔候选，点按核对后入账。")
        .setCategory(Notification.CATEGORY_REMINDER)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(pendingIntent)
        .build()
      manager.notify(REVIEW_NOTIFICATION_ID, notification)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("notification-review-alert-failed", "Pending review alert could not be shown.", error)
    }
  }

  @ReactMethod
  fun clear(promise: Promise) {
    try {
      store.setEnabled(false)
      store.clear()
      PaymentNotificationImportScheduler.cancel(reactContext)
      reactContext.getSystemService(NotificationManager::class.java)
        ?.cancel(REVIEW_NOTIFICATION_ID)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject(
        "notification-sensitive-data-clear-failed",
        "Payment notification sensitive data could not be cleared.",
        error,
      )
    }
  }

  companion object {
    const val NAME = "PaymentNotificationCapture"
    private const val REVIEW_CHANNEL_ID = "payment-notification-review"
    private const val REVIEW_NOTIFICATION_ID = 0x514A_0001
  }
}
