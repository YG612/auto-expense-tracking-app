import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    var effectiveLaunchOptions = launchOptions ?? [:]
    if let intentURL = QingJiAgentIntentInbox.consumeURL() {
      effectiveLaunchOptions[.url] = intentURL
    }

    factory.startReactNative(
      withModuleName: "QingJiAI",
      in: window,
      launchOptions: effectiveLaunchOptions
    )

    return true
  }

  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    RCTLinkingManager.application(app, open: url, options: options)
  }

  func applicationDidBecomeActive(_ application: UIApplication) {
    guard let intentURL = QingJiAgentIntentInbox.consumeURL() else { return }
    // Warm launches already have a live React Native instance. Defer one turn
    // so Linking's event listener can receive the route after activation.
    DispatchQueue.main.async {
      _ = RCTLinkingManager.application(
        application,
        open: intentURL,
        options: [:]
      )
    }
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
