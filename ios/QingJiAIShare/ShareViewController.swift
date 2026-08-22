import UIKit
import UniformTypeIdentifiers
import Vision

final class ShareViewController: UIViewController {
  private let suiteName = "group.com.qingjiai"
  private let keyPrefix = "shared-entry."
  private let statusLabel = UILabel()
  private let openButton = UIButton(type: .system)
  private var recognizedText: String?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    statusLabel.numberOfLines = 0
    statusLabel.textAlignment = .center
    statusLabel.text = "正在本机读取分享内容…"
    openButton.translatesAutoresizingMaskIntoConstraints = false
    openButton.setTitle("打开轻记 AI 核对", for: .normal)
    openButton.titleLabel?.font = .boldSystemFont(ofSize: 17)
    openButton.isHidden = true
    openButton.addTarget(self, action: #selector(openHostApp), for: .touchUpInside)
    view.addSubview(statusLabel)
    view.addSubview(openButton)
    NSLayoutConstraint.activate([
      statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
      statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -30),
      openButton.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 24),
      openButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      openButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
    ])
    loadSharedContent()
  }

  private func loadSharedContent() {
    let providers = extensionContext?.inputItems
      .compactMap { $0 as? NSExtensionItem }
      .flatMap { $0.attachments ?? [] } ?? []
    if let textProvider = providers.first(where: {
      $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
    }) {
      textProvider.loadItem(forTypeIdentifier: UTType.plainText.identifier) {
        [weak self] item, error in
        guard error == nil else { self?.fail(); return }
        self?.finish(text: item as? String ?? (item as? URL)?.absoluteString)
      }
      return
    }
    if let imageProvider = providers.first(where: {
      $0.hasItemConformingToTypeIdentifier(UTType.image.identifier)
    }) {
      imageProvider.loadItem(forTypeIdentifier: UTType.image.identifier) {
        [weak self] item, error in
        guard error == nil else { self?.fail(); return }
        let image: UIImage?
        if let value = item as? UIImage {
          image = value
        } else if let url = item as? URL,
                  let data = try? Data(contentsOf: url),
                  data.count <= 20 * 1024 * 1024 {
          image = UIImage(data: data)
        } else {
          image = nil
        }
        self?.recognize(image)
      }
      return
    }
    fail()
  }

  private func recognize(_ image: UIImage?) {
    guard let cgImage = image?.cgImage,
          Int64(cgImage.width) * Int64(cgImage.height) <= 24_000_000 else {
      fail()
      return
    }
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.recognitionLanguages = ["zh-Hans", "en-US"]
      request.usesLanguageCorrection = false
      do {
        try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
        let text = (request.results ?? [])
          .compactMap { $0.topCandidates(1).first?.string }
          .joined(separator: "\n")
        self?.finish(text: text)
      } catch {
        self?.fail()
      }
    }
  }

  private func finish(text: String?) {
    let normalized = text?.trimmingCharacters(in: .whitespacesAndNewlines)
    DispatchQueue.main.async {
      guard let normalized, !normalized.isEmpty else { self.fail(); return }
      self.recognizedText = String(normalized.prefix(2_000))
      self.statusLabel.text = "内容已在本机识别。打开应用后仍需核对，不会自动入账。"
      self.openButton.isHidden = false
    }
  }

  private func fail() {
    DispatchQueue.main.async {
      self.statusLabel.text = "未能读取分享内容。可打开轻记 AI 后手动输入或选择截图。"
      self.openButton.isHidden = true
    }
  }

  @objc private func openHostApp() {
    guard let text = recognizedText else { return }
    guard let defaults = UserDefaults(suiteName: suiteName) else {
      fail()
      return
    }
    let now = Date().timeIntervalSince1970
    for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(keyPrefix) {
      let createdAt = defaults.dictionary(forKey: key)?["createdAt"] as? TimeInterval
      if createdAt == nil || now - createdAt! > 10 * 60 {
        defaults.removeObject(forKey: key)
      }
    }
    let token = UUID().uuidString
    let payloadKey = keyPrefix + token
    defaults.set(["text": text, "createdAt": now], forKey: payloadKey)
    var components = URLComponents()
    components.scheme = "qingjiai"
    components.host = "entry"
    components.path = "/smart"
    components.queryItems = [
      URLQueryItem(name: "token", value: token),
      URLQueryItem(name: "source", value: "ocr"),
    ]
    guard let url = components.url else {
      defaults.removeObject(forKey: payloadKey)
      fail()
      return
    }
    extensionContext?.open(url) { [weak self] opened in
      if opened {
        self?.extensionContext?.completeRequest(returningItems: nil)
      } else {
        defaults.removeObject(forKey: payloadKey)
        self?.fail()
      }
    }
  }
}
