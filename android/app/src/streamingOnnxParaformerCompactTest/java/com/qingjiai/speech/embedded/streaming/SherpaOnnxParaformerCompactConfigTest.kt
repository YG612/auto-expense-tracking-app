package com.qingjiai.speech.embedded.streaming

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.nio.file.Files
import java.security.MessageDigest

class SherpaOnnxParaformerCompactConfigTest {
  @Test
  fun `compact track preserves baseline frontend and vocabulary paths`() {
    assertEquals(16_000, COMPACT_SAMPLE_RATE_HZ)
    assertEquals(80, COMPACT_FEATURE_DIM)
    assertEquals(2, COMPACT_DECODER_THREADS)
    assertTrue(COMPACT_TOKENS_ASSET.endsWith("tokens.txt"))
  }

  @Test
  fun `model lab exposes six locked and uniquely named candidates`() {
    assertEquals(6, COMPACT_MODEL_SPECS.size)
    assertEquals(DEFAULT_COMPACT_MODEL_ID, COMPACT_MODEL_SPECS.first().id)
    assertEquals(COMPACT_MODEL_SPECS.size, COMPACT_MODEL_SPECS.map { it.id }.toSet().size)
    assertEquals(COMPACT_MODEL_SPECS.size, COMPACT_MODEL_SPECS.map { it.assetName }.toSet().size)
    assertTrue(COMPACT_MODEL_SPECS.all { it.assetName.endsWith(".qgz") })
    assertTrue(COMPACT_MODEL_SPECS.all { it.compressedSizeBytes < it.unpackedSizeBytes })
    assertTrue(COMPACT_MODEL_SPECS.any { it.id == "baseline-int8" })
    assertTrue(COMPACT_MODEL_SPECS.any { it.id == "rtn-safe" })
    assertTrue(COMPACT_MODEL_SPECS.any { it.id == "hqq-safe" })
    assertTrue(COMPACT_MODEL_SPECS.any { it.id == "asym-full" })
  }

  @Test
  fun `installer publishes only an exact hash and size match`() {
    val root = Files.createTempDirectory("compact-installer").toFile()
    try {
      val bytes = "lossless-paraformer".toByteArray()
      val hash = MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString("") { "%02x".format(it) }
      val destination = root.resolve("model.onnx")
      CompactParaformerAssetInstaller.installVerified(
        ByteArrayInputStream(bytes), destination, bytes.size.toLong(), hash,
      )
      assertTrue(destination.isFile)
      assertTrue(destination.readBytes().contentEquals(bytes))
      assertFalse(root.resolve("model.onnx.tmp").exists())
    } finally {
      root.deleteRecursively()
    }
  }

  @Test(expected = IllegalStateException::class)
  fun `installer fails closed and removes temp file on hash mismatch`() {
    val root = Files.createTempDirectory("compact-installer-bad").toFile()
    try {
      val destination = root.resolve("model.onnx")
      CompactParaformerAssetInstaller.installVerified(
        ByteArrayInputStream(byteArrayOf(1, 2, 3)), destination, 3, "0".repeat(64),
      )
    } finally {
      assertFalse(root.resolve("model.onnx.tmp").exists())
      root.deleteRecursively()
    }
  }
}
