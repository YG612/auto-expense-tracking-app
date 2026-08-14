import Foundation
import ImageIO
import React
import Vision

@objc(ImageTextRecognition)
final class ImageTextRecognition: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(recognizeBase64:resolver:rejecter:)
  func recognizeBase64(
    _ content: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard content.count <= 30 * 1024 * 1024,
          let data = Data(base64Encoded: content),
          data.count <= 20 * 1024 * 1024,
          let cgImage = boundedCGImage(data) else {
      reject("ocr-image-invalid", "The selected image could not be decoded.", nil)
      return
    }
    recognize(cgImage, resolve: resolve, reject: reject)
  }

  @objc(recognizeUri:resolver:rejecter:)
  func recognizeUri(
    _ uri: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = URL(string: uri), url.isFileURL,
          let data = try? Data(contentsOf: url),
          data.count <= 20 * 1024 * 1024,
          let cgImage = boundedCGImage(data) else {
      reject("ocr-image-uri", "The shared image could not be opened.", nil)
      return
    }
    recognize(cgImage, resolve: resolve, reject: reject)
  }

  private func boundedCGImage(_ data: Data) -> CGImage? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(
            source,
            0,
            nil
          ) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
          let height = properties[kCGImagePropertyPixelHeight] as? NSNumber,
          width.int64Value > 0,
          height.int64Value > 0,
          width.int64Value * height.int64Value <= 24_000_000 else {
      return nil
    }
    return CGImageSourceCreateImageAtIndex(source, 0, nil)
  }

  private func recognize(
    _ image: CGImage,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.recognitionLanguages = ["zh-Hans", "en-US"]
      request.usesLanguageCorrection = false
      do {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        let lines = (request.results ?? []).compactMap {
          $0.topCandidates(1).first?.string
        }
        resolve([
          "text": String(lines.joined(separator: "\n").prefix(20_000)),
          "blockCount": lines.count,
          "engine": "IOS_VISION",
        ])
      } catch {
        reject(
          "ocr-recognition-failed",
          "On-device text recognition failed.",
          error
        )
      }
    }
  }
}
