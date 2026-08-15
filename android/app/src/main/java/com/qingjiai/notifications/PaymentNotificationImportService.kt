package com.qingjiai.notifications

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class PaymentNotificationImportService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      TASK_NAME,
      Arguments.createMap(),
      60_000,
      true,
    )

  companion object {
    const val TASK_NAME = "PaymentNotificationAutoImport"
  }
}
