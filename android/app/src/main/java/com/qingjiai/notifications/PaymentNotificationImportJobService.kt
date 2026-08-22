package com.qingjiai.notifications

import android.app.job.JobParameters
import android.app.job.JobService
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

/**
 * Runs the existing local import task from JobScheduler instead of starting a background Service.
 * Android may defer the job, but the native outbox remains durable and a non-empty outbox requests
 * another attempt after the JS task finishes or the system stops this job.
 */
class PaymentNotificationImportJobService : JobService(), HeadlessJsTaskEventListener {
  private val store by lazy { PaymentNotificationStore(this) }
  private var parameters: JobParameters? = null
  private var activeTaskId: Int? = null
  private var taskContext: HeadlessJsTaskContext? = null
  private var reactHost: ReactHost? = null
  private var reactListener: ReactInstanceEventListener? = null

  override fun onStartJob(params: JobParameters): Boolean {
    if (!store.isEnabled() || store.queuedCount() == 0) return false
    parameters = params
    return try {
      val host = checkNotNull((application as ReactApplication).reactHost) {
        "ReactHost is unavailable."
      }
      reactHost = host
      val context = host.currentReactContext
      if (context != null) {
        startImportTask(context)
      } else {
        val listener = object : ReactInstanceEventListener {
          override fun onReactContextInitialized(context: ReactContext) {
            host.removeReactInstanceEventListener(this)
            if (reactListener === this) reactListener = null
            if (parameters != null) startImportTask(context)
          }
        }
        reactListener = listener
        host.addReactInstanceEventListener(listener)
        host.start()
      }
      true
    } catch (_: Exception) {
      finishJob(shouldRetry())
      true
    }
  }

  private fun startImportTask(context: ReactContext) {
    if (parameters == null || activeTaskId != null) return
    val currentTaskContext = HeadlessJsTaskContext.getInstance(context)
    taskContext = currentTaskContext
    currentTaskContext.addTaskEventListener(this)
    activeTaskId = currentTaskContext.startTask(
      HeadlessJsTaskConfig(
        TASK_NAME,
        Arguments.createMap(),
        TASK_TIMEOUT_MILLIS,
        true,
      ),
    )
  }

  override fun onHeadlessJsTaskStart(taskId: Int) = Unit

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    if (taskId != activeTaskId) return
    finishJob(shouldRetry())
  }

  override fun onStopJob(params: JobParameters): Boolean {
    val retry = shouldRetry()
    clearJobState(finishTask = true)
    return retry
  }

  override fun onDestroy() {
    clearJobState(finishTask = true)
    super.onDestroy()
  }

  private fun shouldRetry(): Boolean =
    runCatching { store.isEnabled() && store.queuedCount() > 0 }.getOrDefault(true)

  private fun finishJob(retry: Boolean) {
    val currentParameters = parameters ?: return
    clearJobState(finishTask = false)
    jobFinished(currentParameters, retry)
  }

  private fun clearJobState(finishTask: Boolean) {
    parameters = null
    reactListener?.let { listener ->
      reactHost?.removeReactInstanceEventListener(listener)
    }
    reactListener = null
    reactHost = null
    val currentContext = taskContext
    val currentTaskId = activeTaskId
    taskContext = null
    activeTaskId = null
    currentContext?.removeTaskEventListener(this)
    if (finishTask && currentTaskId != null) {
      currentContext?.finishTask(currentTaskId)
    }
  }

  companion object {
    const val TASK_NAME = "PaymentNotificationAutoImport"
    private const val TASK_TIMEOUT_MILLIS = 60_000L
  }
}
