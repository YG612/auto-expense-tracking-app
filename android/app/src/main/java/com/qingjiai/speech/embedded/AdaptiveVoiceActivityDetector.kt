package com.qingjiai.speech.embedded

import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Model-free, advisory VAD used only for truthful UI hints and audio quality.
 * It never stops capture and never submits a transcript.
 */
class AdaptiveVoiceActivityDetector(
  private val sampleRateHz: Int = 16_000,
  private val calibrationMs: Long = 300,
  private val endpointSilenceMs: Long = 900,
) {
  private var totalSamples = 0L
  private var calibrationSamples = 0L
  private var calibrationSquareSum = 0.0
  private var noiseRms = MIN_NOISE_RMS
  private var voicedCandidateMs = 0L
  private var voicedDurationMs = 0L
  private var trailingSilenceMs = 0L
  private var clippedSamples = 0L
  private var speechDetected = false
  private var endpointHinted = false
  private var peakSpeechRms = 0.0

  fun accept(
    pcm: ShortArray,
    count: Int,
  ): EmbeddedAudioState {
    require(count in 0..pcm.size) { "PCM count is outside the supplied buffer." }
    if (count == 0) return snapshot(0.0)

    var squareSum = 0.0
    var crossings = 0
    var previous = pcm[0].toInt()
    for (index in 0 until count) {
      val value = pcm[index].toInt()
      val normalized = value / 32768.0
      squareSum += normalized * normalized
      if (kotlin.math.abs(value) >= CLIPPING_THRESHOLD) clippedSamples++
      if (index > 0 && (value >= 0) != (previous >= 0)) crossings++
      previous = value
    }
    totalSamples += count
    val rms = sqrt(squareSum / count)
    val frameMs = max(1L, count * 1_000L / sampleRateHz)

    val calibrationLimit = calibrationMs * sampleRateHz / 1_000L
    if (calibrationSamples < calibrationLimit) {
      val remaining = (calibrationLimit - calibrationSamples).coerceAtMost(count.toLong()).toInt()
      var calibrationFrameSquare = 0.0
      for (index in 0 until remaining) {
        val normalized = pcm[index] / 32768.0
        calibrationFrameSquare += normalized * normalized
      }
      calibrationSquareSum += calibrationFrameSquare
      calibrationSamples += remaining
      noiseRms = sqrt(calibrationSquareSum / calibrationSamples.coerceAtLeast(1))
        .coerceAtLeast(MIN_NOISE_RMS)
      return snapshot(rms)
    }

    val zeroCrossingRate = crossings.toDouble() / count
    val voiceThreshold = max(ABSOLUTE_VOICE_RMS, noiseRms * NOISE_MULTIPLIER)
    val voiced =
      rms >= voiceThreshold &&
        zeroCrossingRate in MIN_VOICE_ZCR..MAX_VOICE_ZCR
    if (voiced) {
      voicedCandidateMs += frameMs
      peakSpeechRms = max(peakSpeechRms, rms)
      if (voicedCandidateMs >= MIN_VOICE_RUN_MS) speechDetected = true
      if (speechDetected) voicedDurationMs += frameMs
      trailingSilenceMs = 0
    } else {
      voicedCandidateMs = 0
      if (speechDetected) {
        trailingSilenceMs += frameMs
        if (trailingSilenceMs >= endpointSilenceMs) endpointHinted = true
      }
    }
    return snapshot(rms)
  }

  fun quality(): EmbeddedAudioQuality {
    val snr =
      if (peakSpeechRms > 0.0 && noiseRms > 0.0) {
        20.0 * log10(peakSpeechRms / noiseRms)
      } else {
        null
      }
    return EmbeddedAudioQuality(
      estimatedSnrDb = snr,
      clippingRatio = clippedSamples.toDouble() / totalSamples.coerceAtLeast(1),
      voicedDurationMs = voicedDurationMs,
      noiseTooHigh = noiseRms >= HIGH_NOISE_RMS || (snr != null && snr < LOW_SNR_DB),
    )
  }

  fun hasDetectedSpeech(): Boolean = speechDetected

  private fun snapshot(rms: Double) =
    EmbeddedAudioState(
      volumeLevel = normalizedVolume(rms),
      speechDetected = speechDetected,
      trailingSilenceMs = trailingSilenceMs,
      endpointHinted = endpointHinted,
    )

  private fun normalizedVolume(rms: Double): Double {
    if (rms <= 0.0) return 0.0
    val db = 20.0 * log10(rms.coerceAtLeast(0.000_01))
    return ((db - MIN_DISPLAY_DB) / -MIN_DISPLAY_DB).coerceIn(0.0, 1.0)
  }

  companion object {
    private const val MIN_NOISE_RMS = 0.001
    private const val ABSOLUTE_VOICE_RMS = 0.012
    private const val HIGH_NOISE_RMS = 0.08
    private const val NOISE_MULTIPLIER = 3.0
    private const val MIN_VOICE_ZCR = 0.005
    private const val MAX_VOICE_ZCR = 0.45
    private const val MIN_VOICE_RUN_MS = 100L
    private const val LOW_SNR_DB = 8.0
    private const val MIN_DISPLAY_DB = -60.0
    private const val CLIPPING_THRESHOLD = 32_440
  }
}
