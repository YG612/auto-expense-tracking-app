package com.qingjiai.notifications

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class PaymentNotificationCaptureModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
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
    promise.resolve(Arguments.createMap().apply {
      putBoolean("supported", true)
      putBoolean("permissionGranted", accessGranted())
      putInt("queuedCount", PaymentNotificationCaptureService.queuedCount())
    })
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
    if (!accessGranted()) {
      promise.reject("notification-access-required", "Notification access has not been granted.")
      return
    }
    val result = Arguments.createArray()
    PaymentNotificationCaptureService.listPending().forEach { snapshot ->
      result.pushMap(Arguments.createMap().apply {
        putString("key", snapshot.key)
        putString("packageName", snapshot.packageName)
        putString("title", snapshot.title)
        putString("text", snapshot.text)
        putDouble("postedAt", snapshot.postedAt.toDouble())
      })
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun acknowledge(keys: com.facebook.react.bridge.ReadableArray, promise: Promise) {
    val values = (0 until keys.size()).mapNotNull { keys.getString(it) }.toSet()
    if (values.size > 100 || values.any { it.isEmpty() || it.length > 512 }) {
      promise.reject("notification-acknowledgement-invalid", "Notification acknowledgement keys are invalid.")
      return
    }
    PaymentNotificationCaptureService.acknowledge(values)
    promise.resolve(null)
  }

  @ReactMethod
  fun clear() {
    PaymentNotificationCaptureService.clear()
  }

  companion object {
    const val NAME = "PaymentNotificationCapture"
  }
}
