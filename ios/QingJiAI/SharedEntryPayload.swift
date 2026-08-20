import Foundation
import React

@objc(SharedEntryPayload)
final class SharedEntryPayload: NSObject {
  private let suiteName = "group.com.qingjiai"
  private let keyPrefix = "shared-entry."
  private let maximumAge: TimeInterval = 10 * 60

  @objc(consume:resolver:rejecter:)
  func consume(
    _ token: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard UUID(uuidString: token) != nil,
          let defaults = UserDefaults(suiteName: suiteName) else {
      resolve(nil)
      return
    }
    let key = keyPrefix + token
    guard let payload = defaults.dictionary(forKey: key) else {
      resolve(nil)
      return
    }
    defaults.removeObject(forKey: key)
    guard let text = payload["text"] as? String,
          let createdAt = payload["createdAt"] as? TimeInterval,
          Date().timeIntervalSince1970 - createdAt <= maximumAge,
          !text.isEmpty else {
      resolve(nil)
      return
    }
    resolve(String(text.prefix(2_000)))
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }
}
