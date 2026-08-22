package com.qingjiai.notifications

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context

internal object PaymentNotificationImportScheduler {
  private const val JOB_ID = 0x514A_504E
  private const val INITIAL_BACKOFF_MILLIS = 30_000L

  fun schedule(context: Context): Boolean {
    val applicationContext = context.applicationContext
    val scheduler = applicationContext.getSystemService(JobScheduler::class.java)
      ?: return false
    val job = JobInfo.Builder(
      JOB_ID,
      ComponentName(applicationContext, PaymentNotificationImportJobService::class.java),
    )
      .setMinimumLatency(0L)
      .setOverrideDeadline(15_000L)
      .setBackoffCriteria(
        INITIAL_BACKOFF_MILLIS,
        JobInfo.BACKOFF_POLICY_EXPONENTIAL,
      )
      .build()
    return scheduler.schedule(job) == JobScheduler.RESULT_SUCCESS
  }

  fun cancel(context: Context) {
    context.applicationContext
      .getSystemService(JobScheduler::class.java)
      ?.cancel(JOB_ID)
  }
}
