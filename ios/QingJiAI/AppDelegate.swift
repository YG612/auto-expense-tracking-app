import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import React_RCTLinking

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
    if let shortcut = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem {
      let path = shortcut.type == "com.qingjiai.manual-entry"
        ? "entry/manual"
        : "entry/smart"
      effectiveLaunchOptions[.url] = URL(string: "qingjiai://\(path)")
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

  func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    let path = shortcutItem.type == "com.qingjiai.manual-entry"
      ? "entry/manual"
      : "entry/smart"
    if let url = URL(string: "qingjiai://\(path)") {
      _ = RCTLinkingManager.application(application, open: url, options: [:])
      completionHandler(true)
    } else {
      completionHandler(false)
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
