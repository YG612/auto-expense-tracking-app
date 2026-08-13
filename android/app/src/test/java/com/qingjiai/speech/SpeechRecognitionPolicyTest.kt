package com.qingjiai.speech

import android.speech.SpeechRecognizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechRecognitionPolicyTest {
  @Test
  fun `local recognition remains the default without system consent`() {
    val decision =
      SpeechRecognitionPolicy.selectEngine(
        preferOnDevice = true,
        allowSystemRecognition = false,
        capabilities = capabilities(onDevice = true, activity = true, direct = true),
      )

    assertEquals(
      SpeechEngine.ON_DEVICE,
      (decision as SpeechStartDecision.Start).engine,
    )
  }

  @Test
  fun `missing local model never silently enables the system recognizer`() {
    val decision =
      SpeechRecognitionPolicy.selectEngine(
        preferOnDevice = true,
        allowSystemRecognition = false,
        capabilities = capabilities(onDevice = false, activity = true, direct = true),
      )

    assertEquals(
      SpeechFailureCode.MODEL_MISSING,
      (decision as SpeechStartDecision.Reject).failure.code,
    )
  }

  @Test
  fun `explicit system action prefers controllable direct capture when healthy`() {
    val decision =
      SpeechRecognitionPolicy.selectEngine(
        preferOnDevice = false,
        allowSystemRecognition = true,
        capabilities = capabilities(onDevice = false, activity = true, direct = true),
      )

    assertEquals(
      SpeechEngine.DIRECT_SYSTEM,
      (decision as SpeechStartDecision.Start).engine,
    )
  }

  @Test
  fun `system Activity owns capture when direct route lacks microphone access`() {
    val decision =
      SpeechRecognitionPolicy.selectEngine(
        preferOnDevice = false,
        allowSystemRecognition = true,
        capabilities = capabilities(onDevice = false, activity = true, direct = true),
        directSystemHasMicrophoneAccess = false,
      )

    assertEquals(
      SpeechEngine.SYSTEM_ACTIVITY,
      (decision as SpeechStartDecision.Start).engine,
    )
  }

  @Test
  fun `direct service remains diagnosable when it is the only authorized route`() {
    val decision =
      SpeechRecognitionPolicy.selectEngine(
        preferOnDevice = false,
        allowSystemRecognition = true,
        capabilities = capabilities(onDevice = false, activity = false, direct = true),
        directSystemHasMicrophoneAccess = false,
      )

    assertEquals(
      SpeechEngine.DIRECT_SYSTEM,
      (decision as SpeechStartDecision.Start).engine,
    )
  }

  @Test
  fun `granted microphone plus Android error 9 is an OEM service issue`() {
    val decision =
      SpeechRecognitionPolicy.resolveAndroidError(
        androidErrorCode = SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS,
        microphoneAccess = MicrophoneAccessState.AVAILABLE,
        engine = SpeechEngine.ON_DEVICE,
        systemRecognitionAuthorized = false,
        systemActivityAvailable = true,
      )

    val failure = (decision as SpeechErrorDecision.Fail).failure
    assertEquals(SpeechFailureCode.SERVICE_INCOMPATIBLE, failure.code)
    assertTrue(!failure.retryable)
  }

  @Test
  fun `error 9 can move to OEM Activity only after explicit authorization`() {
    val decision =
      SpeechRecognitionPolicy.resolveAndroidError(
        androidErrorCode = SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS,
        microphoneAccess = MicrophoneAccessState.AVAILABLE,
        engine = SpeechEngine.DIRECT_SYSTEM,
        systemRecognitionAuthorized = true,
        systemActivityAvailable = true,
      )

    assertEquals(SpeechErrorDecision.UseSystemActivity, decision)
  }

  @Test
  fun `a genuinely missing microphone permission remains a permission error`() {
    val decision =
      SpeechRecognitionPolicy.resolveAndroidError(
        androidErrorCode = SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS,
        microphoneAccess = MicrophoneAccessState.PERMISSION_MISSING,
        engine = SpeechEngine.ON_DEVICE,
        systemRecognitionAuthorized = false,
        systemActivityAvailable = true,
      )

    assertEquals(
      SpeechFailureCode.PERMISSION_DENIED,
      (decision as SpeechErrorDecision.Fail).failure.code,
    )
  }

  @Test
  fun `unknown local model remains probeable when the Android service exists`() {
    assertTrue(
      SpeechRecognitionPolicy.canAttemptOnDevice(
        serviceAvailable = true,
        modelState = SpeechModelState.UNKNOWN,
      ),
    )
    assertTrue(
      SpeechRecognitionPolicy.canAttemptOnDevice(
        serviceAvailable = true,
        modelState = SpeechModelState.READY,
      ),
    )
    assertFalse(
      SpeechRecognitionPolicy.canAttemptOnDevice(
        serviceAvailable = true,
        modelState = SpeechModelState.DOWNLOADABLE,
      ),
    )
    assertFalse(
      SpeechRecognitionPolicy.canAttemptOnDevice(
        serviceAvailable = false,
        modelState = SpeechModelState.UNKNOWN,
      ),
    )
  }

  @Test
  fun `global microphone privacy is not misreported as runtime permission denial`() {
    val access =
      SpeechRecognitionPolicy.resolveMicrophoneAccess(
        permissionGranted = true,
        microphoneHardwareAvailable = true,
        microphonePrivacyEnabled = true,
      )
    val decision =
      SpeechRecognitionPolicy.resolveAndroidError(
        androidErrorCode = SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS,
        microphoneAccess = access,
        engine = SpeechEngine.ON_DEVICE,
        systemRecognitionAuthorized = false,
        systemActivityAvailable = true,
      )

    assertEquals(MicrophoneAccessState.PRIVACY_BLOCKED, access)
    assertEquals(
      SpeechFailureCode.MICROPHONE_DISABLED,
      (decision as SpeechErrorDecision.Fail).failure.code,
    )
  }

  @Test
  fun `no microphone hardware is a non retryable audio failure`() {
    val decision =
      SpeechRecognitionPolicy.resolveAndroidError(
        androidErrorCode = SpeechRecognizer.ERROR_AUDIO,
        microphoneAccess = MicrophoneAccessState.HARDWARE_UNAVAILABLE,
        engine = SpeechEngine.ON_DEVICE,
        systemRecognitionAuthorized = false,
        systemActivityAvailable = false,
      )

    val failure = (decision as SpeechErrorDecision.Fail).failure
    assertEquals(SpeechFailureCode.MICROPHONE_UNAVAILABLE, failure.code)
    assertFalse(failure.retryable)
  }

  @Test
  fun `authorized route failures use the system Activity but no speech does not`() {
    listOf(
      SpeechRecognizer.ERROR_CLIENT,
      SpeechRecognizer.ERROR_SERVER_DISCONNECTED,
      SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED,
      SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE,
    ).forEach { code ->
      assertEquals(
        SpeechErrorDecision.UseSystemActivity,
        SpeechRecognitionPolicy.resolveAndroidError(
          androidErrorCode = code,
          microphoneAccess = MicrophoneAccessState.AVAILABLE,
          engine = SpeechEngine.ON_DEVICE,
          systemRecognitionAuthorized = true,
          systemActivityAvailable = true,
        ),
      )
    }
    val noSpeech =
      SpeechRecognitionPolicy.resolveAndroidError(
        androidErrorCode = SpeechRecognizer.ERROR_NO_MATCH,
        microphoneAccess = MicrophoneAccessState.AVAILABLE,
        engine = SpeechEngine.ON_DEVICE,
        systemRecognitionAuthorized = true,
        systemActivityAvailable = true,
      )
    assertEquals(
      SpeechFailureCode.NO_SPEECH,
      (noSpeech as SpeechErrorDecision.Fail).failure.code,
    )
  }

  @Test
  fun `unauthorized direct provider failure exposes but never starts system input`() {
    listOf(
      SpeechRecognizer.ERROR_CLIENT,
      SpeechRecognizer.ERROR_SERVER_DISCONNECTED,
    ).forEach { code ->
      val decision =
        SpeechRecognitionPolicy.resolveAndroidError(
          androidErrorCode = code,
          microphoneAccess = MicrophoneAccessState.AVAILABLE,
          engine = SpeechEngine.ON_DEVICE,
          systemRecognitionAuthorized = false,
          systemActivityAvailable = true,
        )

      assertEquals(
        SpeechFailureCode.SERVICE_INCOMPATIBLE,
        (decision as SpeechErrorDecision.Fail).failure.code,
      )
    }
  }

  @Test
  fun `session progress cannot move back from processing to listening`() {
    assertTrue(
      SpeechRecognitionPolicy.canAdvanceSession(
        SpeechSessionProgress.STARTING,
        SpeechSessionProgress.LISTENING,
      ),
    )
    assertTrue(
      SpeechRecognitionPolicy.canAdvanceSession(
        SpeechSessionProgress.LISTENING,
        SpeechSessionProgress.PROCESSING,
      ),
    )
    assertFalse(
      SpeechRecognitionPolicy.canAdvanceSession(
        SpeechSessionProgress.PROCESSING,
        SpeechSessionProgress.LISTENING,
      ),
    )
  }

  @Test
  fun `installed locale is ready while a downloadable locale is not ready`() {
    assertEquals(
      SpeechModelState.READY,
      SpeechRecognitionPolicy.resolveModelState(
        requestedLocale = "zh-CN",
        installedLanguages = listOf("en-US", "zh-CN"),
        supportedLanguages = emptyList(),
        pendingLanguages = emptyList(),
      ),
    )
    assertEquals(
      SpeechModelState.DOWNLOADABLE,
      SpeechRecognitionPolicy.resolveModelState(
        requestedLocale = "zh-CN",
        installedLanguages = emptyList(),
        supportedLanguages = listOf("zh-CN"),
        pendingLanguages = emptyList(),
      ),
    )
  }

  @Test
  fun `pending model takes precedence over downloadable support`() {
    assertEquals(
      SpeechModelState.DOWNLOADING,
      SpeechRecognitionPolicy.resolveModelState(
        requestedLocale = "zh-CN",
        installedLanguages = emptyList(),
        supportedLanguages = listOf("zh-CN"),
        pendingLanguages = listOf("zh-CN"),
      ),
    )
  }

  @Test
  fun `different explicit Chinese region is not reported as zh CN`() {
    assertEquals(
      SpeechModelState.UNSUPPORTED,
      SpeechRecognitionPolicy.resolveModelState(
        requestedLocale = "zh-CN",
        installedLanguages = listOf("zh-TW"),
        supportedLanguages = listOf("yue-HK"),
        pendingLanguages = emptyList(),
      ),
    )
  }

  @Test
  fun `Mandarin and zh script tags match the same mainland model`() {
    assertEquals(
      SpeechModelState.READY,
      SpeechRecognitionPolicy.resolveModelState(
        requestedLocale = "zh-Hans-CN",
        installedLanguages = listOf("cmn-Hans-CN"),
        supportedLanguages = emptyList(),
        pendingLanguages = emptyList(),
      ),
    )
  }

  @Test
  fun `download listener error 15 uses the unobserved Android fallback`() {
    assertTrue(
      SpeechRecognitionPolicy.shouldUseUnobservedModelDownload(
        SpeechRecognizer.ERROR_CANNOT_LISTEN_TO_DOWNLOAD_EVENTS,
      ),
    )
    assertFalse(
      SpeechRecognitionPolicy.shouldUseUnobservedModelDownload(
        SpeechRecognizer.ERROR_NETWORK,
      ),
    )
  }

  @Test
  fun `system Activity owns microphone permission while direct providers do not`() {
    assertFalse(SpeechEngine.SYSTEM_ACTIVITY.requiresAppMicrophonePermission)
    assertTrue(SpeechEngine.ON_DEVICE.requiresAppMicrophonePermission)
    assertTrue(SpeechEngine.DIRECT_SYSTEM.requiresAppMicrophonePermission)
  }

  private fun capabilities(
    onDevice: Boolean,
    activity: Boolean,
    direct: Boolean,
  ) =
    SpeechEngineCapabilities(
      onDeviceAvailable = onDevice,
      onDeviceModelState =
        if (onDevice) SpeechModelState.READY else SpeechModelState.UNKNOWN,
      systemActivityAvailable = activity,
      directSystemAvailable = direct,
    )
}
