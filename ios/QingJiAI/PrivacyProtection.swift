import LocalAuthentication
import React
import UIKit

@objc(PrivacyProtection)
final class PrivacyProtection: NSObject {
  private var screenProtectionEnabled = false
  private var privacyOverlay: UIView?
  private var observers: [NSObjectProtocol] = []

  override init() {
    super.init()
    let center = NotificationCenter.default
    observers = [
      center.addObserver(
        forName: UIApplication.willResignActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in self?.showPrivacyOverlayIfNeeded() },
    ]
  }

  deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  @objc static func requiresMainQueueSetup() -> Bool {
    true
  }

  @objc(getCapabilities:rejecter:)
  func getCapabilities(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let context = LAContext()
    var error: NSError?
    let available = context.canEvaluatePolicy(
      .deviceOwnerAuthentication,
      error: &error
    )
    resolve([
      "available": available,
      "method": available ? "DEVICE_OWNER_AUTHENTICATION" : "NONE",
    ])
  }

  @objc(authenticate:resolver:rejecter:)
  func authenticate(
    _ reason: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let context = LAContext()
    context.localizedCancelTitle = "取消"
    var capabilityError: NSError?
    guard context.canEvaluatePolicy(
      .deviceOwnerAuthentication,
      error: &capabilityError
    ) else {
      reject(
        "privacy-auth-unavailable",
        "System owner authentication is unavailable.",
        capabilityError
      )
      return
    }
    context.evaluatePolicy(
      .deviceOwnerAuthentication,
      localizedReason: String(reason.prefix(120))
    ) { success, error in
      if success {
        resolve(["status": "AUTHENTICATED"])
        return
      }
      if let laError = error as? LAError,
         [.userCancel, .appCancel, .systemCancel].contains(laError.code) {
        resolve(["status": "CANCELLED"])
      } else {
        reject(
          "privacy-auth-failed",
          "System owner authentication failed.",
          error
        )
      }
    }
  }

  @objc(setScreenCaptureProtected:resolver:rejecter:)
  func setScreenCaptureProtected(
    _ enabled: Bool,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.screenProtectionEnabled = enabled
      if enabled && UIApplication.shared.applicationState != .active {
        self.showPrivacyOverlayIfNeeded()
      } else if !enabled {
        self.removePrivacyOverlay()
      }
      resolve(nil)
    }
  }

  @objc(hidePrivacyOverlay:rejecter:)
  func hidePrivacyOverlay(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.removePrivacyOverlay()
      resolve(nil)
    }
  }

  private func showPrivacyOverlayIfNeeded() {
    guard screenProtectionEnabled, privacyOverlay == nil,
          let window = foregroundWindow() else { return }
    let overlay = UIView(frame: window.bounds)
    overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    overlay.backgroundColor = UIColor(red: 0.965, green: 0.973, blue: 0.988, alpha: 1)

    let title = UILabel()
    title.translatesAutoresizingMaskIntoConstraints = false
    title.text = "轻记 AI"
    title.textColor = UIColor(red: 0.063, green: 0.094, blue: 0.157, alpha: 1)
    title.font = .boldSystemFont(ofSize: 24)
    overlay.addSubview(title)
    NSLayoutConstraint.activate([
      title.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
      title.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
    ])
    window.addSubview(overlay)
    privacyOverlay = overlay
  }

  private func removePrivacyOverlay() {
    privacyOverlay?.removeFromSuperview()
    privacyOverlay = nil
  }

  private func foregroundWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: { $0.isKeyWindow })
  }
}
