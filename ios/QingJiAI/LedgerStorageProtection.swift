import Foundation
import React

@objc(LedgerStorageProtection)
final class LedgerStorageProtection: NSObject {
  private enum Contract {
    static let databaseName = "qingji_ai.sqlite"
    static let sidecarSuffixes = ["", "-wal", "-shm"]
    static let protection = FileProtectionType.completeUntilFirstUserAuthentication
  }

  private enum ProtectionError: LocalizedError {
    case emptyPath
    case invalidDatabaseName
    case outsideApplicationLibrary
    case databaseMissing
    case unexpectedFileType
    case attributeVerificationFailed

    var errorDescription: String? {
      switch self {
      case .emptyPath:
        return "The ledger database path is empty."
      case .invalidDatabaseName:
        return "The ledger database name is invalid."
      case .outsideApplicationLibrary:
        return "The ledger database is outside the application Library directory."
      case .databaseMissing:
        return "The ledger database file does not exist."
      case .unexpectedFileType:
        return "A ledger database path does not refer to a regular file."
      case .attributeVerificationFailed:
        return "The ledger database security attributes could not be verified."
      }
    }
  }

  private let fileManager = FileManager.default
  private let protectionQueue = DispatchQueue(
    label: "com.qingjiai.ledger-storage-protection",
    qos: .utility
  )

  @objc static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(applyProtection:resolver:rejecter:)
  func applyProtection(
    _ databasePath: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    protectionQueue.async {
      do {
        let protectedFileCount = try self.applyProtection(databasePath: databasePath)
        resolve(["protectedFileCount": protectedFileCount])
      } catch {
        reject("ledger-storage-protection", error.localizedDescription, error)
      }
    }
  }

  private func applyProtection(databasePath: String) throws -> Int {
    let trimmedPath = databasePath.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedPath.isEmpty else {
      throw ProtectionError.emptyPath
    }

    let databaseURL = URL(fileURLWithPath: trimmedPath)
      .standardizedFileURL
      .resolvingSymlinksInPath()
    guard databaseURL.lastPathComponent == Contract.databaseName else {
      throw ProtectionError.invalidDatabaseName
    }

    let libraryURL = try applicationLibraryURL()
    guard isContained(databaseURL, by: libraryURL) else {
      throw ProtectionError.outsideApplicationLibrary
    }

    guard fileManager.fileExists(atPath: databaseURL.path) else {
      throw ProtectionError.databaseMissing
    }

    var protectedFileCount = 0
    for suffix in Contract.sidecarSuffixes {
      let expectedName = Contract.databaseName + suffix
      let candidateURL = URL(fileURLWithPath: databaseURL.path + suffix)
      guard fileManager.fileExists(atPath: candidateURL.path) else {
        continue
      }

      let resolvedURL = candidateURL.standardizedFileURL.resolvingSymlinksInPath()
      guard
        resolvedURL.lastPathComponent == expectedName,
        isContained(resolvedURL, by: libraryURL)
      else {
        throw ProtectionError.outsideApplicationLibrary
      }

      let attributes = try fileManager.attributesOfItem(atPath: resolvedURL.path)
      guard
        attributes[.type] as? FileAttributeType == FileAttributeType.typeRegular
      else {
        throw ProtectionError.unexpectedFileType
      }

      try protectFile(at: resolvedURL)
      protectedFileCount += 1
    }

    return protectedFileCount
  }

  private func applicationLibraryURL() throws -> URL {
    guard
      let libraryURL = fileManager.urls(
        for: .libraryDirectory,
        in: .userDomainMask
      ).first
    else {
      throw ProtectionError.outsideApplicationLibrary
    }

    return libraryURL.standardizedFileURL.resolvingSymlinksInPath()
  }

  private func isContained(_ candidateURL: URL, by directoryURL: URL) -> Bool {
    let candidatePath = candidateURL.path
    let directoryPath = directoryURL.path
    return candidatePath.hasPrefix(directoryPath + "/")
  }

  private func protectFile(at fileURL: URL) throws {
    try fileManager.setAttributes(
      [.protectionKey: Contract.protection],
      ofItemAtPath: fileURL.path
    )

    var mutableURL = fileURL
    var resourceValues = URLResourceValues()
    resourceValues.isExcludedFromBackup = true
    try mutableURL.setResourceValues(resourceValues)

    let attributes = try fileManager.attributesOfItem(atPath: fileURL.path)
    let appliedProtection = attributes[.protectionKey] as? FileProtectionType
    let appliedResourceValues = try fileURL.resourceValues(
      forKeys: [.isExcludedFromBackupKey]
    )
    guard
      appliedProtection == Contract.protection,
      appliedResourceValues.isExcludedFromBackup == true
    else {
      throw ProtectionError.attributeVerificationFailed
    }
  }
}
