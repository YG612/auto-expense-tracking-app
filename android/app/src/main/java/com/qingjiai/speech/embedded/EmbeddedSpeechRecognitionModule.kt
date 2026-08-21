package com.qingjiai.speech.embedded

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

@ReactModule(name = EmbeddedSpeechRecognitionModule.NAME)
class EmbeddedSpeechRecognitionModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val engineLoadResult = EmbeddedSpeechEngineLoader.load(context)
  private val engine = engineLoadResult.engine

  private var activeSession: ActiveSession? = null
  private var pendingPermission: PendingPermission? = null
  private var permissionTimeout: Runnable? = null
  private var invalidated = false

  init {
    context.addLifecycleEventListener(this)
  }

  override fun getName() = NAME

  @ReactMethod
  fun getCapabilities(
    locale: String?,
    promise: Promise,
  ) {
    mainHandler.post {
      val normalizedLocale = normalizeLocale(locale)
      resolveCapabilitiesWhenSettled(
        normalizedLocale,
        SystemClock.elapsedRealtime() + CAPABILITY_WARMUP_TIMEOUT_MS,
        promise,
      )
    }
  }

  @ReactMethod
  fun getModels(promise: Promise) {
    mainHandler.post {
      val models =
        Arguments.createArray().apply {
          engine?.availableModels()?.forEach { model ->
            pushMap(
              Arguments.createMap().apply {
                putString("id", model.id)
                putString("label", model.label)
                putString("description", model.description)
                putDouble("compressedSizeBytes", model.compressedSizeBytes.toDouble())
              },
            )
          }
        }
      promise.resolve(
        Arguments.createMap().apply {
          putArray("models", models)
          engine?.selectedModelId()?.let { putString("selectedModelId", it) }
            ?: putNull("selectedModelId")
        },
      )
    }
  }

  @ReactMethod
  fun selectModel(
    modelId: String,
    promise: Promise,
  ) {
    mainHandler.post {
      val requested = modelId.trim()
      if (requested.isEmpty()) {
        promise.reject(ERROR_UNKNOWN, "modelId must not be empty.")
        return@post
      }
      if (invalidated || engine == null) {
        promise.reject(ERROR_SERVICE_UNAVAILABLE, "Embedded speech is unavailable in this build.")
        return@post
      }
      if (activeSession != null) {
        Log.w(TAG, "Speech model switch rejected during an active recording: requested=$requested")
        promise.reject(ERROR_BUSY, "Cannot switch speech models while recording.")
        return@post
      }
      val known = engine.availableModels().any { it.id == requested }
      if (!known) {
        promise.reject(ERROR_MODEL_MISSING, "Unknown embedded speech model: $requested")
        return@post
      }
      if (!engine.selectModel(requested)) {
        Log.w(TAG, "Speech model switch rejected while decoder is busy: requested=$requested")
        promise.reject(ERROR_BUSY, "The speech decoder is busy; try switching again shortly.")
        return@post
      }
      Log.i(TAG, "Speech model selection persisted: selected=$requested")
      promise.resolve(
        Arguments.createMap().apply { putString("selectedModelId", requested) },
      )
    }
  }

  @ReactMethod
  fun downloadModel(
    locale: String?,
    promise: Promise,
  ) {
    mainHandler.post {
      val normalizedLocale = normalizeLocale(locale)
      val availability = safeAvailability(normalizedLocale)
      val diagnosticCode = availability.diagnosticCode ?: engineLoadResult.diagnosticCode
      promise.resolve(
        Arguments.createMap().apply {
          putString("locale", normalizedLocale)
          putString("provider", PROVIDER)
          putString("modelState", embeddedModelState(availability.ready, diagnosticCode))
          putString("stage", STAGE_MODEL_PREPARATION)
        },
      )
    }
  }

  @ReactMethod
  fun requestPermission(
    sessionId: String,
    promise: Promise,
  ) {
    mainHandler.post {
      val owner = sessionId.trim()
      if (owner.isEmpty()) {
        promise.reject(ERROR_UNKNOWN, "sessionId must not be empty.")
        return@post
      }
      if (hasRecordAudioPermission()) {
        resolvePermission(promise, PERMISSION_GRANTED, true)
        return@post
      }
      if (pendingPermission != null) {
        promise.reject(ERROR_BUSY, "A microphone permission request is already active.")
        return@post
      }
      val permissionActivity = context.currentActivity as? PermissionAwareActivity
      val activity = context.currentActivity
      if (permissionActivity == null || activity == null) {
        resolvePermission(promise, PERMISSION_DENIED, true)
        return@post
      }

      pendingPermission = PendingPermission(owner, promise)
      val timeout =
        Runnable {
          val pending = pendingPermission ?: return@Runnable
          pendingPermission = null
          permissionTimeout = null
          resolvePermission(pending.promise, PERMISSION_DENIED, true)
        }
      permissionTimeout = timeout
      mainHandler.postDelayed(timeout, PERMISSION_TIMEOUT_MS)

      try {
        permissionActivity.requestPermissions(
          arrayOf(Manifest.permission.RECORD_AUDIO),
          PERMISSION_REQUEST_CODE,
          permissionListener(activity),
        )
      } catch (_: RuntimeException) {
        takePendingPermission()?.let { resolvePermission(it.promise, PERMISSION_DENIED, true) }
      }
    }
  }

  @ReactMethod
  @Suppress("UNUSED_PARAMETER")
  fun start(
    sessionId: String,
    generation: Double,
    locale: String?,
    preferOnDevice: Boolean,
    allowNetworkFallback: Boolean,
    promise: Promise,
  ) {
    mainHandler.post {
      val owner = sessionId.trim()
      if (owner.isEmpty()) {
        promise.reject(ERROR_UNKNOWN, "sessionId must not be empty.")
        return@post
      }
      val nativeGeneration = parseSpeechGeneration(generation)
      if (nativeGeneration == null) {
        promise.reject(ERROR_UNKNOWN, "generation must be a positive safe integer.")
        return@post
      }
      if (invalidated || engine == null) {
        promise.reject(ERROR_SERVICE_UNAVAILABLE, "Embedded speech is unavailable in this build.")
        return@post
      }
      if (activeSession != null) {
        promise.reject(ERROR_BUSY, "An embedded speech session is already active.")
        return@post
      }
      if (!hasRecordAudioPermission()) {
        promise.reject(ERROR_PERMISSION_DENIED, "Microphone permission has not been granted.")
        return@post
      }
      val normalizedLocale = normalizeLocale(locale)
      val availability = safeAvailability(normalizedLocale)
      if (!availability.ready) {
        promise.reject(ERROR_MODEL_MISSING, "Embedded Chinese speech assets are not ready.")
        return@post
      }

      activeSession = ActiveSession(owner, nativeGeneration)
      emitState(owner, nativeGeneration, STATE_STARTING, STAGE_START, null)
      try {
        engine.start(owner, nativeGeneration, normalizedLocale, engineCallback)
        promise.resolve(true)
      } catch (_: RuntimeException) {
        activeSession = null
        promise.reject(ERROR_AUDIO, "无法启动离线语音，请重试。")
      }
    }
  }

  @ReactMethod
  fun stop(
    sessionId: String,
    promise: Promise,
  ) {
    mainHandler.post {
      val owner = sessionId.trim()
      val session = activeSession
      if (session?.id != owner || engine == null) {
        promise.resolve(false)
        return@post
      }
      val accepted = engine.stop(owner)
      if (accepted) {
        emitState(owner, session.generation, STATE_PROCESSING, STAGE_RESULT, END_REASON_USER_STOP)
      }
      promise.resolve(accepted)
    }
  }

  @ReactMethod
  fun cancel(
    sessionId: String,
    promise: Promise,
  ) {
    mainHandler.post {
      val owner = sessionId.trim()
      val permissionCancelled = cancelPendingPermission(owner)
      val session = activeSession
      val sessionCancelled =
        if (session?.id == owner && engine != null) {
          engine.cancel(owner).also {
            activeSession = null
            emitState(
              owner,
              session.generation,
              STATE_CANCELLED,
              STAGE_LIFECYCLE,
              END_REASON_CANCELLED,
            )
          }
        } else {
          false
        }
      promise.resolve(permissionCancelled || sessionCancelled)
    }
  }

  @ReactMethod
  fun destroy(
    sessionId: String,
    promise: Promise,
  ) {
    mainHandler.post {
      val owner = sessionId.trim()
      cancelPendingPermission(owner)
      if (activeSession?.id == owner) {
        engine?.cancel(owner)
        activeSession = null
      }
      // React controllers can unmount/remount around the same process-wide
      // native module. An old owner may cancel itself, but must never destroy
      // the engine that a newer owner can use. Module teardown owns destroy().
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Double) = Unit

  override fun onHostResume() = Unit

  override fun onHostPause() {
    mainHandler.post { cancelForLifecycle() }
  }

  override fun onHostDestroy() {
    mainHandler.post {
      cancelForLifecycle()
      engine?.destroy()
    }
  }

  override fun invalidate() {
    invalidated = true
    context.removeLifecycleEventListener(this)
    takePendingPermission()?.promise?.reject(
      ERROR_CANCELLED,
      "Microphone permission request was interrupted.",
    )
    mainHandler.post {
      cancelForLifecycle()
      engine?.destroy()
    }
    super.invalidate()
  }

  private val engineCallback =
    object : EmbeddedSpeechEngineCallback {
      override fun onListening(
        sessionId: String,
        generation: Long,
      ) {
        mainHandler.post {
          if (isActive(sessionId, generation)) {
            emitState(sessionId, generation, STATE_LISTENING, STAGE_LISTENING, null)
          }
        }
      }

      override fun onPartial(
        sessionId: String,
        generation: Long,
        text: String,
      ) {
        mainHandler.post {
          if (!isActive(sessionId, generation)) return@post
          emitEvent(
            EVENT_PARTIAL,
            Arguments.createMap().apply {
              putString("sessionId", sessionId)
              putDouble("generation", generation.toDouble())
              putString("text", text)
              putBoolean("isFinal", false)
              putMetadata(STAGE_LISTENING, null)
            },
          )
        }
      }

      override fun onFinal(
        sessionId: String,
        generation: Long,
        text: String,
      ) {
        onFinalResult(
          sessionId,
          generation,
          EmbeddedRecognitionResult(text = text),
        )
      }

      override fun onFinalResult(
        sessionId: String,
        generation: Long,
        result: EmbeddedRecognitionResult,
      ) {
        mainHandler.post {
          if (!isActive(sessionId, generation)) {
            return@post
          }
          activeSession = null
          emitEvent(
            EVENT_FINAL,
            Arguments.createMap().apply {
              putString("sessionId", sessionId)
              putDouble("generation", generation.toDouble())
              putString("text", result.text)
              putArray("alternatives", Arguments.createArray().apply { pushString(result.text) })
              putBoolean("isFinal", true)
              if (result.acousticConfidence == null) {
                putNull("acousticConfidence")
              } else {
                putDouble("acousticConfidence", result.acousticConfidence)
              }
              putBoolean("endpointHinted", result.endpointHinted)
              result.audioQuality?.let { quality ->
                putMap(
                  "audioQuality",
                  Arguments.createMap().apply {
                    if (quality.estimatedSnrDb == null) putNull("estimatedSnrDb")
                    else putDouble("estimatedSnrDb", quality.estimatedSnrDb)
                    putDouble("clippingRatio", quality.clippingRatio)
                    putDouble("voicedDurationMs", quality.voicedDurationMs.toDouble())
                    putBoolean("noiseTooHigh", quality.noiseTooHigh)
                  },
                )
              }
              putMetadata(STAGE_RESULT, END_REASON_USER_STOP)
            },
          )
        }
      }

      override fun onAudioState(
        sessionId: String,
        generation: Long,
        state: EmbeddedAudioState,
      ) {
        mainHandler.post {
          if (!isActive(sessionId, generation)) return@post
          emitEvent(
            EVENT_AUDIO_STATE,
            Arguments.createMap().apply {
              putString("sessionId", sessionId)
              putDouble("generation", generation.toDouble())
              putDouble("volumeLevel", state.volumeLevel)
              putBoolean("speechDetected", state.speechDetected)
              putDouble("trailingSilenceMs", state.trailingSilenceMs.toDouble())
              putBoolean("endpointHinted", state.endpointHinted)
              putMetadata(STAGE_LISTENING, null)
            },
          )
        }
      }

      override fun onError(
        sessionId: String,
        generation: Long,
        code: String,
        message: String,
        retryable: Boolean,
      ) {
        mainHandler.post {
          if (!isActive(sessionId, generation)) {
            return@post
          }
          activeSession = null
          emitEvent(
            EVENT_ERROR,
            Arguments.createMap().apply {
              putString("sessionId", sessionId)
              putDouble("generation", generation.toDouble())
              putString("code", code)
              putString("message", message)
              putBoolean("retryable", retryable)
              putMetadata(STAGE_RESULT, null)
            },
          )
        }
      }
    }

  private fun permissionListener(activity: Activity) =
    object : PermissionListener {
      override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray,
      ): Boolean {
        if (requestCode != PERMISSION_REQUEST_CODE) {
          return false
        }
        val pending = takePendingPermission() ?: return true
        // The callback result is authoritative. Some OEM PackageManager
        // implementations expose the old permission state for a short window,
        // so re-querying here incorrectly rejects a grant that just succeeded.
        // start() still performs its own permission check before opening audio.
        val granted =
          grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        if (granted) {
          resolvePermission(pending.promise, PERMISSION_GRANTED, true)
        } else {
          val canAskAgain =
            activity.shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO)
          resolvePermission(
            pending.promise,
            if (canAskAgain) PERMISSION_DENIED else PERMISSION_BLOCKED,
            canAskAgain,
          )
        }
        return true
      }
    }

  private fun cancelForLifecycle() {
    val session = activeSession ?: return
    engine?.cancel(session.id)
    activeSession = null
    emitState(
      session.id,
      session.generation,
      STATE_CANCELLED,
      STAGE_LIFECYCLE,
      END_REASON_CANCELLED,
    )
  }

  private fun isActive(
    sessionId: String,
    generation: Long,
  ): Boolean = activeSession == ActiveSession(sessionId, generation)

  private fun safeAvailability(locale: String): EmbeddedSpeechAvailability =
    try {
      engine?.availability(locale)
        ?: EmbeddedSpeechAvailability(false, engineLoadResult.diagnosticCode)
    } catch (_: RuntimeException) {
      EmbeddedSpeechAvailability(false, "embedded-assets-check-failed")
    } catch (_: LinkageError) {
      EmbeddedSpeechAvailability(false, "embedded-runtime-load-failed")
    }

  private fun resolveCapabilitiesWhenSettled(
    locale: String,
    deadlineElapsedMs: Long,
    promise: Promise,
  ) {
    val availability = safeAvailability(locale)
    val diagnosticCode = availability.diagnosticCode ?: engineLoadResult.diagnosticCode
    if (
      !invalidated &&
      diagnosticCode == EMBEDDED_DIAGNOSTIC_WARMING &&
      SystemClock.elapsedRealtime() < deadlineElapsedMs
    ) {
      mainHandler.postDelayed(
        { resolveCapabilitiesWhenSettled(locale, deadlineElapsedMs, promise) },
        CAPABILITY_WARMUP_POLL_MS,
      )
      return
    }
    val modelState = embeddedModelState(availability.ready, diagnosticCode)
    val provider =
      Arguments.createMap().apply {
        putString("provider", PROVIDER)
        putString("route", PROVIDER)
        putBoolean("available", availability.ready)
        putString("modelState", modelState)
        putBoolean("requiresMicrophonePermission", true)
        putBoolean("mayUseNetwork", false)
        putString("captureOwnership", OWNERSHIP_APP)
        putString("endpointOwnership", OWNERSHIP_APP)
        putString("stage", STAGE_CAPABILITY)
        putString("diagnosticCode", diagnosticCode)
        engine?.selectedModelId()?.let { putString("speechModelId", it) }
      }
    promise.resolve(
      Arguments.createMap().apply {
        putBoolean("available", availability.ready)
        putBoolean("onDeviceAvailable", availability.ready)
        putString("locale", locale)
        putString("platform", "android")
        putString("modelState", modelState)
        putString("permissionStatus", currentPermissionStatus())
        putString("stage", STAGE_CAPABILITY)
        engine?.selectedModelId()?.let { putString("speechModelId", it) }
        putArray("providers", Arguments.createArray().apply { pushMap(provider) })
      },
    )
  }

  private fun emitState(
    sessionId: String,
    generation: Long,
    state: String,
    stage: String,
    endReason: String?,
  ) {
    emitEvent(
      EVENT_STATE,
      Arguments.createMap().apply {
        putString("sessionId", sessionId)
        putDouble("generation", generation.toDouble())
        putString("state", state)
        putMetadata(stage, endReason)
      },
    )
  }

  private fun com.facebook.react.bridge.WritableMap.putMetadata(
    stage: String,
    endReason: String?,
  ) {
    putString("mode", PROVIDER)
    putString("provider", PROVIDER)
    putString("route", PROVIDER)
    putString("modelState", MODEL_READY)
    engine?.selectedModelId()?.let { putString("speechModelId", it) }
    putString("stage", stage)
    putBoolean("mayUseNetwork", false)
    putString("captureOwnership", OWNERSHIP_APP)
    putString("endpointOwnership", OWNERSHIP_APP)
    if (endReason == null) putNull("endReason") else putString("endReason", endReason)
  }

  private fun emitEvent(
    eventName: String,
    payload: com.facebook.react.bridge.WritableMap,
  ) {
    if (context.hasActiveReactInstance()) {
      context.emitDeviceEvent(eventName, payload)
    }
  }

  private fun hasRecordAudioPermission() =
    context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  private fun currentPermissionStatus() =
    if (hasRecordAudioPermission()) PERMISSION_GRANTED else PERMISSION_DENIED

  private fun resolvePermission(
    promise: Promise,
    status: String,
    canAskAgain: Boolean,
  ) {
    promise.resolve(
      Arguments.createMap().apply {
        putString("status", status)
        putBoolean("canAskAgain", canAskAgain)
      },
    )
  }

  private fun takePendingPermission(): PendingPermission? {
    val pending = pendingPermission ?: return null
    pendingPermission = null
    permissionTimeout?.let(mainHandler::removeCallbacks)
    permissionTimeout = null
    return pending
  }

  private fun cancelPendingPermission(sessionId: String): Boolean {
    val pending = pendingPermission ?: return false
    if (pending.sessionId != sessionId) {
      return false
    }
    takePendingPermission()?.promise?.reject(
      ERROR_CANCELLED,
      "Microphone permission request was cancelled.",
    )
    return true
  }

  private fun normalizeLocale(locale: String?) =
    locale?.trim()?.takeIf(String::isNotEmpty) ?: DEFAULT_LOCALE

  private data class PendingPermission(
    val sessionId: String,
    val promise: Promise,
  )

  private data class ActiveSession(
    val id: String,
    val generation: Long,
  )

  companion object {
    private const val TAG = "QingJiEmbeddedSpeech"
    const val NAME = "EmbeddedSpeechRecognition"

    const val EVENT_STATE = "EmbeddedSpeechRecognitionState"
    const val EVENT_PARTIAL = "EmbeddedSpeechRecognitionPartial"
    const val EVENT_FINAL = "EmbeddedSpeechRecognitionFinal"
    const val EVENT_ERROR = "EmbeddedSpeechRecognitionError"
    const val EVENT_AUDIO_STATE = "EmbeddedSpeechRecognitionAudioState"

    private const val PROVIDER = "app-owned-offline"
    private const val OWNERSHIP_APP = "app"
    private const val DEFAULT_LOCALE = "zh-CN"
    private const val MODEL_READY = EMBEDDED_MODEL_READY
    private const val MODEL_UNSUPPORTED = EMBEDDED_MODEL_UNSUPPORTED
    private const val STATE_STARTING = "starting"
    private const val STATE_LISTENING = "listening"
    private const val STATE_PROCESSING = "processing"
    private const val STATE_CANCELLED = "cancelled"
    private const val STAGE_CAPABILITY = "capability"
    private const val STAGE_MODEL_PREPARATION = "model-preparation"
    private const val STAGE_START = "start"
    private const val STAGE_LISTENING = "listening"
    private const val STAGE_RESULT = "result"
    private const val STAGE_LIFECYCLE = "lifecycle"
    private const val END_REASON_USER_STOP = "user-stop"
    private const val END_REASON_CANCELLED = "cancelled"
    private const val PERMISSION_GRANTED = "granted"
    private const val PERMISSION_DENIED = "denied"
    private const val PERMISSION_BLOCKED = "blocked"
    private const val ERROR_PERMISSION_DENIED = "permission-denied"
    private const val ERROR_SERVICE_UNAVAILABLE = "service-unavailable"
    private const val ERROR_MODEL_MISSING = "model-missing"
    private const val ERROR_AUDIO = "audio"
    private const val ERROR_BUSY = "busy"
    private const val ERROR_CANCELLED = "cancelled"
    private const val ERROR_UNKNOWN = "unknown"
    private const val PERMISSION_REQUEST_CODE = 0x4100
    private const val PERMISSION_TIMEOUT_MS = 20_000L
    private const val CAPABILITY_WARMUP_TIMEOUT_MS = 15_000L
    private const val CAPABILITY_WARMUP_POLL_MS = 200L
  }
}
