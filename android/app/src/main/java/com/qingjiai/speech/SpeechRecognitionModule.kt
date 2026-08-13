package com.qingjiai.speech

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.ModelDownloadListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
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
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

@ReactModule(name = SpeechRecognitionModule.NAME)
class SpeechRecognitionModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context), LifecycleEventListener, ActivityEventListener {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val permissionLock = Any()
  private val systemActivityResultGate = SystemSpeechActivityResultGate()
  private val speechWatchdogGate = SpeechSessionWatchdogGate()
  private val callbackExecutor = Executor { command -> mainHandler.post(command) }
  private val modelStateByLocale = mutableMapOf<String, SpeechModelState>()

  private var recognizer: SpeechRecognizer? = null
  private var activeSession: ActiveSession? = null
  private var generationCounter = 0
  private var pendingPermissionRequest: PendingPermissionRequest? = null
  private var nextPermissionRequestCode = PERMISSION_REQUEST_CODE_START
  private var permissionTimeoutRunnable: Runnable? = null
  private var speechWatchdogRunnable: Runnable? = null
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
      checkCapabilities(normalizedLocale, promise)
    }
  }

  @ReactMethod
  fun downloadModel(locale: String?, promise: Promise) {
    mainHandler.post {
      if (invalidated) {
        promise.reject(ERROR_UNKNOWN, "Speech recognition module is no longer available.")
        return@post
      }
      val normalizedLocale = normalizeLocale(locale)
      if (!isOnDeviceRecognitionServiceAvailable()) {
        modelStateByLocale[localeKey(normalizedLocale)] = SpeechModelState.UNSUPPORTED
        resolveModelDownload(promise, normalizedLocale, SpeechModelState.UNSUPPORTED)
        return@post
      }
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        modelStateByLocale[localeKey(normalizedLocale)] = SpeechModelState.UNKNOWN
        resolveModelDownload(promise, normalizedLocale, SpeechModelState.UNKNOWN)
        return@post
      }

      val downloadRecognizer =
        try {
          SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        } catch (error: RuntimeException) {
          promise.reject(ERROR_MODEL_DOWNLOAD_FAILED, error.message, error)
          return@post
        }
      val intent = recognitionIntent(normalizedLocale, onDevice = true)
      modelStateByLocale[localeKey(normalizedLocale)] = SpeechModelState.DOWNLOADING
      var guardedCompletion: AtomicBoolean? = null
      var guardedTimeout: Runnable? = null

      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          val completed = AtomicBoolean(false)
          guardedCompletion = completed
          val timeout =
            Runnable {
              if (completed.compareAndSet(false, true)) {
                modelStateByLocale[localeKey(normalizedLocale)] =
                  SpeechModelState.DOWNLOADING
                resolveModelDownload(
                  promise,
                  normalizedLocale,
                  SpeechModelState.DOWNLOADING,
                )
                destroyTemporaryRecognizer(downloadRecognizer)
              }
            }
          guardedTimeout = timeout
          mainHandler.postDelayed(timeout, MODEL_OPERATION_TIMEOUT_MS)
          downloadRecognizer.triggerModelDownload(
            intent,
            callbackExecutor,
            object : ModelDownloadListener {
              override fun onProgress(completedPercent: Int) = Unit

              override fun onSuccess() {
                if (!completed.compareAndSet(false, true)) {
                  return
                }
                mainHandler.removeCallbacks(timeout)
                modelStateByLocale[localeKey(normalizedLocale)] = SpeechModelState.READY
                resolveModelDownload(promise, normalizedLocale, SpeechModelState.READY)
                destroyTemporaryRecognizer(downloadRecognizer)
              }

              override fun onScheduled() {
                if (!completed.compareAndSet(false, true)) {
                  return
                }
                mainHandler.removeCallbacks(timeout)
                modelStateByLocale[localeKey(normalizedLocale)] =
                  SpeechModelState.DOWNLOADING
                resolveModelDownload(promise, normalizedLocale, SpeechModelState.DOWNLOADING)
                destroyTemporaryRecognizer(downloadRecognizer)
              }

              override fun onError(error: Int) {
                if (!completed.compareAndSet(false, true)) {
                  return
                }
                mainHandler.removeCallbacks(timeout)
                if (SpeechRecognitionPolicy.shouldUseUnobservedModelDownload(error)) {
                  try {
                    @Suppress("DEPRECATION")
                    downloadRecognizer.triggerModelDownload(intent)
                    modelStateByLocale[localeKey(normalizedLocale)] =
                      SpeechModelState.DOWNLOADING
                    resolveModelDownload(
                      promise,
                      normalizedLocale,
                      SpeechModelState.DOWNLOADING,
                    )
                  } catch (fallbackError: RuntimeException) {
                    modelStateByLocale[localeKey(normalizedLocale)] =
                      SpeechModelState.DOWNLOADABLE
                    promise.reject(
                      ERROR_MODEL_DOWNLOAD_FAILED,
                      fallbackError.message,
                      fallbackError,
                    )
                  }
                  destroyTemporaryRecognizer(downloadRecognizer)
                  return
                }
                modelStateByLocale[localeKey(normalizedLocale)] =
                  SpeechModelState.DOWNLOADABLE
                promise.reject(
                  ERROR_MODEL_DOWNLOAD_FAILED,
                  "Android could not prepare the speech model (error $error).",
                )
                destroyTemporaryRecognizer(downloadRecognizer)
              }
            },
          )
        } else {
          @Suppress("DEPRECATION")
          downloadRecognizer.triggerModelDownload(intent)
          resolveModelDownload(promise, normalizedLocale, SpeechModelState.DOWNLOADING)
          destroyTemporaryRecognizer(downloadRecognizer)
        }
      } catch (error: RuntimeException) {
        val completion = guardedCompletion
        if (completion != null && !completion.compareAndSet(false, true)) {
          return@post
        }
        guardedTimeout?.let(mainHandler::removeCallbacks)
        modelStateByLocale[localeKey(normalizedLocale)] = SpeechModelState.DOWNLOADABLE
        destroyTemporaryRecognizer(downloadRecognizer)
        promise.reject(ERROR_MODEL_DOWNLOAD_FAILED, error.message, error)
      }
    }
  }

  @ReactMethod
  fun requestPermission(sessionId: String, promise: Promise) {
    mainHandler.post {
      val permissionOwner = sessionId.trim()
      if (permissionOwner.isEmpty()) {
        promise.reject(ERROR_UNKNOWN, "sessionId must not be empty.")
        return@post
      }
      when (currentMicrophoneAccess()) {
        MicrophoneAccessState.AVAILABLE -> {
          resolvePermission(promise, PERMISSION_GRANTED, true)
          return@post
        }
        MicrophoneAccessState.PRIVACY_BLOCKED,
        -> {
          resolvePermission(
            promise,
            PERMISSION_RESTRICTED,
            false,
            ERROR_MICROPHONE_DISABLED,
          )
          return@post
        }
        MicrophoneAccessState.HARDWARE_UNAVAILABLE -> {
          resolvePermission(
            promise,
            PERMISSION_RESTRICTED,
            false,
            ERROR_MICROPHONE_UNAVAILABLE,
          )
          return@post
        }
        MicrophoneAccessState.PERMISSION_MISSING -> Unit
      }

      val activity = context.currentActivity as? PermissionAwareActivity
      if (activity == null) {
        // There is no foreground host to show a runtime prompt. This is temporary and is not
        // equivalent to the user permanently blocking the microphone permission.
        resolvePermission(promise, PERMISSION_DENIED, true)
        return@post
      }

      val requestCode =
        synchronized(permissionLock) {
          if (pendingPermissionRequest != null) {
            promise.reject(ERROR_BUSY, "A microphone permission request is already active.")
            return@post
          }
          if (nextPermissionRequestCode > PERMISSION_REQUEST_CODE_END) {
            promise.reject(ERROR_SERVICE_UNAVAILABLE, "Permission request codes are exhausted.")
            return@post
          }
          val code = nextPermissionRequestCode
          nextPermissionRequestCode += 1
          pendingPermissionRequest =
            PendingPermissionRequest(
              sessionId = permissionOwner,
              requestCode = code,
              promise = promise,
            )
          code
        }

      val timeout =
        Runnable {
          val pending = takePendingPermissionRequest(permissionOwner, requestCode)
          if (pending != null) {
            permissionTimeoutRunnable = null
            // The OS/OEM dropped the callback. This remains askable and must not be reported as a
            // permanent denial.
            resolvePermission(pending.promise, PERMISSION_DENIED, true)
          }
        }
      permissionTimeoutRunnable = timeout
      mainHandler.postDelayed(timeout, PERMISSION_REQUEST_TIMEOUT_MS)

      try {
        activity.requestPermissions(
          arrayOf(Manifest.permission.RECORD_AUDIO),
          requestCode,
          object : PermissionListener {
            override fun onRequestPermissionsResult(
              callbackRequestCode: Int,
              permissions: Array<String>,
              grantResults: IntArray,
            ): Boolean {
              if (callbackRequestCode != requestCode) {
                return false
              }

              val pending =
                takePendingPermissionRequest(permissionOwner, requestCode)
              if (pending == null) {
                return true
              }
              cancelPermissionTimeout()
              val pendingPromise = pending.promise

              val granted =
                grantResults.isNotEmpty() &&
                  grantResults[0] == PackageManager.PERMISSION_GRANTED
              if (granted) {
                if (currentMicrophoneAccess() == MicrophoneAccessState.AVAILABLE) {
                  resolvePermission(pendingPromise, PERMISSION_GRANTED, true)
                } else {
                  val access = currentMicrophoneAccess()
                  resolvePermission(
                    pendingPromise,
                    PERMISSION_RESTRICTED,
                    false,
                    if (access == MicrophoneAccessState.HARDWARE_UNAVAILABLE) {
                      ERROR_MICROPHONE_UNAVAILABLE
                    } else {
                      ERROR_MICROPHONE_DISABLED
                    },
                  )
                }
              } else {
                val currentActivity = context.currentActivity as? PermissionAwareActivity
                val canAskAgain =
                  currentActivity?.shouldShowRequestPermissionRationale(
                    Manifest.permission.RECORD_AUDIO,
                  ) == true
                resolvePermission(
                  pendingPromise,
                  if (canAskAgain) PERMISSION_DENIED else PERMISSION_BLOCKED,
                  canAskAgain,
                )
              }
              return true
            }
          },
        )
      } catch (_: RuntimeException) {
        val pending = takePendingPermissionRequest(permissionOwner, requestCode)
        if (pending != null) {
          cancelPermissionTimeout()
          resolvePermission(pending.promise, PERMISSION_DENIED, true)
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
      if (activeSession?.engine == SpeechEngine.SYSTEM_ACTIVITY) {
        // The external Activity owns capture and provides no portable stop contract.
        promise.resolve(false)
        return@post
      }
      val current = activeSession
      if (
        current?.endReason != null &&
          current.endReason != SpeechEndReason.USER_STOP
      ) {
        // The provider already owned and declared the endpoint. A late tap must
        // not relabel its pending final callback as user initiated.
        promise.resolve(false)
        return@post
      }

      try {
        activeSession =
          activeSession
            ?.copy(endReason = SpeechEndReason.USER_STOP)
        activeSession
          ?.takeIf { it.engine != SpeechEngine.SYSTEM_ACTIVITY }
          ?.let {
            armSpeechWatchdog(it, SpeechWatchdogPhase.FINAL_RESULT)
          }
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
      val permissionCancelled = cancelPendingPermission(sessionId)
      if (!isCurrentSession(sessionId)) {
        promise.resolve(permissionCancelled)
        return@post
      }

      clearActiveSession(cancelFirst = true)
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun destroy(sessionId: String, promise: Promise) {
    mainHandler.post {
      val permissionDestroyed = cancelPendingPermission(sessionId)
      val sessionDestroyed = isCurrentSession(sessionId)
      if (sessionDestroyed) {
        clearActiveSession(cancelFirst = true)
      }
      promise.resolve(permissionDestroyed || sessionDestroyed)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Double) = Unit

  override fun onHostResume() {
    mainHandler.post {
      activeSession
        ?.takeIf {
          it.engine == SpeechEngine.SYSTEM_ACTIVITY &&
            systemActivityResultGate.hasPendingLaunch
        }
        ?.let {
          // OEM Activities normally deliver onActivityResult before/on resume. If an Activity
          // vanished without a result, release the route promptly instead of remaining busy.
          armSpeechWatchdog(it, SpeechWatchdogPhase.SYSTEM_ACTIVITY_RETURN)
        }
    }
  }

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
    takePendingPermissionRequest()?.let {
      it.promise.reject(
        ERROR_CANCELLED,
        "Microphone permission request was interrupted.",
      )
    }
    cancelPermissionTimeout()
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
        session == null ||
          session.engine != SpeechEngine.SYSTEM_ACTIVITY ||
          session.id != launch.sessionId ||
          session.generation != launch.generation
      ) {
        return@post
      }
      val sessionId = session.id

      if (resultCode != Activity.RESULT_OK) {
        activeSession = session.copy(endReason = SpeechEndReason.CANCELLED)
        emitState(sessionId, STATE_CANCELLED, "system-activity-cancelled")
        clearActiveSession(cancelFirst = false)
        return@post
      }

      val alternatives =
        try {
          data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.map(String::trim)
            ?.filter(String::isNotEmpty)
            ?.take(MAX_RESULTS)
            .orEmpty()
        } catch (_: RuntimeException) {
          finishWithError(
            sessionId,
            ERROR_SERVICE_INCOMPATIBLE,
            "The system speech provider returned an invalid result.",
            retryable = true,
          )
          return@post
        }
      if (alternatives.isEmpty()) {
        finishWithError(
          sessionId,
          ERROR_NO_SPEECH,
          "The system speech input returned no recognizable text.",
          retryable = true,
        )
        return@post
      }
      if (!isTranscriptWithinLimit(alternatives.first())) {
        finishWithError(
          sessionId,
          ERROR_RESULT_TOO_LONG,
          "The speech result exceeded the bookkeeping text limit.",
          retryable = true,
        )
        return@post
      }

      val confidence =
        try {
          data
            ?.getFloatArrayExtra(RecognizerIntent.EXTRA_CONFIDENCE_SCORES)
            ?.firstOrNull()
            ?.takeIf { it >= 0f }
            ?.toDouble()
        } catch (_: RuntimeException) {
          null
        }
      activeSession = session.copy(endReason = SpeechEndReason.EXTERNAL_ACTIVITY)
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
    when (currentMicrophoneAccess()) {
      MicrophoneAccessState.PRIVACY_BLOCKED -> {
        emitError(
          sessionId,
          ERROR_MICROPHONE_DISABLED,
          "Microphone access is disabled by the Android privacy control.",
          retryable = false,
          stage = STAGE_PERMISSION,
        )
        promise.reject(
          ERROR_MICROPHONE_DISABLED,
          "Microphone access is disabled by the Android privacy control.",
        )
        return
      }
      MicrophoneAccessState.HARDWARE_UNAVAILABLE -> {
        emitError(
          sessionId,
          ERROR_MICROPHONE_UNAVAILABLE,
          "This device does not expose usable microphone hardware.",
          retryable = false,
          stage = STAGE_CAPABILITY,
        )
        promise.reject(
          ERROR_MICROPHONE_UNAVAILABLE,
          "This device does not expose usable microphone hardware.",
        )
        return
      }
      MicrophoneAccessState.AVAILABLE,
      MicrophoneAccessState.PERMISSION_MISSING,
      -> Unit
    }
    val decision =
      SpeechRecognitionPolicy.selectEngine(
        preferOnDevice = preferOnDevice,
        allowSystemRecognition = allowNetworkFallback,
        capabilities = currentEngineCapabilities(locale),
        directSystemHasMicrophoneAccess =
          currentMicrophoneAccess() == MicrophoneAccessState.AVAILABLE,
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
    if (
      engine.requiresAppMicrophonePermission &&
      currentMicrophoneAccess() == MicrophoneAccessState.PERMISSION_MISSING
    ) {
      emitError(
        sessionId,
        ERROR_PERMISSION_DENIED,
        "Microphone permission is required for direct speech capture.",
        retryable = false,
        engineOverride = engine,
        modelStateOverride =
          if (engine == SpeechEngine.ON_DEVICE) {
            modelStateFor(locale)
          } else {
            SpeechModelState.UNKNOWN
          },
        stage = STAGE_PERMISSION,
      )
      promise.reject(
        ERROR_PERMISSION_DENIED,
        "Microphone permission is required for direct speech capture.",
      )
      return
    }

    generationCounter += 1
    val session =
      ActiveSession(
        id = sessionId,
        locale = locale,
        engine = engine,
        modelState =
          if (engine == SpeechEngine.ON_DEVICE) {
            modelStateFor(locale)
          } else {
            SpeechModelState.UNKNOWN
          },
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
      recognizer?.setRecognitionListener(
        createRecognitionListener(sessionId, session.generation),
      )
    } catch (error: RuntimeException) {
      if (tryAuthorizedSystemActivityFallback(session)) {
        promise.resolve(true)
        return
      }
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
    emitState(
      sessionId,
      STATE_STARTING,
      engine.wireValue,
    )

    try {
      armSpeechWatchdog(session, SpeechWatchdogPhase.STARTING)
      recognizer?.startListening(intent)
      promise.resolve(true)
    } catch (error: RuntimeException) {
      if (tryAuthorizedSystemActivityFallback(session)) {
        promise.resolve(true)
        return
      }
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
          armListeningWatchdogUnlessFinishing(sessionId, generation)
          emitState(sessionId, STATE_LISTENING, "ready")
        }
      }

      override fun onBeginningOfSpeech() {
        if (isCurrentSession(sessionId, generation)) {
          armListeningWatchdogUnlessFinishing(sessionId, generation)
          emitState(sessionId, STATE_LISTENING, "speech-detected")
        }
      }

      override fun onRmsChanged(rmsdB: Float) = Unit

      override fun onBufferReceived(buffer: ByteArray?) = Unit

      override fun onEndOfSpeech() {
        if (isCurrentSession(sessionId, generation)) {
          val session = activeSession
          if (session != null && session.endReason == null) {
            activeSession = session.copy(endReason = SpeechEndReason.PROVIDER_ENDPOINT)
          }
          activeSession?.let {
            armSpeechWatchdog(it, SpeechWatchdogPhase.FINAL_RESULT)
          }
          emitState(sessionId, STATE_PROCESSING, "speech-ended")
        }
      }

      override fun onError(error: Int) {
        if (!isCurrentSession(sessionId, generation)) {
          return
        }
        val session = activeSession ?: return
        if (session.engine == SpeechEngine.ON_DEVICE) {
          val nextModelState =
            when (error) {
              SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> SpeechModelState.UNSUPPORTED
              SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                  SpeechModelState.DOWNLOADABLE
                } else {
                  SpeechModelState.UNKNOWN
                }
              else -> null
            }
          if (nextModelState != null) {
            modelStateByLocale[localeKey(session.locale)] = nextModelState
            activeSession = session.copy(modelState = nextModelState)
          }
        }
        when (
          val decision =
            SpeechRecognitionPolicy.resolveAndroidError(
              androidErrorCode = error,
              microphoneAccess = currentMicrophoneAccess(),
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
        val alternatives = safeRecognitionAlternatives(results)
        if (alternatives.isEmpty()) {
          finishWithError(
            sessionId,
            ERROR_NO_SPEECH,
            "No recognizable speech was detected.",
            retryable = true,
          )
          return
        }
        if (!isTranscriptWithinLimit(alternatives.first())) {
          finishWithError(
            sessionId,
            ERROR_RESULT_TOO_LONG,
            "The speech result exceeded the bookkeeping text limit.",
            retryable = true,
          )
          return
        }

        val session = activeSession
        if (session != null && session.endReason == null) {
          activeSession = session.copy(endReason = SpeechEndReason.PROVIDER_ENDPOINT)
        }
        markOnDeviceModelReady()
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
        val alternatives = safeRecognitionAlternatives(partialResults)
        if (alternatives.isNotEmpty()) {
          if (!isTranscriptWithinLimit(alternatives.first())) {
            finishWithError(
              sessionId,
              ERROR_RESULT_TOO_LONG,
              "The speech result exceeded the bookkeeping text limit.",
              retryable = true,
            )
            return
          }
          armListeningWatchdogUnlessFinishing(sessionId, generation)
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
    stage: String = STAGE_RESULT,
  ) {
    if (!isCurrentSession(sessionId)) {
      return
    }
    emitError(
      sessionId,
      code,
      message,
      retryable,
      androidErrorCode,
      stage = stage,
    )
    clearActiveSession(cancelFirst = false)
  }

  private fun armListeningWatchdogUnlessFinishing(
    sessionId: String,
    generation: Int,
  ) {
    if (
      speechWatchdogGate.activePhase(sessionId, generation) ==
        SpeechWatchdogPhase.FINAL_RESULT
    ) {
      return
    }
    activeSession
      ?.takeIf {
        it.id == sessionId &&
          it.generation == generation &&
          it.engine != SpeechEngine.SYSTEM_ACTIVITY
      }
      ?.let {
        armSpeechWatchdog(it, SpeechWatchdogPhase.LISTENING)
      }
  }

  private fun armSpeechWatchdog(
    session: ActiveSession,
    phase: SpeechWatchdogPhase,
  ) {
    speechWatchdogRunnable?.let(mainHandler::removeCallbacks)
    val token =
      speechWatchdogGate.arm(
        sessionId = session.id,
        generation = session.generation,
        phase = phase,
      )
    val callback =
      Runnable {
        if (!speechWatchdogGate.consume(token)) {
          return@Runnable
        }
        if (!isCurrentSession(token.sessionId, token.generation)) {
          return@Runnable
        }
        speechWatchdogRunnable = null
        val currentSession = activeSession
        if (
          token.phase == SpeechWatchdogPhase.STARTING &&
          currentSession != null &&
          tryAuthorizedSystemActivityFallback(currentSession)
        ) {
          return@Runnable
        }
        val failure = SpeechSessionWatchdogPolicy.failureFor(token.phase)
        finishWithError(
          sessionId = token.sessionId,
          code = failure.code.wireValue,
          message = failure.message,
          retryable = failure.retryable,
          stage = token.phase.diagnosticStage,
        )
      }
    speechWatchdogRunnable = callback
    mainHandler.postDelayed(callback, phase.timeoutMs)
  }

  private fun cancelSpeechWatchdog() {
    speechWatchdogRunnable?.let(mainHandler::removeCallbacks)
    speechWatchdogRunnable = null
    speechWatchdogGate.reset()
  }

  private fun clearActiveSession(cancelFirst: Boolean) {
    cancelSpeechWatchdog()
    activeSession?.let { session ->
      if (session.engine == SpeechEngine.SYSTEM_ACTIVITY) {
        val retired = systemActivityResultGate.retire(session.id, session.generation)
        if (retired != null) {
          try {
            context.currentActivity?.finishActivity(retired.requestCode)
          } catch (_: RuntimeException) {
            // A provider may already have finished or detached. The retired code stays invalid.
          }
        }
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
    if (!isSystemRecognitionActivityAvailable()) {
      return IllegalStateException("No system speech input Activity is installed or enabled.")
    }

    val currentSession = activeSession
      ?: return IllegalStateException("The speech session is no longer active.")
    val nextGeneration = generationCounter + 1
    val launch =
      systemActivityResultGate.begin(sessionId, nextGeneration)
        ?: return IllegalStateException("A previous system speech input is still active.")
    cancelSpeechWatchdog()
    generationCounter = nextGeneration
    activeSession =
      currentSession.copy(
        engine = SpeechEngine.SYSTEM_ACTIVITY,
        modelState = SpeechModelState.UNKNOWN,
        generation = nextGeneration,
        progress = SpeechSessionProgress.STARTING,
        endReason = null,
      )
    destroyRecognizerOnly(cancelFirst = false)
    emitState(sessionId, STATE_STARTING, "system-activity")
    return try {
      activity.startActivityForResult(intent, launch.requestCode)
      activeSession?.let {
        armSpeechWatchdog(it, SpeechWatchdogPhase.SYSTEM_ACTIVITY)
      }
      null
    } catch (error: RuntimeException) {
      systemActivityResultGate.abandon(launch)
      error
    }
  }

  private fun tryAuthorizedSystemActivityFallback(session: ActiveSession): Boolean {
    if (
      session.engine == SpeechEngine.SYSTEM_ACTIVITY ||
      !session.systemRecognitionAuthorized ||
      !isSystemRecognitionActivityAvailable()
    ) {
      return false
    }
    return launchSystemRecognitionActivity(session.id, session.locale) == null
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
    var session = activeSession
    val nextProgress =
      when (state) {
        STATE_STARTING -> SpeechSessionProgress.STARTING
        STATE_LISTENING -> SpeechSessionProgress.LISTENING
        STATE_PROCESSING -> SpeechSessionProgress.PROCESSING
        else -> null
      }
    if (session?.id == sessionId && nextProgress != null) {
      if (!SpeechRecognitionPolicy.canAdvanceSession(session.progress, nextProgress)) {
        return
      }
      session = session.copy(progress = nextProgress)
      activeSession = session
    }
    val stage =
      when (state) {
        STATE_LISTENING -> STAGE_LISTENING
        STATE_PROCESSING -> STAGE_RESULT
        STATE_CANCELLED -> STAGE_LIFECYCLE
        else -> STAGE_START
      }
    emitEvent(
      EVENT_STATE,
      Arguments.createMap().apply {
        putString("sessionId", sessionId)
        putString("state", state)
        putString("reason", reason)
        putSpeechMetadata(
          session?.engine,
          session?.modelState,
          stage,
          session?.endReason,
        )
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
        putSpeechMetadata(
          activeSession?.engine,
          activeSession?.modelState,
          STAGE_RESULT,
          activeSession?.endReason,
        )
      },
    )
  }

  private fun emitError(
    sessionId: String,
    code: String,
    message: String,
    retryable: Boolean,
    androidErrorCode: Int? = null,
    engineOverride: SpeechEngine? = null,
    modelStateOverride: SpeechModelState? = null,
    stage: String = STAGE_RESULT,
  ) {
    val session = activeSession
    emitEvent(
      EVENT_ERROR,
      Arguments.createMap().apply {
        putString("sessionId", sessionId)
        putString("code", code)
        putString("message", message)
        putBoolean("retryable", retryable)
        putSpeechMetadata(
          engineOverride ?: session?.engine,
          modelStateOverride ?: session?.modelState,
          stage,
          session?.endReason,
        )
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

  private fun WritableMap.putSpeechMetadata(
    engine: SpeechEngine?,
    modelState: SpeechModelState?,
    stage: String,
    endReason: SpeechEndReason? = null,
  ) {
    putString("mode", engine?.wireValue)
    putString("provider", engine?.providerWireValue ?: "unknown")
    putString("route", engine?.routeWireValue ?: "unknown")
    putString("modelState", modelState?.wireValue ?: SpeechModelState.UNKNOWN.wireValue)
    putString("stage", stage)
    putBoolean("mayUseNetwork", engine?.mayUseNetwork == true)
    putString("captureOwnership", engine?.captureOwnershipWireValue ?: "unknown")
    putString("endpointOwnership", engine?.endpointOwnershipWireValue ?: "unknown")
    if (endReason == null) {
      putNull("endReason")
    } else {
      putString("endReason", endReason.wireValue)
    }
  }

  private fun safeRecognitionAlternatives(results: Bundle?): List<String> =
    try {
      results
        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        ?.map(String::trim)
        ?.filter(String::isNotEmpty)
        ?.take(MAX_RESULTS)
        .orEmpty()
    } catch (_: RuntimeException) {
      emptyList()
    }

  private fun markOnDeviceModelReady() {
    val session = activeSession ?: return
    if (session.engine != SpeechEngine.ON_DEVICE) {
      return
    }
    modelStateByLocale[localeKey(session.locale)] = SpeechModelState.READY
    activeSession = session.copy(modelState = SpeechModelState.READY)
  }

  private fun isTranscriptWithinLimit(value: String): Boolean =
    value.codePointCount(0, value.length) <= MAX_TRANSCRIPT_CHARACTERS

  private fun confidenceAt(results: Bundle?, index: Int): Double? {
    val scores =
      try {
        results?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
      } catch (_: RuntimeException) {
        null
      } ?: return null
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

  private fun hasMicrophoneHardware(): Boolean =
    try {
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_MICROPHONE)
    } catch (_: RuntimeException) {
      // Package-manager diagnostics must never make an otherwise usable route unreachable.
      true
    }

  private fun isMicrophonePrivacyEnabled(): Boolean {
    return try {
      // Android's public SDK exposes the effective system-wide microphone mute state here.
      // The Android 12 privacy toggle feeds this signal without relying on hidden APIs.
      (context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager)?.isMicrophoneMute == true
    } catch (_: RuntimeException) {
      false
    }
  }

  private fun currentMicrophoneAccess(): MicrophoneAccessState =
    SpeechRecognitionPolicy.resolveMicrophoneAccess(
      permissionGranted = hasRecordAudioPermission(),
      microphoneHardwareAvailable = hasMicrophoneHardware(),
      microphonePrivacyEnabled = isMicrophonePrivacyEnabled(),
    )

  private fun currentPermissionStatus() =
    when (currentMicrophoneAccess()) {
      MicrophoneAccessState.AVAILABLE -> PERMISSION_GRANTED
      MicrophoneAccessState.PERMISSION_MISSING -> PERMISSION_DENIED
      MicrophoneAccessState.PRIVACY_BLOCKED,
      MicrophoneAccessState.HARDWARE_UNAVAILABLE,
      -> PERMISSION_RESTRICTED
    }

  private fun isOnDeviceRecognitionServiceAvailable(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      try {
        SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
      } catch (_: RuntimeException) {
        false
      }

  private fun isDirectSystemRecognitionAvailable(): Boolean =
    try {
      SpeechRecognizer.isRecognitionAvailable(context)
    } catch (_: RuntimeException) {
      false
    }

  private fun currentEngineCapabilities(locale: String): SpeechEngineCapabilities {
    val modelState = modelStateFor(locale)
    return SpeechEngineCapabilities(
      onDeviceAvailable =
        SpeechRecognitionPolicy.canAttemptOnDevice(
          serviceAvailable = isOnDeviceRecognitionServiceAvailable(),
          modelState = modelState,
        ),
      onDeviceModelState = modelState,
      systemActivityAvailable = isSystemRecognitionActivityAvailable(),
      directSystemAvailable = isDirectSystemRecognitionAvailable(),
    )
  }

  private fun modelStateFor(locale: String): SpeechModelState {
    if (!isOnDeviceRecognitionServiceAvailable()) {
      return SpeechModelState.UNSUPPORTED
    }
    return modelStateByLocale[localeKey(locale)] ?: SpeechModelState.UNKNOWN
  }

  private fun checkCapabilities(
    locale: String,
    promise: Promise,
  ) {
    if (!isOnDeviceRecognitionServiceAvailable()) {
      modelStateByLocale[localeKey(locale)] = SpeechModelState.UNSUPPORTED
      resolveCapabilities(promise, locale, SpeechModelState.UNSUPPORTED)
      return
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      modelStateByLocale[localeKey(locale)] = SpeechModelState.UNKNOWN
      resolveCapabilities(promise, locale, SpeechModelState.UNKNOWN)
      return
    }

    val probe =
      try {
        SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
      } catch (_: RuntimeException) {
        modelStateByLocale[localeKey(locale)] = SpeechModelState.UNKNOWN
        resolveCapabilities(promise, locale, SpeechModelState.UNKNOWN)
        return
      }
    val completed = AtomicBoolean(false)
    val timeout =
      Runnable {
        if (completed.compareAndSet(false, true)) {
          modelStateByLocale[localeKey(locale)] = SpeechModelState.UNKNOWN
          resolveCapabilities(promise, locale, SpeechModelState.UNKNOWN)
          destroyTemporaryRecognizer(probe)
        }
      }
    mainHandler.postDelayed(timeout, CAPABILITY_TIMEOUT_MS)
    try {
      probe.checkRecognitionSupport(
        recognitionIntent(locale, onDevice = true),
        callbackExecutor,
        object : RecognitionSupportCallback {
          override fun onSupportResult(recognitionSupport: RecognitionSupport) {
            if (!completed.compareAndSet(false, true)) {
              return
            }
            mainHandler.removeCallbacks(timeout)
            val state =
              SpeechRecognitionPolicy.resolveModelState(
                requestedLocale = locale,
                installedLanguages = recognitionSupport.installedOnDeviceLanguages,
                supportedLanguages = recognitionSupport.supportedOnDeviceLanguages,
                pendingLanguages = recognitionSupport.pendingOnDeviceLanguages,
              )
            modelStateByLocale[localeKey(locale)] = state
            resolveCapabilities(promise, locale, state)
            destroyTemporaryRecognizer(probe)
          }

          override fun onError(error: Int) {
            if (!completed.compareAndSet(false, true)) {
              return
            }
            mainHandler.removeCallbacks(timeout)
            modelStateByLocale[localeKey(locale)] = SpeechModelState.UNKNOWN
            resolveCapabilities(promise, locale, SpeechModelState.UNKNOWN)
            destroyTemporaryRecognizer(probe)
          }
        },
      )
    } catch (_: RuntimeException) {
      if (!completed.compareAndSet(false, true)) {
        return
      }
      mainHandler.removeCallbacks(timeout)
      modelStateByLocale[localeKey(locale)] = SpeechModelState.UNKNOWN
      destroyTemporaryRecognizer(probe)
      resolveCapabilities(promise, locale, SpeechModelState.UNKNOWN)
    }
  }

  private fun resolveCapabilities(
    promise: Promise,
    locale: String,
    modelState: SpeechModelState,
  ) {
    val capabilities =
      SpeechEngineCapabilities(
        onDeviceAvailable =
          SpeechRecognitionPolicy.canAttemptOnDevice(
            serviceAvailable = isOnDeviceRecognitionServiceAvailable(),
            modelState = modelState,
          ),
        onDeviceModelState = modelState,
        systemActivityAvailable = isSystemRecognitionActivityAvailable(),
        directSystemAvailable = isDirectSystemRecognitionAvailable(),
      )
    val providers =
      Arguments.createArray().apply {
        pushMap(
          providerPayload(
            SpeechEngine.ON_DEVICE,
            available = capabilities.onDeviceAvailable,
            modelState = modelState,
          ),
        )
        pushMap(
          providerPayload(
            SpeechEngine.SYSTEM_ACTIVITY,
            available = capabilities.systemActivityAvailable,
            modelState = SpeechModelState.UNKNOWN,
          ),
        )
        pushMap(
          providerPayload(
            SpeechEngine.DIRECT_SYSTEM,
            available = capabilities.directSystemAvailable,
            modelState = SpeechModelState.UNKNOWN,
          ),
        )
      }
    promise.resolve(
      Arguments.createMap().apply {
        putBoolean("available", capabilities.anyAvailable)
        putBoolean("onDeviceAvailable", capabilities.onDeviceAvailable)
        putString("locale", locale)
        putString("platform", "android")
        putString("modelState", modelState.wireValue)
        putArray("providers", providers)
        putString("stage", STAGE_CAPABILITY)
        putBoolean("networkFallbackRequiresConsent", true)
        putString("permissionStatus", currentPermissionStatus())
      },
    )
  }

  private fun providerPayload(
    engine: SpeechEngine,
    available: Boolean,
    modelState: SpeechModelState,
  ) =
    Arguments.createMap().apply {
      putString("provider", engine.providerWireValue)
      putString("route", engine.routeWireValue)
      putBoolean("available", available)
      putString("modelState", modelState.wireValue)
      putBoolean(
        "requiresMicrophonePermission",
        engine.requiresAppMicrophonePermission,
      )
      putBoolean("mayUseNetwork", engine.mayUseNetwork)
      putString("captureOwnership", engine.captureOwnershipWireValue)
      putString("endpointOwnership", engine.endpointOwnershipWireValue)
      putString("stage", STAGE_CAPABILITY)
    }

  private fun resolveModelDownload(
    promise: Promise,
    locale: String,
    modelState: SpeechModelState,
  ) {
    promise.resolve(
      Arguments.createMap().apply {
        putString("locale", locale)
        putString("provider", SpeechEngine.ON_DEVICE.providerWireValue)
        putString("modelState", modelState.wireValue)
        putString("stage", STAGE_MODEL_PREPARATION)
      },
    )
  }

  private fun destroyTemporaryRecognizer(recognizer: SpeechRecognizer) {
    try {
      recognizer.destroy()
    } catch (_: RuntimeException) {
      // Capability and model probes do not own an active audio session.
    }
  }

  private fun localeKey(locale: String) =
    locale.trim().replace('_', '-').lowercase()

  private fun isSystemRecognitionActivityAvailable(): Boolean {
    return try {
      systemRecognitionActivityIntent(DEFAULT_LOCALE)
        .resolveActivity(context.packageManager) != null
    } catch (_: RuntimeException) {
      false
    }
  }

  private fun normalizeLocale(locale: String?) =
    locale?.trim()?.takeIf(String::isNotEmpty) ?: DEFAULT_LOCALE

  private fun resolvePermission(
    promise: Promise,
    status: String,
    canAskAgain: Boolean,
    reason: String? = null,
  ) {
    promise.resolve(
      Arguments.createMap().apply {
        putString("status", status)
        putBoolean("canAskAgain", canAskAgain)
        if (reason == null) {
          putNull("reason")
        } else {
          putString("reason", reason)
        }
      },
    )
  }

  private fun takePendingPermissionRequest(
    sessionId: String? = null,
    requestCode: Int? = null,
  ): PendingPermissionRequest? =
    synchronized(permissionLock) {
      val pending = pendingPermissionRequest ?: return@synchronized null
      if (sessionId != null && pending.sessionId != sessionId) {
        return@synchronized null
      }
      if (requestCode != null && pending.requestCode != requestCode) {
        return@synchronized null
      }
      pendingPermissionRequest = null
      pending
    }

  private fun cancelPendingPermission(sessionId: String): Boolean {
    val pending = takePendingPermissionRequest(sessionId = sessionId) ?: return false
    cancelPermissionTimeout()
    pending.promise.reject(
      ERROR_CANCELLED,
      "Microphone permission request was cancelled by its owning session.",
    )
    return true
  }

  private fun cancelPermissionTimeout() {
    permissionTimeoutRunnable?.let(mainHandler::removeCallbacks)
    permissionTimeoutRunnable = null
  }

  private data class ActiveSession(
    val id: String,
    val locale: String,
    val engine: SpeechEngine,
    val modelState: SpeechModelState,
    val systemRecognitionAuthorized: Boolean,
    val generation: Int,
    val progress: SpeechSessionProgress = SpeechSessionProgress.STARTING,
    val endReason: SpeechEndReason? = null,
  )

  private data class PendingPermissionRequest(
    val sessionId: String,
    val requestCode: Int,
    val promise: Promise,
  )

  companion object {
    const val NAME = "SpeechRecognition"

    const val EVENT_STATE = "SpeechRecognitionState"
    const val EVENT_PARTIAL = "SpeechRecognitionPartial"
    const val EVENT_FINAL = "SpeechRecognitionFinal"
    const val EVENT_ERROR = "SpeechRecognitionError"

    private const val DEFAULT_LOCALE = "zh-CN"
    private const val MAX_RESULTS = 3
    private const val MAX_TRANSCRIPT_CHARACTERS = 500
    private const val CAPABILITY_TIMEOUT_MS = 5_000L
    private const val MODEL_OPERATION_TIMEOUT_MS = 10_000L
    private const val PERMISSION_REQUEST_TIMEOUT_MS = 20_000L
    private const val PERMISSION_REQUEST_CODE_START = 0x3000
    private const val PERMISSION_REQUEST_CODE_END = 0x3FFE
    private const val STATE_STARTING = "starting"
    private const val STATE_LISTENING = "listening"
    private const val STATE_PROCESSING = "processing"
    private const val STATE_CANCELLED = "cancelled"
    private const val STAGE_CAPABILITY = "capability"
    private const val STAGE_PERMISSION = "permission"
    private const val STAGE_MODEL_PREPARATION = "model-preparation"
    private const val STAGE_START = "start"
    private const val STAGE_LISTENING = "listening"
    private const val STAGE_RESULT = "result"
    private const val STAGE_LIFECYCLE = "lifecycle"

    private const val PERMISSION_GRANTED = "granted"
    private const val PERMISSION_DENIED = "denied"
    private const val PERMISSION_BLOCKED = "blocked"
    private const val PERMISSION_RESTRICTED = "restricted"

    private const val ERROR_PERMISSION_DENIED = "permission-denied"
    private const val ERROR_MICROPHONE_DISABLED = "microphone-disabled"
    private const val ERROR_MICROPHONE_UNAVAILABLE = "microphone-unavailable"
    private const val ERROR_SERVICE_UNAVAILABLE = "service-unavailable"
    private const val ERROR_SERVICE_INCOMPATIBLE = "service-incompatible"
    private const val ERROR_MODEL_MISSING = "model-missing"
    private const val ERROR_MODEL_DOWNLOAD_FAILED = "model-download-failed"
    private const val ERROR_NO_SPEECH = "no-speech"
    private const val ERROR_RESULT_TOO_LONG = "result-too-long"
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
