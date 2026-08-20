package com.qingjiai

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.qingjiai.agent.AgentCommandInboxPackage
import com.qingjiai.backup.LedgerBackupCryptoPackage
import com.qingjiai.classification.OnDeviceBillClassifierPackage
import com.qingjiai.files.LedgerFilePortalPackage
import com.qingjiai.notifications.PaymentNotificationCapturePackage
import com.qingjiai.ocr.ImageTextRecognitionPackage
import com.qingjiai.privacy.PrivacyProtectionPackage
import com.qingjiai.speech.SpeechRecognitionPackage
import com.qingjiai.speech.embedded.EmbeddedSpeechRecognitionPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(SpeechRecognitionPackage())
          add(EmbeddedSpeechRecognitionPackage())
          add(PaymentNotificationCapturePackage())
          add(ImageTextRecognitionPackage())
          add(OnDeviceBillClassifierPackage())
          add(AgentCommandInboxPackage())
          add(LedgerBackupCryptoPackage())
          add(LedgerFilePortalPackage())
          add(PrivacyProtectionPackage())
        },
      // Only the dedicated .debug identity may use Metro. The debuggable
      // .internal identity must remain offline and load its bundled JS.
      useDevSupport = BuildConfig.APPLICATION_ID.endsWith(".debug"),
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
