package com.qingjiai.agent

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.qingjiai.BuildConfig

class AgentCommandInboxModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val store = AgentCommandInboxStore(reactContext)

  override fun getName(): String = NAME

  private fun supported(): Boolean =
    BuildConfig.DEBUG && BuildConfig.APPLICATION_ID.endsWith(".internal")

  @ReactMethod
  fun listPending(promise: Promise) {
    if (!supported()) {
      promise.resolve(Arguments.createArray())
      return
    }
    try {
      val result = Arguments.createArray()
      store.listPending().forEach { command ->
        result.pushMap(Arguments.createMap().apply {
          putString("key", command.key)
          putString("callerId", command.callerId)
          putString("idempotencyKey", command.idempotencyKey)
          putString("text", command.text)
          command.referenceDate?.let { putString("referenceDate", it) }
          command.timezoneOffsetMinutes?.let {
            putInt("timezoneOffsetMinutes", it)
          }
        })
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject(
        "agent-command-inbox-read-failed",
        "Agent command inbox could not be read.",
        error,
      )
    }
  }

  @ReactMethod
  fun complete(
    key: String,
    status: String,
    transactionIds: com.facebook.react.bridge.ReadableArray,
    completedAt: String,
    errorCode: String?,
    promise: Promise,
  ) {
    if (!supported()) {
      promise.resolve(null)
      return
    }
    val ids = (0 until transactionIds.size())
      .mapNotNull { transactionIds.getString(it) }
    if (!KEY.matches(key) || ids.size != transactionIds.size()) {
      promise.reject(
        "agent-command-completion-invalid",
        "Agent command completion is invalid.",
      )
      return
    }
    try {
      store.complete(key, status, ids, completedAt, errorCode)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject(
        "agent-command-completion-failed",
        "Agent command result could not be committed.",
        error,
      )
    }
  }

  companion object {
    const val NAME = "AgentCommandInbox"
    private val KEY = Regex("^[a-f0-9]{64}$")
  }
}
