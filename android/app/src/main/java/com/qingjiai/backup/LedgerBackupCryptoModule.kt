package com.qingjiai.backup

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.Arrays
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

class LedgerBackupCryptoModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val executor: ExecutorService = Executors.newSingleThreadExecutor()
  private val secureRandom = SecureRandom()

  override fun getName(): String = NAME

  @ReactMethod
  fun encrypt(plaintext: String, passphrase: String, promise: Promise) {
    executor.execute {
      try {
        validatePassphrase(passphrase)
        val plaintextBytes = plaintext.toByteArray(StandardCharsets.UTF_8)
        require(plaintextBytes.isNotEmpty() && plaintextBytes.size <= MAX_PLAINTEXT_BYTES) {
          "Ledger backup plaintext size is invalid."
        }

        val salt = ByteArray(SALT_BYTES).also(secureRandom::nextBytes)
        val nonce = ByteArray(NONCE_BYTES).also(secureRandom::nextBytes)
        val key = deriveKey(passphrase, salt)
        try {
          val cipher = Cipher.getInstance("AES/GCM/NoPadding")
          cipher.init(
            Cipher.ENCRYPT_MODE,
            SecretKeySpec(key, "AES"),
            GCMParameterSpec(TAG_BITS, nonce),
          )
          cipher.updateAAD(ASSOCIATED_DATA)
          val ciphertext = cipher.doFinal(plaintextBytes)
          val envelope = createEnvelope(salt, nonce, ciphertext).toString()
          require(envelope.toByteArray(StandardCharsets.UTF_8).size <= MAX_ENVELOPE_BYTES)
          promise.resolve(envelope)
        } finally {
          Arrays.fill(key, 0.toByte())
        }
      } catch (error: Exception) {
        promise.reject(
          "ledger-backup-encrypt",
          "The encrypted ledger backup could not be created.",
          error,
        )
      }
    }
  }

  @ReactMethod
  fun decrypt(envelope: String, passphrase: String, promise: Promise) {
    executor.execute {
      try {
        validatePassphrase(passphrase)
        require(
          envelope.isNotEmpty() &&
            envelope.toByteArray(StandardCharsets.UTF_8).size <= MAX_ENVELOPE_BYTES
        ) {
          "Encrypted ledger backup size is invalid."
        }

        val parsed = JSONObject(envelope)
        require(parsed.getString("format") == FORMAT)
        require(parsed.getInt("formatVersion") == FORMAT_VERSION)
        val kdf = parsed.getJSONObject("kdf")
        require(kdf.getString("algorithm") == KDF_ALGORITHM)
        require(kdf.getInt("iterations") == PBKDF2_ITERATIONS)
        val cipherMetadata = parsed.getJSONObject("cipher")
        require(cipherMetadata.getString("algorithm") == CIPHER_ALGORITHM)

        val salt = decodeBase64(kdf.getString("salt"), SALT_BYTES, SALT_BYTES)
        val nonce = decodeBase64(
          cipherMetadata.getString("nonce"),
          NONCE_BYTES,
          NONCE_BYTES,
        )
        val ciphertext = decodeBase64(
          cipherMetadata.getString("ciphertext"),
          TAG_BYTES,
          MAX_CIPHERTEXT_BYTES,
        )
        val key = deriveKey(passphrase, salt)
        try {
          val cipher = Cipher.getInstance("AES/GCM/NoPadding")
          cipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(key, "AES"),
            GCMParameterSpec(TAG_BITS, nonce),
          )
          cipher.updateAAD(ASSOCIATED_DATA)
          val plaintext = cipher.doFinal(ciphertext)
          require(plaintext.size <= MAX_PLAINTEXT_BYTES)
          promise.resolve(String(plaintext, StandardCharsets.UTF_8))
        } finally {
          Arrays.fill(key, 0.toByte())
        }
      } catch (error: Exception) {
        val message = if (error is AEADBadTagException) {
          "The passphrase is incorrect or the backup was modified."
        } else {
          "The encrypted ledger backup is invalid or cannot be decrypted."
        }
        promise.reject("ledger-backup-decrypt", message, error)
      }
    }
  }

  private fun validatePassphrase(value: String) {
    val count = value.codePointCount(0, value.length)
    require(count in MIN_PASSPHRASE_CHARACTERS..MAX_PASSPHRASE_CHARACTERS) {
      "Backup passphrase length is invalid."
    }
  }

  private fun deriveKey(passphrase: String, salt: ByteArray): ByteArray {
    val specification = PBEKeySpec(
      passphrase.toCharArray(),
      salt,
      PBKDF2_ITERATIONS,
      KEY_BITS,
    )
    return try {
      SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        .generateSecret(specification)
        .encoded
    } finally {
      specification.clearPassword()
    }
  }

  private fun createEnvelope(
    salt: ByteArray,
    nonce: ByteArray,
    ciphertext: ByteArray,
  ) = JSONObject()
    .put("format", FORMAT)
    .put("formatVersion", FORMAT_VERSION)
    .put(
      "kdf",
      JSONObject()
        .put("algorithm", KDF_ALGORITHM)
        .put("iterations", PBKDF2_ITERATIONS)
        .put("salt", encodeBase64(salt)),
    )
    .put(
      "cipher",
      JSONObject()
        .put("algorithm", CIPHER_ALGORITHM)
        .put("nonce", encodeBase64(nonce))
        .put("ciphertext", encodeBase64(ciphertext)),
    )

  private fun encodeBase64(value: ByteArray): String =
    Base64.encodeToString(value, Base64.NO_WRAP)

  private fun decodeBase64(
    value: String,
    minimumBytes: Int,
    maximumBytes: Int,
  ): ByteArray {
    require(value.length <= ((maximumBytes + 2L) / 3L * 4L))
    val decoded = Base64.decode(value, Base64.NO_WRAP)
    require(decoded.size in minimumBytes..maximumBytes)
    return decoded
  }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }

  companion object {
    const val NAME = "LedgerBackupCrypto"
    private const val FORMAT = "qingji-ai-encrypted-backup"
    private const val FORMAT_VERSION = 1
    private const val KDF_ALGORITHM = "PBKDF2-HMAC-SHA256"
    private const val CIPHER_ALGORITHM = "AES-256-GCM"
    private const val PBKDF2_ITERATIONS = 310_000
    private const val SALT_BYTES = 16
    private const val NONCE_BYTES = 12
    private const val TAG_BYTES = 16
    private const val TAG_BITS = TAG_BYTES * 8
    private const val KEY_BITS = 256
    private const val MIN_PASSPHRASE_CHARACTERS = 8
    private const val MAX_PASSPHRASE_CHARACTERS = 256
    private const val MAX_PLAINTEXT_BYTES = 32 * 1024 * 1024
    private const val MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + TAG_BYTES
    private const val MAX_ENVELOPE_BYTES = 50 * 1024 * 1024
    private val ASSOCIATED_DATA =
      "$FORMAT:$FORMAT_VERSION:$KDF_ALGORITHM:$PBKDF2_ITERATIONS:$CIPHER_ALGORITHM"
        .toByteArray(StandardCharsets.UTF_8)
  }
}
