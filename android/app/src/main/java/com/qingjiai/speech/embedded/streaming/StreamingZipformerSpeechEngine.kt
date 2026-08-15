package com.qingjiai.speech.embedded.streaming

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Process
import android.os.SystemClock
import com.qingjiai.speech.embedded.EmbeddedSpeechAvailability
import com.qingjiai.speech.embedded.EmbeddedSpeechEngine
import com.qingjiai.speech.embedded.EmbeddedSpeechEngineCallback
import com.qingjiai.speech.embedded.PartialTranscriptGate
import com.qingjiai.speech.embedded.RecordingWallClockDeadline
import com.qingjiai.speech.embedded.StreamingRecognizerAdapter
import com.qingjiai.speech.embedded.StreamingRecognizerAdapterFactory
import com.qingjiai.speech.embedded.StreamingCaptureWatchdog
import com.qingjiai.speech.embedded.StreamingSessionControl
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * App-owned 16 kHz PCM16 capture feeding a local streaming Zipformer decoder.
 *
 * PCM stays in this native source set and is converted directly to transient
 * FloatArrays; no audio is emitted over React Native, persisted, or uploaded.
 */
internal class StreamingZipformerSpeechEngine(
  private val context: Context,
  private val recognizerFactory: StreamingRecognizerAdapterFactory,
) : EmbeddedSpeechEngine {
  private val activeSession = AtomicReference<Session?>(null)
  private val destroyed = AtomicBoolean(false)
  private val workerBusy = AtomicBoolean(false)
  private val worker =
    Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "qingji-streaming-asr")
    }
  private val watchdogWorker =
    Executors.newSingleThreadScheduledExecutor { runnable ->
      Thread(runnable, "qingji-streaming-asr-watchdog")
    }
  private val runtimeState = AtomicReference(RuntimeState.WARMING)
  private val runtimeDiagnostic = AtomicReference("embedded-streaming-zipformer-warming")

  init {
    // Loading the JNI runtime and model can take seconds. Probe it once on the
    // decoder worker so capability checks and React Native's main thread never
    // perform model I/O. The probe is immediately released; sessions own and
    // release their own recognizer.
    worker.execute { verifyRuntime() }
  }

  override fun availability(locale: String): EmbeddedSpeechAvailability {
    if (destroyed.get()) {
      return EmbeddedSpeechAvailability(false, "streaming-engine-destroyed")
    }
    if (!locale.replace('_', '-').lowercase().startsWith("zh")) {
      return EmbeddedSpeechAvailability(false, "streaming-locale-not-supported")
    }
    return when (runtimeState.get()) {
      RuntimeState.READY ->
        EmbeddedSpeechAvailability(true, runtimeDiagnostic.get())
      RuntimeState.WARMING ->
        EmbeddedSpeechAvailability(false, "embedded-streaming-zipformer-warming")
      RuntimeState.FAILED ->
        EmbeddedSpeechAvailability(false, runtimeDiagnostic.get())
    }
  }

  override fun start(
    sessionId: String,
    generation: Long,
    locale: String,
    callback: EmbeddedSpeechEngineCallback,
  ) {
    check(!destroyed.get()) { "Streaming speech engine has been destroyed." }
    check(hasRecordAudioPermission()) { "Microphone permission has not been granted." }
    check(availability(locale).ready) { "Streaming Zipformer assets are unavailable." }
    check(workerBusy.compareAndSet(false, true)) {
      "The previous streaming speech worker is still cleaning up."
    }
    val session = Session(sessionId, generation, callback)
    if (!activeSession.compareAndSet(null, session)) {
      workerBusy.set(false)
      error("A streaming speech session is already active.")
    }
    try {
      worker.execute { captureAndDecode(session) }
    } catch (error: RejectedExecutionException) {
      activeSession.compareAndSet(session, null)
      session.releaseResources()
      workerBusy.set(false)
      throw IllegalStateException("Streaming speech worker is unavailable.", error)
    }
  }

  override fun stop(sessionId: String): Boolean {
    val session = activeSession.get() ?: return false
    if (session.id != sessionId || !session.control.requestUserStop()) {
      return false
    }
    session.watchdog?.cancel()
    stopRecorder(session)
    return true
  }

  override fun cancel(sessionId: String): Boolean {
    val session = activeSession.get() ?: return false
    if (session.id != sessionId || !session.control.cancel()) {
      return false
    }
    activeSession.compareAndSet(session, null)
    session.watchdog?.cancel()
    stopRecorder(session)
    return true
  }

  override fun destroy() {
    if (!destroyed.compareAndSet(false, true)) return
    activeSession.get()?.let { cancel(it.id) }
    worker.shutdownNow()
    watchdogWorker.shutdownNow()
  }

  @SuppressLint("MissingPermission")
  private fun captureAndDecode(session: Session) {
    Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
    var recorder: AudioRecord? = null
    var flushStarted = false
    try {
      val recognizer = recognizerFactory.create(context)
      session.recognizer.set(recognizer)
      if (!session.control.shouldCapture()) {
        if (session.control.mayDecode()) {
          flushStarted = true
          finishAfterUserStop(session)
        }
        return
      }
      recorder = createAudioRecord()
      session.recorder = recorder
      if (!session.control.shouldCapture()) {
        if (session.control.mayDecode()) {
          flushStarted = true
          finishAfterUserStop(session)
        }
        return
      }
      val deadline =
        RecordingWallClockDeadline(
          startedAtNanos = SystemClock.elapsedRealtimeNanos(),
          maxDurationNanos = MAX_CAPTURE_DURATION_NANOS,
        )
      recorder.startRecording()
      check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
        "Android did not enter the recording state."
      }
      if (!session.control.shouldCapture()) {
        stopRecorder(session)
        if (session.control.mayDecode()) {
          flushStarted = true
          finishAfterUserStop(session)
        }
        return
      }
      if (session.control.markListening()) {
        session.callback.onListening(session.id, session.generation)
      }
      session.watchdog =
        StreamingCaptureWatchdog(
          scheduler = watchdogWorker,
          timeoutNanos = MAX_CAPTURE_DURATION_NANOS,
          onTimeout = { failRecordingTooLong(session) },
        ).also { it.arm() }

      val pcm = ShortArray(READ_BUFFER_SAMPLES)
      try {
        while (session.control.shouldCapture() && !Thread.currentThread().isInterrupted) {
          if (deadline.hasExpired(SystemClock.elapsedRealtimeNanos())) {
            if (!failRecordingTooLong(session) && session.control.mayDecode()) {
              flushStarted = true
              finishAfterUserStop(session)
            }
            return
          }
          val count = recorder.read(pcm, 0, pcm.size, AudioRecord.READ_NON_BLOCKING)
          if (deadline.hasExpired(SystemClock.elapsedRealtimeNanos())) {
            if (!failRecordingTooLong(session) && session.control.mayDecode()) {
              flushStarted = true
              finishAfterUserStop(session)
            }
            return
          }
          when {
            count > 0 -> acceptAndDecode(session, pcm, count)
            count == AudioRecord.ERROR_DEAD_OBJECT -> error("Microphone service disconnected.")
            count == AudioRecord.ERROR_INVALID_OPERATION -> error("Microphone is invalid.")
            count == AudioRecord.ERROR_BAD_VALUE -> error("PCM16 buffer was rejected.")
            count == AudioRecord.ERROR -> error("Microphone read failed.")
            count < 0 -> error("Unknown microphone read failure.")
            else -> SystemClock.sleep(EMPTY_READ_BACKOFF_MS)
          }
        }
      } finally {
        pcm.fill(0)
      }

      if (session.control.isTerminal() || !session.control.mayDecode()) return
      flushStarted = true
      finishAfterUserStop(session)
    } catch (_: SecurityException) {
      fail(session, ERROR_PERMISSION_DENIED, "Microphone permission is unavailable.", false)
    } catch (_: RuntimeException) {
      if (!session.control.isTerminal()) {
        if (!flushStarted && session.control.mayDecode() && session.recognizer.get() != null) {
          try {
            flushStarted = true
            finishAfterUserStop(session)
          } catch (_: RuntimeException) {
            fail(session, ERROR_AUDIO, "Unable to finalize microphone audio.", true)
          }
        } else {
          fail(session, ERROR_AUDIO, "Unable to read or decode microphone audio.", true)
        }
      }
    } catch (_: LinkageError) {
      fail(session, ERROR_MODEL_MISSING, "Streaming speech runtime failed to load.", false)
    } finally {
      session.recorder = null
      session.watchdog?.cancel()
      releaseRecorder(recorder)
      // The worker is the sole owner of the native recognizer. cancel(),
      // lifecycle callbacks and timeout paths only change state/stop capture;
      // close can therefore never race native decode.
      session.releaseResources()
      workerBusy.set(false)
    }
  }

  private fun verifyRuntime() {
    if (destroyed.get()) return
    val missing = REQUIRED_ASSETS.firstOrNull { asset -> !assetExists(asset) }
    if (missing != null) {
      runtimeDiagnostic.set("streaming-asset-missing:${missing.substringAfterLast('/')}")
      runtimeState.set(RuntimeState.FAILED)
      return
    }
    var recognizer: StreamingRecognizerAdapter? = null
    try {
      recognizer = recognizerFactory.create(context)
      runtimeDiagnostic.set("embedded-streaming-zipformer-ready")
      runtimeState.set(RuntimeState.READY)
    } catch (_: RuntimeException) {
      runtimeDiagnostic.set("embedded-streaming-runtime-failed")
      runtimeState.set(RuntimeState.FAILED)
    } catch (_: LinkageError) {
      runtimeDiagnostic.set("embedded-streaming-runtime-failed")
      runtimeState.set(RuntimeState.FAILED)
    } finally {
      try {
        recognizer?.close()
      } catch (_: RuntimeException) {
        runtimeDiagnostic.set("embedded-streaming-runtime-failed")
        runtimeState.set(RuntimeState.FAILED)
      } catch (_: LinkageError) {
        runtimeDiagnostic.set("embedded-streaming-runtime-failed")
        runtimeState.set(RuntimeState.FAILED)
      }
    }
  }

  private fun acceptAndDecode(
    session: Session,
    pcm: ShortArray,
    count: Int,
  ) {
    val samples = FloatArray(count) { index -> pcm[index] / 32768.0f }
    try {
      val recognizer = session.requireRecognizer()
      recognizer.acceptSamples(samples)
      while (session.control.shouldCapture() && recognizer.isReady()) {
        recognizer.decode()
      }
      session.partialGate.takeIfDue(
        recognizer.text(),
        SystemClock.elapsedRealtimeNanos(),
      )?.let { text ->
        if (isCurrent(session) && session.control.shouldCapture()) {
          session.callback.onPartial(session.id, session.generation, text)
        }
      }
    } finally {
      samples.fill(0f)
    }
  }

  private fun finishAfterUserStop(session: Session) {
    // AudioRecord is already stopped and the capture loop has consumed every
    // successful read. Signal end-of-input, then drain all decoder work before
    // exposing the one final result.
    val recognizer = session.requireRecognizer()
    recognizer.inputFinished()
    while (session.control.mayDecode() && recognizer.isReady()) {
      recognizer.decode()
    }
    if (!session.control.mayDecode()) return
    val text = recognizer.text().trim()
    if (text.isEmpty()) {
      fail(session, ERROR_NO_SPEECH, "No speech was recognized.", true)
    } else {
      complete(session, text)
    }
  }

  private fun complete(
    session: Session,
    text: String,
  ) {
    if (!session.control.completeAfterUserStop()) return
    session.watchdog?.cancel()
    activeSession.compareAndSet(session, null)
    session.releaseResources()
    session.callback.onFinal(session.id, session.generation, text)
  }

  private fun fail(
    session: Session,
    code: String,
    message: String,
    retryable: Boolean,
  ) {
    if (!session.control.terminateError()) return
    session.watchdog?.cancel()
    stopRecorder(session)
    activeSession.compareAndSet(session, null)
    session.releaseResources()
    session.callback.onError(session.id, session.generation, code, message, retryable)
  }

  private fun failRecordingTooLong(session: Session): Boolean {
    // The hard limit is a safety error. It must never call inputFinished(),
    // decode, or emit a final transcript.
    if (!session.control.terminateCaptureError()) return false
    session.watchdog?.cancel()
    stopRecorder(session)
    activeSession.compareAndSet(session, null)
    session.callback.onError(
      session.id,
      session.generation,
      ERROR_RECORDING_TOO_LONG,
      "One voice entry can be at most 30 seconds. Please record it in parts.",
      true,
    )
    return true
  }

  private fun isCurrent(session: Session): Boolean = activeSession.get() === session

  private fun stopRecorder(session: Session) {
    try {
      val recorder = session.recorder
      if (recorder?.recordingState == AudioRecord.RECORDSTATE_RECORDING) recorder.stop()
    } catch (_: IllegalStateException) {
      // The worker owns release and will observe the terminal gate.
    }
  }

  private fun releaseRecorder(recorder: AudioRecord?) {
    if (recorder == null) return
    try {
      if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) recorder.stop()
    } catch (_: IllegalStateException) {
      // Release remains mandatory after an OEM stop race.
    }
    recorder.release()
  }

  private fun createAudioRecord(): AudioRecord {
    val minimum =
      AudioRecord.getMinBufferSize(
        SAMPLE_RATE_HZ,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
    check(minimum > 0) { "Android does not support 16 kHz mono PCM16 capture." }
    val bytes = maxOf(minimum * 2, MIN_RECORD_BUFFER_BYTES)
    intArrayOf(MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC)
      .forEach { source ->
        val recorder =
          try {
            AudioRecord(
              source,
              SAMPLE_RATE_HZ,
              AudioFormat.CHANNEL_IN_MONO,
              AudioFormat.ENCODING_PCM_16BIT,
              bytes,
            )
          } catch (error: RuntimeException) {
            if (error is SecurityException) throw error
            null
          }
        if (recorder != null) {
          if (recorder.state == AudioRecord.STATE_INITIALIZED) return recorder
          recorder.release()
        }
      }
    error("Android could not initialize a 16 kHz PCM16 microphone.")
  }

  private fun assetExists(path: String): Boolean =
    try {
      context.assets.open(path).use { it.read() }
      true
    } catch (_: Exception) {
      false
    }

  private fun hasRecordAudioPermission() =
    context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  private data class Session(
    val id: String,
    val generation: Long,
    val callback: EmbeddedSpeechEngineCallback,
    val recognizer: AtomicReference<StreamingRecognizerAdapter?> = AtomicReference(null),
    val control: StreamingSessionControl = StreamingSessionControl(),
    val partialGate: PartialTranscriptGate = PartialTranscriptGate(PARTIAL_INTERVAL_NANOS),
    val resourcesReleased: AtomicBoolean = AtomicBoolean(false),
    @Volatile var recorder: AudioRecord? = null,
    @Volatile var watchdog: StreamingCaptureWatchdog? = null,
  ) {
    fun requireRecognizer(): StreamingRecognizerAdapter =
      checkNotNull(recognizer.get()) { "Streaming recognizer is not prepared." }

    fun releaseResources() {
      if (resourcesReleased.compareAndSet(false, true)) {
        try {
          recognizer.getAndSet(null)?.close()
        } catch (_: RuntimeException) {
          // Terminal cleanup is best-effort and must never emit a second result.
        } catch (_: LinkageError) {
          // JNI teardown failure is already terminal for this isolated session.
        }
      }
    }
  }

  private enum class RuntimeState {
    WARMING,
    READY,
    FAILED,
  }

  companion object {
    private const val SAMPLE_RATE_HZ = 16_000
    private const val READ_BUFFER_SAMPLES = 1_600
    private const val MIN_RECORD_BUFFER_BYTES = 8_192
    private const val EMPTY_READ_BACKOFF_MS = 10L
    private const val MAX_CAPTURE_SECONDS = 30
    private val MAX_CAPTURE_DURATION_NANOS =
      TimeUnit.SECONDS.toNanos(MAX_CAPTURE_SECONDS.toLong())
    private val PARTIAL_INTERVAL_NANOS = TimeUnit.MILLISECONDS.toNanos(250L)
    private const val MODEL_ROOT = "speech/zipformer-zh-14m"
    private val REQUIRED_ASSETS =
      listOf(
        "$MODEL_ROOT/encoder_jit_trace-pnnx.ncnn.param",
        "$MODEL_ROOT/encoder_jit_trace-pnnx.ncnn.bin",
        "$MODEL_ROOT/decoder_jit_trace-pnnx.ncnn.param",
        "$MODEL_ROOT/decoder_jit_trace-pnnx.ncnn.bin",
        "$MODEL_ROOT/joiner_jit_trace-pnnx.ncnn.param",
        "$MODEL_ROOT/joiner_jit_trace-pnnx.ncnn.bin",
        "$MODEL_ROOT/tokens.txt",
      )
    private const val ERROR_PERMISSION_DENIED = "permission-denied"
    private const val ERROR_MODEL_MISSING = "model-missing"
    private const val ERROR_NO_SPEECH = "no-speech"
    private const val ERROR_AUDIO = "audio"
    private const val ERROR_RECORDING_TOO_LONG = "recording-too-long"
  }
}
