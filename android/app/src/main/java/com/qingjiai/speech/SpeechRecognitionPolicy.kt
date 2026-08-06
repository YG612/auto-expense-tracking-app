package com.qingjiai.speech

import android.speech.SpeechRecognizer

internal enum class SpeechEngine(
  val wireValue: String,
  val mayUseNetwork: Boolean,
) {
  ON_DEVICE("on-device", false),
  SYSTEM_ACTIVITY("system-activity", true),
  DIRECT_SYSTEM("direct-system", true),
}

internal data class SpeechEngineCapabilities(
  val onDeviceAvailable: Boolean,
  val systemActivityAvailable: Boolean,
  val directSystemAvailable: Boolean,
) {
  val anyAvailable: Boolean
    get() = onDeviceAvailable || systemActivityAvailable || directSystemAvailable
}

internal enum class SpeechFailureCode(val wireValue: String) {
  PERMISSION_DENIED("permission-denied"),
  SERVICE_UNAVAILABLE("service-unavailable"),
  SERVICE_INCOMPATIBLE("service-incompatible"),
  MODEL_MISSING("model-missing"),
  LANGUAGE_NOT_SUPPORTED("language-not-supported"),
  NO_SPEECH("no-speech"),
  NETWORK("network"),
  AUDIO("audio"),
  BUSY("busy"),
  UNKNOWN("unknown"),
}

internal data class SpeechFailure(
  val code: SpeechFailureCode,
  val message: String,
  val retryable: Boolean,
)

internal sealed interface SpeechStartDecision {
  data class Start(val engine: SpeechEngine) : SpeechStartDecision

  data class Reject(val failure: SpeechFailure) : SpeechStartDecision
}

internal sealed interface SpeechErrorDecision {
  data object UseSystemActivity : SpeechErrorDecision

  data class Fail(val failure: SpeechFailure) : SpeechErrorDecision
}

/**
 * Pure selection and error policy for Android speech recognition.
 *
 * Runtime microphone permission, local-model availability, OEM service compatibility and
 * explicit permission to use a system recognizer are intentionally represented separately.
 */
internal object SpeechRecognitionPolicy {
  fun selectEngine(
    preferOnDevice: Boolean,
    allowSystemRecognition: Boolean,
    capabilities: SpeechEngineCapabilities,
  ): SpeechStartDecision {
    if (preferOnDevice && capabilities.onDeviceAvailable) {
      return SpeechStartDecision.Start(SpeechEngine.ON_DEVICE)
    }

    if (!allowSystemRecognition) {
      return SpeechStartDecision.Reject(
        if (preferOnDevice) {
          SpeechFailure(
            SpeechFailureCode.MODEL_MISSING,
            "On-device speech recognition is unavailable. System recognition was not authorized.",
            retryable = false,
          )
        } else {
          SpeechFailure(
            SpeechFailureCode.SERVICE_UNAVAILABLE,
            "System speech recognition requires an explicit user action.",
            retryable = false,
          )
        },
      )
    }

    return when {
      capabilities.systemActivityAvailable ->
        SpeechStartDecision.Start(SpeechEngine.SYSTEM_ACTIVITY)
      capabilities.directSystemAvailable ->
        SpeechStartDecision.Start(SpeechEngine.DIRECT_SYSTEM)
      else ->
        SpeechStartDecision.Reject(
          SpeechFailure(
            SpeechFailureCode.SERVICE_UNAVAILABLE,
            "No compatible system speech recognition service is installed or enabled.",
            retryable = false,
          ),
        )
    }
  }

  fun resolveAndroidError(
    androidErrorCode: Int,
    microphonePermissionGranted: Boolean,
    engine: SpeechEngine,
    systemRecognitionAuthorized: Boolean,
    systemActivityAvailable: Boolean,
  ): SpeechErrorDecision {
    if (androidErrorCode == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
      if (!microphonePermissionGranted) {
        return SpeechErrorDecision.Fail(
          SpeechFailure(
            SpeechFailureCode.PERMISSION_DENIED,
            "Microphone permission was denied.",
            retryable = true,
          ),
        )
      }
      if (systemRecognitionAuthorized && systemActivityAvailable) {
        return SpeechErrorDecision.UseSystemActivity
      }
      return SpeechErrorDecision.Fail(
        if (systemRecognitionAuthorized) {
          SpeechFailure(
            SpeechFailureCode.SERVICE_UNAVAILABLE,
            "The device rejected direct speech access and has no compatible system input Activity.",
            retryable = false,
          )
        } else {
          SpeechFailure(
            SpeechFailureCode.SERVICE_INCOMPATIBLE,
            "Microphone permission is granted, but this device blocks direct speech service access.",
            retryable = false,
          )
        },
      )
    }

    val failure =
      when (androidErrorCode) {
        SpeechRecognizer.ERROR_AUDIO ->
          SpeechFailure(
            SpeechFailureCode.AUDIO,
            "The microphone audio stream failed.",
            retryable = true,
          )
        SpeechRecognizer.ERROR_NETWORK,
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
        SpeechRecognizer.ERROR_SERVER,
        SpeechRecognizer.ERROR_SERVER_DISCONNECTED,
        ->
          SpeechFailure(
            SpeechFailureCode.NETWORK,
            "The speech recognition service could not connect.",
            retryable = true,
          )
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
        SpeechRecognizer.ERROR_TOO_MANY_REQUESTS,
        ->
          SpeechFailure(
            SpeechFailureCode.BUSY,
            "The speech recognition service is busy.",
            retryable = true,
          )
        SpeechRecognizer.ERROR_NO_MATCH,
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
        ->
          SpeechFailure(
            SpeechFailureCode.NO_SPEECH,
            "No recognizable speech was detected.",
            retryable = true,
          )
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ->
          SpeechFailure(
            SpeechFailureCode.LANGUAGE_NOT_SUPPORTED,
            "The requested language is not supported.",
            retryable = false,
          )
        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
          if (engine == SpeechEngine.ON_DEVICE) {
            SpeechFailure(
              SpeechFailureCode.MODEL_MISSING,
              "The on-device language model is not installed or available.",
              retryable = false,
            )
          } else {
            SpeechFailure(
              SpeechFailureCode.LANGUAGE_NOT_SUPPORTED,
              "The system speech service has no available model for the requested language.",
              retryable = false,
            )
          }
        else ->
          SpeechFailure(
            SpeechFailureCode.UNKNOWN,
            "Speech recognition failed (Android $androidErrorCode).",
            retryable = true,
          )
      }
    return SpeechErrorDecision.Fail(failure)
  }
}
