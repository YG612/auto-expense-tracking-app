package com.qingjiai.privacy

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.view.WindowManager
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

class PrivacyProtectionModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private var pendingAuthentication: Promise? = null
  private val keyguardManager =
    reactContext.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager

  private val activityListener = object : ActivityEventListener {
    override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?,
    ) {
      if (requestCode != AUTHENTICATION_REQUEST_CODE) return
      val promise = pendingAuthentication ?: return
      pendingAuthentication = null
      promise.resolve(
        Arguments.createMap().apply {
          putString(
            "status",
            if (resultCode == Activity.RESULT_OK) "AUTHENTICATED" else "CANCELLED",
          )
        },
      )
    }

    override fun onNewIntent(intent: Intent) = Unit
  }

  init {
    reactContext.addActivityEventListener(activityListener)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun getCapabilities(promise: Promise) {
    val available = keyguardManager.isDeviceSecure
    promise.resolve(
      Arguments.createMap().apply {
        putBoolean("available", available)
        putString(
          "method",
          if (available) "DEVICE_OWNER_AUTHENTICATION" else "NONE",
        )
      },
    )
  }

  @Suppress("DEPRECATION")
  @ReactMethod
  fun authenticate(reason: String, promise: Promise) {
    if (pendingAuthentication != null) {
      promise.reject("privacy-auth-busy", "Another authentication is already active.")
      return
    }
    if (!keyguardManager.isDeviceSecure) {
      promise.reject("privacy-auth-unavailable", "No device credential is configured.")
      return
    }
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("privacy-auth-activity", "No foreground activity is available.")
      return
    }
    val intent = keyguardManager.createConfirmDeviceCredentialIntent(
      "解锁轻记 AI",
      reason.take(MAX_REASON_CHARACTERS),
    )
    if (intent == null) {
      promise.reject("privacy-auth-unavailable", "System authentication is unavailable.")
      return
    }
    pendingAuthentication = promise
    try {
      activity.startActivityForResult(intent, AUTHENTICATION_REQUEST_CODE)
    } catch (error: Exception) {
      pendingAuthentication = null
      promise.reject("privacy-auth-launch", "System authentication could not be opened.", error)
    }
  }

  @ReactMethod
  fun setScreenCaptureProtected(enabled: Boolean, promise: Promise) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("privacy-screen-activity", "No foreground activity is available.")
      return
    }
    UiThreadUtil.runOnUiThread {
      try {
        if (enabled) {
          activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
          activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("privacy-screen-protection", "Screen protection could not be changed.", error)
      }
    }
  }

  override fun invalidate() {
    pendingAuthentication?.reject(
      "privacy-auth-invalidated",
      "Authentication ended before completion.",
    )
    pendingAuthentication = null
    reactContext.removeActivityEventListener(activityListener)
    super.invalidate()
  }

  companion object {
    const val NAME = "PrivacyProtection"
    private const val AUTHENTICATION_REQUEST_CODE = 0x514C
    private const val MAX_REASON_CHARACTERS = 120
  }
}
