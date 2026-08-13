package com.qingjiai.speech.embedded

import android.content.Context

/**
 * Small boundary around the pinned sherpa-ncnn runtime.
 *
 * It lives in the model-free source set so lifecycle logic can be unit tested
 * without loading JNI. The concrete adapter exists only in `streamingAsr`.
 */
interface StreamingRecognizerAdapter : AutoCloseable {
  fun acceptSamples(samples: FloatArray)

  fun isReady(): Boolean

  fun decode()

  fun inputFinished()

  fun text(): String

  override fun close()
}

interface StreamingRecognizerAdapterFactory {
  fun create(context: Context): StreamingRecognizerAdapter
}
