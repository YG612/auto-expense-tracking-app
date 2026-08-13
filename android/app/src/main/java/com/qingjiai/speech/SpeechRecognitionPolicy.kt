package com.qingjiai.speech

import android.speech.SpeechRecognizer

internal enum class SpeechEngine(
  val wireValue: String,
  val providerWireValue: String,
  val routeWireValue: String,
  val mayUseNetwork: Boolean,
  val requiresAppMicrophonePermission: Boolean,
  val captureOwnershipWireValue: String,
  val endpointOwnershipWireValue: String,
) {
  ON_DEVICE(
    "on-device",
    "android-on-device",
    "on-device",
    false,
    true,
    "system-provider",
    "system-provider",
  ),
  SYSTEM_ACTIVITY(
    "system-activity",
    "android-system-activity",
    "system-activity",
    true,
    false,
    "external-provider",
    "external-provider",
  ),
  DIRECT_SYSTEM(
    "direct-system",
    "android-direct-system",
    "direct-system",
    true,
    true,
    "system-provider",
    "system-provider",
  ),
}

internal enum class SpeechEndReason(val wireValue: String) {
  USER_STOP("user-stop"),
  PROVIDER_ENDPOINT("provider-endpoint"),
  EXTERNAL_ACTIVITY("external-activity"),
  CANCELLED("cancelled"),
}

internal enum class SpeechModelState(val wireValue: String) {
  READY("READY"),
  DOWNLOADABLE("DOWNLOADABLE"),
  DOWNLOADING("DOWNLOADING"),
  UNSUPPORTED("UNSUPPORTED"),
  UNKNOWN("UNKNOWN"),
}

internal data class SpeechEngineCapabilities(
  val onDeviceAvailable: Boolean,
  val onDeviceModelState: SpeechModelState,
  val systemActivityAvailable: Boolean,
  val directSystemAvailable: Boolean,
) {
  val anyAvailable: Boolean
    get() = onDeviceAvailable || systemActivityAvailable || directSystemAvailable
}

internal enum class SpeechFailureCode(val wireValue: String) {
  PERMISSION_DENIED("permission-denied"),
  MICROPHONE_DISABLED("microphone-disabled"),
  MICROPHONE_UNAVAILABLE("microphone-unavailable"),
  SERVICE_UNAVAILABLE("service-unavailable"),
  SERVICE_INCOMPATIBLE("service-incompatible"),
  MODEL_MISSING("model-missing"),
  MODEL_STATUS_UNKNOWN("model-status-unknown"),
  MODEL_DOWNLOAD_FAILED("model-download-failed"),
  LANGUAGE_NOT_SUPPORTED("language-not-supported"),
  NO_SPEECH("no-speech"),
  NETWORK("network"),
  AUDIO("audio"),
  BUSY("busy"),
  UNKNOWN("unknown"),
}

internal enum class MicrophoneAccessState {
  AVAILABLE,
  PERMISSION_MISSING,
  PRIVACY_BLOCKED,
  HARDWARE_UNAVAILABLE,
}

internal enum class SpeechSessionProgress {
  STARTING,
  LISTENING,
  PROCESSING,
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
  /**
   * Android 12 and 12L expose the on-device service but cannot report per-locale model support.
   * UNKNOWN is therefore probeable, not equivalent to READY and not equivalent to unavailable.
   */
  fun canAttemptOnDevice(
    serviceAvailable: Boolean,
    modelState: SpeechModelState,
  ): Boolean =
    serviceAvailable &&
      (modelState == SpeechModelState.READY || modelState == SpeechModelState.UNKNOWN)

  fun resolveMicrophoneAccess(
    permissionGranted: Boolean,
    microphoneHardwareAvailable: Boolean,
    microphonePrivacyEnabled: Boolean,
  ): MicrophoneAccessState =
    when {
      !microphoneHardwareAvailable -> MicrophoneAccessState.HARDWARE_UNAVAILABLE
      microphonePrivacyEnabled -> MicrophoneAccessState.PRIVACY_BLOCKED
      !permissionGranted -> MicrophoneAccessState.PERMISSION_MISSING
      else -> MicrophoneAccessState.AVAILABLE
    }

  fun canAdvanceSession(
    current: SpeechSessionProgress,
    next: SpeechSessionProgress,
  ): Boolean = next.ordinal >= current.ordinal

  /**
   * Resolves model support for one requested locale without equating the
   * presence of an on-device recognition service with an installed model.
   */
  fun resolveModelState(
    requestedLocale: String,
    installedLanguages: List<String>,
    supportedLanguages: List<String>,
    pendingLanguages: List<String>,
  ): SpeechModelState =
    when {
      installedLanguages.any { localeMatches(requestedLocale, it) } ->
        SpeechModelState.READY
      pendingLanguages.any { localeMatches(requestedLocale, it) } ->
        SpeechModelState.DOWNLOADING
      supportedLanguages.any { localeMatches(requestedLocale, it) } ->
        SpeechModelState.DOWNLOADABLE
      else -> SpeechModelState.UNSUPPORTED
    }

  fun shouldUseUnobservedModelDownload(androidErrorCode: Int): Boolean =
    androidErrorCode == SpeechRecognizer.ERROR_CANNOT_LISTEN_TO_DOWNLOAD_EVENTS

  fun selectEngine(
    preferOnDevice: Boolean,
    allowSystemRecognition: Boolean,
    capabilities: SpeechEngineCapabilities,
    directSystemHasMicrophoneAccess: Boolean = true,
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
      capabilities.directSystemAvailable && directSystemHasMicrophoneAccess ->
        SpeechStartDecision.Start(SpeechEngine.DIRECT_SYSTEM)
      capabilities.systemActivityAvailable ->
        SpeechStartDecision.Start(SpeechEngine.SYSTEM_ACTIVITY)
      capabilities.directSystemAvailable ->
        // Preserve the precise permission failure when no Activity can own
        // capture; startOnMain will reject this route before opening audio.
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
    microphoneAccess: MicrophoneAccessState,
    engine: SpeechEngine,
    systemRecognitionAuthorized: Boolean,
    systemActivityAvailable: Boolean,
  ): SpeechErrorDecision {
    if (microphoneAccess == MicrophoneAccessState.PRIVACY_BLOCKED) {
      return SpeechErrorDecision.Fail(
        SpeechFailure(
          SpeechFailureCode.MICROPHONE_DISABLED,
          "Microphone access is disabled by the Android privacy control.",
          retryable = false,
        ),
      )
    }
    if (microphoneAccess == MicrophoneAccessState.HARDWARE_UNAVAILABLE) {
      return SpeechErrorDecision.Fail(
        SpeechFailure(
          SpeechFailureCode.MICROPHONE_UNAVAILABLE,
          "This device does not expose usable microphone hardware.",
          retryable = false,
        ),
      )
    }
    if (androidErrorCode == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
      if (microphoneAccess == MicrophoneAccessState.PERMISSION_MISSING) {
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

    if (
      engine != SpeechEngine.SYSTEM_ACTIVITY &&
      systemRecognitionAuthorized &&
      systemActivityAvailable &&
      androidErrorCode in
        setOf(
          SpeechRecognizer.ERROR_CLIENT,
          SpeechRecognizer.ERROR_SERVER_DISCONNECTED,
          SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED,
          SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE,
        )
    ) {
      return SpeechErrorDecision.UseSystemActivity
    }

    if (
      engine != SpeechEngine.SYSTEM_ACTIVITY &&
      !systemRecognitionAuthorized &&
      systemActivityAvailable &&
      androidErrorCode in
        setOf(
          SpeechRecognizer.ERROR_CLIENT,
          SpeechRecognizer.ERROR_SERVER_DISCONNECTED,
        )
    ) {
      return SpeechErrorDecision.Fail(
        SpeechFailure(
          SpeechFailureCode.SERVICE_INCOMPATIBLE,
          "Direct speech recognition failed; system speech input is available with explicit consent.",
          retryable = false,
        ),
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

  private fun localeMatches(
    requestedLocale: String,
    candidateLocale: String,
  ): Boolean {
    val requested = normalizeLocale(requestedLocale)
    val candidate = normalizeLocale(candidateLocale)
    if (requested == candidate) {
      return true
    }

    val requestedParts = requested.split('-')
    val candidateParts = candidate.split('-')
    val requestedLanguage = requestedParts.firstOrNull().orEmpty()
    val candidateLanguage = candidateParts.firstOrNull().orEmpty()
    val sameChineseFamily =
      requestedLanguage in setOf("zh", "cmn") &&
        candidateLanguage in setOf("zh", "cmn")
    if (requestedLanguage != candidateLanguage && !sameChineseFamily) {
      return false
    }

    val requestedScript = requestedParts.drop(1).firstOrNull { it.length == 4 }
    val candidateScript = candidateParts.drop(1).firstOrNull { it.length == 4 }
    if (
      requestedScript != null &&
      candidateScript != null &&
      requestedScript != candidateScript
    ) {
      return false
    }
    val requestedRegion =
      requestedParts.drop(1).firstOrNull {
        it.length == 2 || (it.length == 3 && it.all(Char::isDigit))
      }
    val candidateRegion =
      candidateParts.drop(1).firstOrNull {
        it.length == 2 || (it.length == 3 && it.all(Char::isDigit))
      }
    if (
      requestedRegion != null &&
      candidateRegion != null &&
      requestedRegion != candidateRegion
    ) {
      return false
    }
    // A generic language/script model can serve a matching regional request.
    return true
  }

  private fun normalizeLocale(locale: String) =
    locale.trim().replace('_', '-').lowercase()
}
