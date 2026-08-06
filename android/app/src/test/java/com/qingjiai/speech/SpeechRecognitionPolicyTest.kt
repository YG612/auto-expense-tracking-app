package com.qingjiai.speech

import android.speech.SpeechRecognizer
import org.junit.Assert.assertEquals
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
  fun `explicit system action prefers the OEM Activity over direct binder access`() {
    val decision =
      SpeechRecognitionPolicy.selectEngine(
        preferOnDevice = false,
        allowSystemRecognition = true,
        capabilities = capabilities(onDevice = false, activity = true, direct = true),
      )

    assertEquals(
      SpeechEngine.SYSTEM_ACTIVITY,
      (decision as SpeechStartDecision.Start).engine,
    )
  }

  @Test
  fun `direct service is only a last resort when no system Activity exists`() {
    val decision =
      SpeechRecognitionPolicy.selectEngine(
        preferOnDevice = false,
        allowSystemRecognition = true,
        capabilities = capabilities(onDevice = false, activity = false, direct = true),
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
        microphonePermissionGranted = true,
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
        microphonePermissionGranted = true,
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
        microphonePermissionGranted = false,
        engine = SpeechEngine.ON_DEVICE,
        systemRecognitionAuthorized = false,
        systemActivityAvailable = true,
      )

    assertEquals(
      SpeechFailureCode.PERMISSION_DENIED,
      (decision as SpeechErrorDecision.Fail).failure.code,
    )
  }

  private fun capabilities(
    onDevice: Boolean,
    activity: Boolean,
    direct: Boolean,
  ) =
    SpeechEngineCapabilities(
      onDeviceAvailable = onDevice,
      systemActivityAvailable = activity,
      directSystemAvailable = direct,
    )
}
