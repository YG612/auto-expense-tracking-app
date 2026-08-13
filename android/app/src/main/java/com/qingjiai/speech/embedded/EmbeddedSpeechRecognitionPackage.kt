package com.qingjiai.speech.embedded

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class EmbeddedSpeechRecognitionPackage : BaseReactPackage() {
  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext,
  ): NativeModule? =
    if (name == EmbeddedSpeechRecognitionModule.NAME) {
      EmbeddedSpeechRecognitionModule(reactContext)
    } else {
      null
    }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      EmbeddedSpeechRecognitionModule.NAME to
        ReactModuleInfo(
          name = EmbeddedSpeechRecognitionModule.NAME,
          className = EmbeddedSpeechRecognitionModule::class.java.name,
          canOverrideExistingModule = false,
          needsEagerInit = false,
          isCxxModule = false,
          isTurboModule = false,
        ),
    )
  }
}
