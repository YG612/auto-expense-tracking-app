package com.qingjiai.speech.embedded

/** Thread-safe owner for process-resident model state. Session streams are not stored here. */
class ResidentRecognizerStore<T>(
  private val release: (T) -> Unit,
) {
  private var value: T? = null

  @Synchronized
  fun obtain(create: () -> T): T {
    value?.let { return it }
    return create().also { value = it }
  }

  @Synchronized
  fun releaseIdle() {
    value?.let(release)
    value = null
  }

  @Synchronized
  fun isResident(): Boolean = value != null
}
