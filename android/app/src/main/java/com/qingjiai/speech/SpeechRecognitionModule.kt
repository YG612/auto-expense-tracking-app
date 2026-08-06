package com.qingjiai.speech

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

@ReactModule(name = SpeechRecognitionModule.NAME)
class SpeechRecognitionModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context), LifecycleEventListener, ActivityEventListener {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val permissionLock = Any()
  private val systemActivityResultGate = SystemSpeechActivityResultGate()

  private var recognizer: SpeechRecognizer? = null
  private var activeSession: ActiveSession? = null
  private var generationCounter = 0
  private var pendingPermissionPromise: Promise? = null
  private var invalidated = false

  init {
    context.addLifecycleEventListener(this)
    context.addActivityEventListener(this)
  }

  override fun getName() = NAME

  @ReactMethod
  fun getCapabilities(locale: String?, promise: Promise) {
    mainHandler.post {
      if (invalidated) {
        promise.reject(ERROR_UNKNOWN, "Speech recognition module is no longer available.")
        return@post
      }

      val normalizedLocale = normalizeLocale(locale)
      val capabilities = currentEngineCapabilities()
      promise.resolve(
        Arguments.createMap().apply {
          putBoolean("available", capabilities.anyAvailable)
          putBoolean("onDeviceAvailable", capabilities.onDeviceAvailable)
          putString("locale", normalizedLocale)
          putString("platform", "android")
          putBoolean("networkFallbackRequiresConsent", true)
          putString("permissionStatus", currentPermissionStatus())
        },
      )
    }
  }

  @ReactMethod
  fun requestPermission(promise: Promise) {
    mainHandler.post {
      if (hasRecordAudioPermission()) {
        resolvePermission(promise, PERMISSION_GRANTED, true)
        return@post
      }

      val activity = context.currentActivity as? PermissionAwareActivity
      if (activity == null) {
        // There is no foreground host to show a runtime prompt. This is temporary and is not
        // equivalent to the user permanently blocking the microphone permission.
        resolvePermission(promise, PERMISSION_DENIED, true)
        return@post
      }

      synchronized(permissionLock) {
        if (pendingPermissionPromise != null) {
          promise.reject(ERROR_BUSY, "A microphone permission request is already active.")
          return@post
        }
        pendingPermissionPromise = promise
      }

      try {
        activity.requestPermissions(
          arrayOf(Manifest.permission.RECORD_AUDIO),
          PERMISSION_REQUEST_CODE,
          object : PermissionListener {
            override fun onRequestPermissionsResult(
              requestCode: Int,
              permissions: Array<String>,
              grantResults: IntArray,
            ): Boolean {
              if (requestCode != PERMISSION_REQUEST_CODE) {
                return false
              }

              val pending = synchronized(permissionLock) {
                pendingPermissionPromise.also { pendingPermissionPromise = null }
              }
              if (pending == null) {
                return true
              }

              val granted =
                grantResults.isNotEmpty() &&
                  grantResults[0] == PackageManager.PERMISSION_GRANTED
              if (granted) {
                resolvePermission(pending, PERMISSION_GRANTED, true)
              } else {
                val currentActivity = context.currentActivity as? PermissionAwareActivity
                val canAskAgain =
                  currentActivity?.shouldShowRequestPermissionRationale(
                    Manifest.permission.RECORD_AUDIO,
                  ) == true
                resolvePermission(
                  pending,
                  if (canAskAgain) PERMISSION_DENIED else PERMISSION_BLOCKED,
                  canAskAgain,
                )
              }
              return true
            }
          },
        )
      } catch (_: RuntimeException) {
        val pending = synchronized(permissionLock) {
          pendingPermissionPromise.also { pendingPermissionPromise = null }
        }
        if (pending != null) {
          resolvePermission(pending, PERMISSION_BLOCKED, false)
        }
      }
    }
  }

  @ReactMethod
  fun start(
    sessionId: String,
    locale: String?,
    preferOnDevice: Boolean,
    allowNetworkFallback: Boolean,
    promise: Promise,
  ) {
    mainHandler.post {
      startOnMain(
        sessionId = sessionId.trim(),
        locale = normalizeLocale(locale),
        preferOnDevice = preferOnDevice,
        allowNetworkFallback = allowNetworkFallback,
        promise = promise,
      )
    }
  }

  @ReactMethod
  fun stop(sessionId: String, promise: Promise) {
    mainHandler.post {
      if (!isCurrentSession(sessionId)) {
        promise.resolve(false)
        return@post
      }

      try {
        emitState(sessionId, STATE_PROCESSING, "stop-requested")
        recognizer?.stopListening()
        promise.resolve(true)
      } catch (error: RuntimeException) {
        finishWithError(
          sessionId,
          ERROR_UNKNOWN,
          error.message ?: "Unable to stop speech recognition.",
          retryable = true,
        )
        promise.reject(ERROR_UNKNOWN, error.message, error)
      }
    }
  }

  @ReactMethod
  fun cancel(sessionId: String, promise: Promise) {
    mainHandler.post {
      if (!isCurrentSession(sessionId)) {
        promise.resolve(false)
        return@post
      }

      clearActiveSession(cancelFirst = true)
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun destroy(promise: Promise) {
    mainHandler.post {
      clearActiveSession(cancelFirst = true)
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Double) = Unit

  override fun onHostResume() = Unit

  override fun onHostPause() {
    // Launching the OEM recognition Activity pauses this host. Keep the session alive until
    // onActivityResult returns; ordinary direct-recognizer sessions are still cancelled.
    if (activeSession?.engine != SpeechEngine.SYSTEM_ACTIVITY) {
      releaseForLifecycle()
    }
  }

  override fun onHostDestroy() {
    releaseForLifecycle()
  }

  override fun invalidate() {
    invalidated = true
    context.removeLifecycleEventListener(this)
    context.removeActivityEventListener(this)
    synchronized(permissionLock) {
      pendingPermissionPromise?.reject(
        ERROR_CANCELLED,
        "Microphone permission request was interrupted.",
      )
      pendingPermissionPromise = null
    }
    mainHandler.post {
      clearActiveSession(cancelFirst = true)
      systemActivityResultGate.reset()
    }
    super.invalidate()
  }

  override fun onActivityResult(
    activity: Activity,
    requestCode: Int,
    resultCode: Int,
    data: Intent?,
  ) {
    mainHandler.post {
      val launch = systemActivityResultGate.consume(requestCode) ?: return@post
      val session = activeSession
      if (
        launch.cancelled ||
          session == null ||
          session.engine != SpeechEngine.SYSTEM_ACTIVITY ||
          session.id != launch.sessionId ||
          session.generation != launch.generation
      ) {
        return@post
      }
      val sessionId = session.id

      if (resultCode != Activity.RESULT_OK) {
        emitState(sessionId, STATE_CANCELLED, "system-activity-cancelled")
        clearActiveSession(cancelFirst = false)
        return@post
      }

      val alternatives =
        data
          ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
          ?.map(String::trim)
          ?.filter(String::isNotEmpty)
          ?.take(MAX_RESULTS)
          .orEmpty()
      if (alternatives.isEmpty()) {
        finishWithError(
          sessionId,
          ERROR_NO_SPEECH,
          "The system speech input returned no recognizable text.",
          retryable = true,
        )
        return@post
      }

      val confidence =
        data
          ?.getFloatArrayExtra(RecognizerIntent.EXTRA_CONFIDENCE_SCORES)
          ?.firstOrNull()
          ?.takeIf { it >= 0f }
          ?.toDouble()
      emitResult(EVENT_FINAL, sessionId, alternatives, confidence, isFinal = true)
      clearActiveSession(cancelFirst = false)
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun startOnMain(
    sessionId: String,
    locale: String,
    preferOnDevice: Boolean,
    allowNetworkFallback: Boolean,
    promise: Promise,
  ) {
    if (invalidated) {
      promise.reject(ERROR_UNKNOWN, "Speech recognition module is no longer available.")
      return
    }
    if (sessionId.isEmpty()) {
      promise.reject(ERROR_UNKNOWN, "sessionId must not be empty.")
      return
    }
    if (activeSession != null || systemActivityResultGate.hasPendingLaunch) {
      emitError(
        sessionId,
        ERROR_BUSY,
        "Another speech recognition session or system speech input is still active.",
        retryable = true,
      )
      promise.reject(
        ERROR_BUSY,
        "Another speech recognition session or system speech input is still active.",
      )
      return
    }
    if (!hasRecordAudioPermission()) {
      emitError(
        sessionId,
        ERROR_PERMISSION_DENIED,
        "Microphone permission is required.",
        retryable = false,
      )
      promise.reject(ERROR_PERMISSION_DENIED, "Microphone permission is required.")
      return
    }

    val decision =
      SpeechRecognitionPolicy.selectEngine(
        preferOnDevice = preferOnDevice,
        allowSystemRecognition = allowNetworkFallback,
        capabilities = currentEngineCapabilities(),
      )
    if (decision is SpeechStartDecision.Reject) {
      val failure = decision.failure
      emitError(
        sessionId,
        failure.code.wireValue,
        failure.message,
        failure.retryable,
      )
      promise.reject(failure.code.wireValue, failure.message)
      return
    }
    val engine = (decision as SpeechStartDecision.Start).engine

    generationCounter += 1
    val session =
      ActiveSession(
        id = sessionId,
        locale = locale,
        engine = engine,
        systemRecognitionAuthorized = allowNetworkFallback,
        generation = generationCounter,
      )
    activeSession = session

    if (engine == SpeechEngine.SYSTEM_ACTIVITY) {
      val launchError = launchSystemRecognitionActivity(sessionId, locale)
      if (launchError == null) {
        promise.resolve(true)
      } else {
        finishStartFailure(sessionId, ERROR_SERVICE_UNAVAILABLE, launchError, promise)
      }
      return
    }

    try {
      recognizer = createRecognizer(engine)
    } catch (error: RuntimeException) {
      finishStartFailure(
        sessionId,
        if (engine == SpeechEngine.ON_DEVICE) {
          ERROR_MODEL_MISSING
        } else {
          ERROR_SERVICE_UNAVAILABLE
        },
        error,
        promise,
      )
      return
    }

    val intent = recognitionIntent(locale, engine == SpeechEngine.ON_DEVICE)
    recognizer?.setRecognitionListener(
      createRecognitionListener(sessionId, session.generation),
    )
    emitState(
      sessionId,
      STATE_STARTING,
      engine.wireValue,
    )

    try {
      recognizer?.startListening(intent)
      promise.resolve(true)
    } catch (error: RuntimeException) {
      finishStartFailure(sessionId, ERROR_UNKNOWN, error, promise)
    }
  }

  private fun createRecognizer(engine: SpeechEngine): SpeechRecognizer =
    if (engine == SpeechEngine.ON_DEVICE && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
    } else {
      SpeechRecognizer.createSpeechRecognizer(context)
    }

  private fun recognitionIntent(locale: String, onDevice: Boolean) =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, MAX_RESULTS)
      if (onDevice) {
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      }
      if (onDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        putStringArrayListExtra(
          RecognizerIntent.EXTRA_BIASING_STRINGS,
          ArrayList(BOOKKEEPING_BIASING_TERMS),
        )
      }
    }

  private fun createRecognitionListener(sessionId: String, generation: Int) =
    object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) {
        if (isCurrentSession(sessionId, generation)) {
          emitState(sessionId, STATE_LISTENING, "ready")
        }
      }

      override fun onBeginningOfSpeech() {
        if (isCurrentSession(sessionId, generation)) {
          emitState(sessionId, STATE_LISTENING, "speech-detected")
        }
      }

      override fun onRmsChanged(rmsdB: Float) = Unit

      override fun onBufferReceived(buffer: ByteArray?) = Unit

      override fun onEndOfSpeech() {
        if (isCurrentSession(sessionId, generation)) {
          emitState(sessionId, STATE_PROCESSING, "speech-ended")
        }
      }

      override fun onError(error: Int) {
        if (!isCurrentSession(sessionId, generation)) {
          return
        }
        val session = activeSession ?: return
        when (
          val decision =
            SpeechRecognitionPolicy.resolveAndroidError(
              androidErrorCode = error,
              microphonePermissionGranted = hasRecordAudioPermission(),
              engine = session.engine,
              systemRecognitionAuthorized = session.systemRecognitionAuthorized,
              systemActivityAvailable = isSystemRecognitionActivityAvailable(),
            )
        ) {
          SpeechErrorDecision.UseSystemActivity -> {
            val launchError = launchSystemRecognitionActivity(sessionId, session.locale)
            if (launchError == null) {
              return
            }
            finishWithError(
              sessionId,
              ERROR_SERVICE_UNAVAILABLE,
              launchError.message ?: "Unable to open the system speech input.",
              retryable = false,
              androidErrorCode = error,
            )
          }
          is SpeechErrorDecision.Fail -> {
            val failure = decision.failure
            finishWithError(
              sessionId,
              failure.code.wireValue,
              failure.message,
              failure.retryable,
              androidErrorCode = error,
            )
          }
        }
      }

      override fun onResults(results: Bundle?) {
        if (!isCurrentSession(sessionId, generation)) {
          return
        }
        val alternatives = recognitionAlternatives(results)
        if (alternatives.isEmpty()) {
          finishWithError(
            sessionId,
            ERROR_NO_SPEECH,
            "No recognizable speech was detected.",
            retryable = true,
          )
          return
        }

        emitResult(
          EVENT_FINAL,
          sessionId,
          alternatives,
          confidenceAt(results, 0),
          isFinal = true,
        )
        clearActiveSession(cancelFirst = false)
      }

      override fun onPartialResults(partialResults: Bundle?) {
        if (!isCurrentSession(sessionId, generation)) {
          return
        }
        val alternatives = recognitionAlternatives(partialResults)
        if (alternatives.isNotEmpty()) {
          emitResult(
            EVENT_PARTIAL,
            sessionId,
            alternatives,
            confidenceAt(partialResults, 0),
            isFinal = false,
          )
        }
      }

      override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

  private fun finishStartFailure(
    sessionId: String,
    code: String,
    error: RuntimeException,
    promise: Promise,
  ) {
    val message = error.message ?: "Unable to start speech recognition."
    finishWithError(sessionId, code, message, retryable = code == ERROR_MODEL_MISSING)
    promise.reject(code, message, error)
  }

  private fun finishWithError(
    sessionId: String,
    code: String,
    message: String,
    retryable: Boolean,
    androidErrorCode: Int? = null,
  ) {
    if (!isCurrentSession(sessionId)) {
      return
    }
    emitError(sessionId, code, message, retryable, androidErrorCode)
    clearActiveSession(cancelFirst = false)
  }

  private fun clearActiveSession(cancelFirst: Boolean) {
    activeSession?.let { session ->
      if (session.engine == SpeechEngine.SYSTEM_ACTIVITY) {
        systemActivityResultGate.markCancelled(session.id, session.generation)
      }
    }
    activeSession = null
    generationCounter += 1
    destroyRecognizerOnly(cancelFirst)
  }

  private fun launchSystemRecognitionActivity(
    sessionId: String,
    locale: String,
  ): RuntimeException? {
    if (!isCurrentSession(sessionId)) {
      return IllegalStateException("The speech session is no longer active.")
    }
    val activity = context.currentActivity
      ?: return IllegalStateException("No foreground Activity can open system speech input.")
    val intent = systemRecognitionActivityIntent(locale)
    if (intent.resolveActivity(activity.packageManager) == null) {
      return IllegalStateException("No system speech input Activity is installed or enabled.")
    }

    val currentSession = activeSession
      ?: return IllegalStateException("The speech session is no longer active.")
    val nextGeneration = generationCounter + 1
    val launch =
      systemActivityResultGate.begin(sessionId, nextGeneration)
        ?: return IllegalStateException("A previous system speech input is still active.")
    generationCounter = nextGeneration
    activeSession =
      currentSession.copy(
        engine = SpeechEngine.SYSTEM_ACTIVITY,
        generation = nextGeneration,
      )
    destroyRecognizerOnly(cancelFirst = false)
    emitState(sessionId, STATE_STARTING, "system-activity")
    return try {
      activity.startActivityForResult(intent, launch.requestCode)
      null
    } catch (error: RuntimeException) {
      systemActivityResultGate.abandon(launch)
      error
    }
  }

  private fun systemRecognitionActivityIntent(locale: String) =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, MAX_RESULTS)
      putExtra(RecognizerIntent.EXTRA_PROMPT, "请说出金额、用途、账户和时间")
    }

  private fun destroyRecognizerOnly(cancelFirst: Boolean) {
    val current = recognizer
    recognizer = null
    if (current != null) {
      try {
        if (cancelFirst) {
          current.cancel()
        }
      } catch (_: RuntimeException) {
        // The recognizer may already have detached from its service.
      }
      try {
        current.destroy()
      } catch (_: RuntimeException) {
        // Destruction is best effort during lifecycle cleanup.
      }
    }
  }

  private fun releaseForLifecycle() {
    mainHandler.post {
      val sessionId = activeSession?.id ?: return@post
      emitError(
        sessionId,
        ERROR_CANCELLED,
        "Speech recognition was cancelled because the app left the foreground.",
        retryable = true,
      )
      clearActiveSession(cancelFirst = true)
    }
  }

  private fun emitState(sessionId: String, state: String, reason: String) {
    val engine = activeSession?.engine
    emitEvent(
      EVENT_STATE,
      Arguments.createMap().apply {
        putString("sessionId", sessionId)
        putString("state", state)
        putString("reason", reason)
        putString("mode", engine?.wireValue)
        putBoolean("mayUseNetwork", engine?.mayUseNetwork == true)
      },
    )
  }

  private fun emitResult(
    eventName: String,
    sessionId: String,
    alternatives: List<String>,
    confidence: Double?,
    isFinal: Boolean,
  ) {
    emitEvent(
      eventName,
      Arguments.createMap().apply {
        putString("sessionId", sessionId)
        putString("text", alternatives.first())
        putArray("alternatives", alternatives.toWritableArray())
        if (confidence == null) {
          putNull("confidence")
        } else {
          putDouble("confidence", confidence)
        }
        putBoolean("isFinal", isFinal)
        putString("mode", activeSession?.engine?.wireValue)
      },
    )
  }

  private fun emitError(
    sessionId: String,
    code: String,
    message: String,
    retryable: Boolean,
    androidErrorCode: Int? = null,
  ) {
    emitEvent(
      EVENT_ERROR,
      Arguments.createMap().apply {
        putString("sessionId", sessionId)
        putString("code", code)
        putString("message", message)
        putBoolean("retryable", retryable)
        putString("mode", activeSession?.engine?.wireValue)
        if (androidErrorCode == null) {
          putNull("androidErrorCode")
        } else {
          putInt("androidErrorCode", androidErrorCode)
        }
      },
    )
  }

  private fun emitEvent(eventName: String, payload: WritableMap) {
    if (context.hasActiveReactInstance()) {
      context.emitDeviceEvent(eventName, payload)
    }
  }

  private fun recognitionAlternatives(results: Bundle?): List<String> =
    results
      ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
      ?.map(String::trim)
      ?.filter(String::isNotEmpty)
      ?.take(MAX_RESULTS)
      .orEmpty()

  private fun confidenceAt(results: Bundle?, index: Int): Double? {
    val scores = results?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES) ?: return null
    val score = scores.getOrNull(index) ?: return null
    return if (score < 0f) null else score.toDouble()
  }

  private fun List<String>.toWritableArray(): WritableArray =
    Arguments.createArray().also { array -> forEach(array::pushString) }

  private fun isCurrentSession(sessionId: String) = activeSession?.id == sessionId

  private fun isCurrentSession(sessionId: String, generation: Int) =
    activeSession?.let { it.id == sessionId && it.generation == generation } == true

  private fun hasRecordAudioPermission() =
    context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  private fun currentPermissionStatus() =
    if (hasRecordAudioPermission()) PERMISSION_GRANTED else PERMISSION_DENIED

  private fun isOnDeviceRecognitionAvailable() =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

  private fun currentEngineCapabilities() =
    SpeechEngineCapabilities(
      onDeviceAvailable = isOnDeviceRecognitionAvailable(),
      systemActivityAvailable = isSystemRecognitionActivityAvailable(),
      directSystemAvailable = SpeechRecognizer.isRecognitionAvailable(context),
    )

  private fun isSystemRecognitionActivityAvailable(): Boolean {
    return systemRecognitionActivityIntent(DEFAULT_LOCALE)
      .resolveActivity(context.packageManager) != null
  }

  private fun normalizeLocale(locale: String?) =
    locale?.trim()?.takeIf(String::isNotEmpty) ?: DEFAULT_LOCALE

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

  private data class ActiveSession(
    val id: String,
    val locale: String,
    val engine: SpeechEngine,
    val systemRecognitionAuthorized: Boolean,
    val generation: Int,
  )

  companion object {
    const val NAME = "SpeechRecognition"

    const val EVENT_STATE = "SpeechRecognitionState"
    const val EVENT_PARTIAL = "SpeechRecognitionPartial"
    const val EVENT_FINAL = "SpeechRecognitionFinal"
    const val EVENT_ERROR = "SpeechRecognitionError"

    private const val DEFAULT_LOCALE = "zh-CN"
    private const val MAX_RESULTS = 3
    private const val PERMISSION_REQUEST_CODE = 61342
    private const val STATE_STARTING = "starting"
    private const val STATE_LISTENING = "listening"
    private const val STATE_PROCESSING = "processing"
    private const val STATE_CANCELLED = "cancelled"

    private const val PERMISSION_GRANTED = "granted"
    private const val PERMISSION_DENIED = "denied"
    private const val PERMISSION_BLOCKED = "blocked"

    private const val ERROR_PERMISSION_DENIED = "permission-denied"
    private const val ERROR_SERVICE_UNAVAILABLE = "service-unavailable"
    private const val ERROR_MODEL_MISSING = "model-missing"
    private const val ERROR_NO_SPEECH = "no-speech"
    private const val ERROR_BUSY = "busy"
    private const val ERROR_CANCELLED = "cancelled"
    private const val ERROR_UNKNOWN = "unknown"

    private val BOOKKEEPING_BIASING_TERMS =
      listOf(
        "微信",
        "支付宝",
        "信用卡",
        "银行卡",
        "退款",
        "报销",
        "还款",
        "早餐",
        "午饭",
        "晚饭",
        "打车",
        "高铁",
        "酒店",
        "元",
        "块",
      )
  }
}
