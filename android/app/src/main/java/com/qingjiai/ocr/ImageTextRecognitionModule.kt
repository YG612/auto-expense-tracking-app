package com.qingjiai.ocr

import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import java.io.ByteArrayOutputStream

class ImageTextRecognitionModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = NAME

  @ReactMethod
  fun recognizeBase64(content: String, promise: Promise) {
    try {
      require(content.length <= MAX_BASE64_CHARACTERS) { "Image content is too large." }
      val bytes = Base64.decode(content, Base64.DEFAULT)
      val bitmap = boundedBitmap(bytes)
      recognize(InputImage.fromBitmap(bitmap, 0), promise)
    } catch (error: Exception) {
      promise.reject("ocr-image-invalid", "The selected image could not be decoded.", error)
    }
  }

  @ReactMethod
  fun recognizeUri(uriValue: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriValue)
      require(uri.scheme == "content") { "Unsupported URI scheme." }
      val stream = reactContext.contentResolver.openInputStream(uri)
        ?: throw IllegalArgumentException("Shared image is not readable.")
      val bytes = stream.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        var total = 0
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          total += count
          require(total <= MAX_IMAGE_BYTES) { "Shared image is too large." }
          output.write(buffer, 0, count)
        }
        output.toByteArray()
      }
      recognize(InputImage.fromBitmap(boundedBitmap(bytes), 0), promise)
    } catch (error: Exception) {
      promise.reject("ocr-image-uri", "The shared image could not be opened.", error)
    }
  }

  private fun boundedBitmap(bytes: ByteArray): android.graphics.Bitmap {
    require(bytes.isNotEmpty() && bytes.size <= MAX_IMAGE_BYTES) {
      "Decoded image is too large."
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    require(bounds.outWidth > 0 && bounds.outHeight > 0) {
      "Image content could not be decoded."
    }
    require(bounds.outWidth.toLong() * bounds.outHeight.toLong() <= MAX_IMAGE_PIXELS) {
      "Image dimensions are too large."
    }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      ?: throw IllegalArgumentException("Image content could not be decoded.")
  }

  private fun recognize(image: InputImage, promise: Promise) {
    val recognizer = TextRecognition.getClient(
      ChineseTextRecognizerOptions.Builder().build(),
    )
    recognizer.process(image)
      .addOnSuccessListener { result -> promise.resolve(result(result)) }
      .addOnFailureListener { error ->
        promise.reject("ocr-recognition-failed", "On-device text recognition failed.", error)
      }
      .addOnCompleteListener { recognizer.close() }
  }

  private fun result(text: Text) = Arguments.createMap().apply {
    putString("text", text.text.take(MAX_RESULT_CHARACTERS))
    putInt("blockCount", text.textBlocks.size)
    putString("engine", "ANDROID_MLKIT_BUNDLED")
  }

  companion object {
    const val NAME = "ImageTextRecognition"
    private const val MAX_BASE64_CHARACTERS = 30 * 1024 * 1024
    private const val MAX_IMAGE_BYTES = 20 * 1024 * 1024
    private const val MAX_IMAGE_PIXELS = 24_000_000L
    private const val MAX_RESULT_CHARACTERS = 20_000
  }
}
