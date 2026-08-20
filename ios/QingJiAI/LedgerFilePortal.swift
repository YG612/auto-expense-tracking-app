import Foundation
import React
import UIKit
import UniformTypeIdentifiers

@objc(LedgerFilePortal)
final class LedgerFilePortal: NSObject, UIDocumentPickerDelegate {
  private enum Contract {
    static let maximumTextBytes = 50 * 1024 * 1024
    static let maximumFileNameCharacters = 128
    static let maximumOpenBytes = 50 * 1024 * 1024
  }

  private var pendingResolve: RCTPromiseResolveBlock?
  private var pendingReject: RCTPromiseRejectBlock?
  private var temporaryURL: URL?
  private var openingFile = false

  @objc static func requiresMainQueueSetup() -> Bool {
    true
  }

  @objc(saveText:mimeType:content:resolver:rejecter:)
  func saveText(
    _ suggestedFileName: String,
    mimeType: String,
    content: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard pendingResolve == nil else {
      reject(
        "ledger-file-save-busy",
        "Another ledger file operation is already active.",
        nil
      )
      return
    }
    guard let safeName = sanitizeFileName(suggestedFileName) else {
      reject("ledger-file-save-name", "The export file name is invalid.", nil)
      return
    }
    guard isValidMimeType(mimeType) else {
      reject("ledger-file-save-mime", "The export MIME type is invalid.", nil)
      return
    }
    guard Data(content.utf8).count <= Contract.maximumTextBytes else {
      reject("ledger-file-save-size", "The export content is too large.", nil)
      return
    }
    guard let presenter = foregroundPresenter() else {
      reject(
        "ledger-file-save-activity",
        "No foreground view controller is available for the system file picker.",
        nil
      )
      return
    }

    let temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent("qingji-ledger-export", isDirectory: true)
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let fileURL = temporaryDirectory.appendingPathComponent(safeName)

    do {
      try FileManager.default.createDirectory(
        at: temporaryDirectory,
        withIntermediateDirectories: true
      )
      try content.write(to: fileURL, atomically: true, encoding: .utf8)
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.complete],
        ofItemAtPath: fileURL.path
      )
    } catch {
      try? FileManager.default.removeItem(at: temporaryDirectory)
      reject(
        "ledger-file-save-stage",
        "The ledger export could not be prepared for the system file picker.",
        error
      )
      return
    }

    pendingResolve = resolve
    pendingReject = reject
    temporaryURL = fileURL

    let picker = UIDocumentPickerViewController(
      forExporting: [fileURL],
      asCopy: true
    )
    picker.delegate = self
    picker.modalPresentationStyle = .formSheet
    presenter.present(picker, animated: true)
  }

  @objc(openText:resolver:rejecter:)
  func openText(
    _ mimeTypes: [String],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard pendingResolve == nil, !mimeTypes.isEmpty, mimeTypes.count <= 8 else {
      reject("ledger-file-open-busy", "Another file operation is active or the file types are invalid.", nil)
      return
    }
    guard let presenter = foregroundPresenter() else {
      reject("ledger-file-open-activity", "No foreground view controller is available.", nil)
      return
    }
    let types = mimeTypes.compactMap { UTType(mimeType: $0) }
    guard types.count == mimeTypes.count else {
      reject("ledger-file-open-mime", "The accepted MIME types are invalid.", nil)
      return
    }
    pendingResolve = resolve
    pendingReject = reject
    openingFile = true
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
    picker.delegate = self
    picker.allowsMultipleSelection = false
    presenter.present(picker, animated: true)
  }

  func documentPicker(
    _ controller: UIDocumentPickerViewController,
    didPickDocumentsAt urls: [URL]
  ) {
    if openingFile {
      guard let url = urls.first else {
        failOpen(CryptoFileError.invalidSelection)
        return
      }
      do {
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, (values.fileSize ?? 0) <= Contract.maximumOpenBytes else {
          throw CryptoFileError.invalidSelection
        }
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        guard data.count <= Contract.maximumOpenBytes else {
          throw CryptoFileError.invalidSelection
        }
        let decoded = String(data: data, encoding: .utf8)
        let content = decoded ?? data.base64EncodedString()
        openingFile = false
        finish([
          "status": "OPENED",
          "content": content,
          "encoding": decoded == nil ? "BASE64" : "UTF8",
          "uri": url.absoluteString,
          "fileName": url.lastPathComponent,
        ])
      } catch {
        failOpen(error)
      }
      return
    }
    var result: [String: Any] = ["status": "SAVED"]
    if let selectedURL = urls.first {
      result["uri"] = selectedURL.absoluteString
    }
    finish(result)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    openingFile = false
    finish(["status": "CANCELLED"])
  }

  private enum CryptoFileError: LocalizedError {
    case invalidSelection
    var errorDescription: String? { "The selected ledger file is invalid or too large." }
  }

  private func failOpen(_ error: Error) {
    let reject = pendingReject
    pendingResolve = nil
    pendingReject = nil
    openingFile = false
    reject?("ledger-file-open-read", error.localizedDescription, error)
  }

  private func finish(_ result: [String: Any]) {
    let resolve = pendingResolve
    pendingResolve = nil
    pendingReject = nil
    cleanupTemporaryFile()
    resolve?(result)
  }

  private func cleanupTemporaryFile() {
    guard let temporaryURL else { return }
    self.temporaryURL = nil
    try? FileManager.default.removeItem(at: temporaryURL.deletingLastPathComponent())
  }

  private func sanitizeFileName(_ value: String) -> String? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard
      !trimmed.isEmpty,
      trimmed.count <= Contract.maximumFileNameCharacters,
      trimmed != ".",
      trimmed != ".."
    else {
      return nil
    }

    let invalid = CharacterSet(charactersIn: "/\\:*?\"<>|")
      .union(.controlCharacters)
    let components = trimmed.components(separatedBy: invalid)
    return components.joined(separator: "_")
  }

  private func isValidMimeType(_ value: String) -> Bool {
    let pattern = "^[a-zA-Z0-9][a-zA-Z0-9.+-]*/[a-zA-Z0-9][a-zA-Z0-9.+-]*$"
    return value.range(of: pattern, options: .regularExpression) != nil
  }

  private func foregroundPresenter() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap {
      $0 as? UIWindowScene
    }
    let window = scenes
      .flatMap(\.windows)
      .first(where: { $0.isKeyWindow })
    return topViewController(window?.rootViewController)
  }

  private func topViewController(_ viewController: UIViewController?) -> UIViewController? {
    if let presented = viewController?.presentedViewController {
      return topViewController(presented)
    }
    if let navigation = viewController as? UINavigationController {
      return topViewController(navigation.visibleViewController)
    }
    if let tab = viewController as? UITabBarController {
      return topViewController(tab.selectedViewController)
    }
    return viewController
  }
}
