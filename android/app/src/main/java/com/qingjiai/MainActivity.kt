package com.qingjiai

import android.os.Bundle
import android.content.Intent
import android.net.Uri

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
    intent = normalizedInboundIntent(intent)
    super.onCreate(savedInstanceState)
  }

  override fun onNewIntent(intent: Intent) {
    val normalized = normalizedInboundIntent(intent)
    super.onNewIntent(normalized)
    setIntent(normalized)
  }

  private fun normalizedInboundIntent(inbound: Intent): Intent {
    if (inbound.action == Intent.ACTION_SEND && inbound.type?.startsWith("image/") == true) {
      val imageUri = inbound.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      if (imageUri != null && imageUri.scheme == "content") {
        return Intent(inbound).apply {
          action = Intent.ACTION_VIEW
          data = Uri.Builder()
            .scheme("qingjiai")
            .authority("entry")
            .appendPath("smart")
            .appendQueryParameter("imageUri", imageUri.toString().take(2_048))
            .build()
        }
      }
    }
    if (inbound.action != Intent.ACTION_SEND || inbound.type != "text/plain") {
      return inbound
    }
    val sharedText = inbound.getStringExtra(Intent.EXTRA_TEXT)?.trim()
    if (sharedText.isNullOrEmpty()) return inbound
    return Intent(inbound).apply {
      action = Intent.ACTION_VIEW
      data = Uri.Builder()
        .scheme("qingjiai")
        .authority("entry")
        .appendPath("smart")
        .appendQueryParameter("text", sharedText.take(2_000))
        .build()
      removeExtra(Intent.EXTRA_TEXT)
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "QingJiAI"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
