import AppIntents
import Foundation

private enum QingJiAgentIntentAction: String, Codable {
  case preview
  case preparePending
  case openPending
}

private struct QingJiAgentIntentEnvelope: Codable {
  let schemaVersion: Int
  let action: QingJiAgentIntentAction
  let text: String?
}

enum QingJiAgentIntentInbox {
  private static let fileName = "qingji-agent-review-intent.json"
  // Must match the shared parser's MAX_BOOKKEEPING_TEXT_CHARACTERS boundary.
  private static let maxTextLength = 500

  private static var fileURL: URL {
    FileManager.default.temporaryDirectory.appendingPathComponent(
      fileName,
      isDirectory: false
    )
  }

  static func enqueueReview(text rawText: String, preparePending: Bool) throws {
    let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text.count <= maxTextLength, !text.contains("\0") else {
      throw NSError(
        domain: "com.qingjiai.agent-intent",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "账单文字必须为 1 至 500 个字符，且不能包含空字符。"]
      )
    }
    try write(
      QingJiAgentIntentEnvelope(
        schemaVersion: 1,
        action: preparePending ? .preparePending : .preview,
        text: text
      )
    )
  }

  static func enqueueOpenPending() throws {
    try write(
      QingJiAgentIntentEnvelope(
        schemaVersion: 1,
        action: .openPending,
        text: nil
      )
    )
  }

  private static func write(_ envelope: QingJiAgentIntentEnvelope) throws {
    let data = try JSONEncoder().encode(envelope)
    try data.write(to: fileURL, options: [.atomic, .completeFileProtection])
  }

  /// Consumes a short-lived review request. Public links only navigate or
  /// prefill; they never create, confirm, update, or delete ledger records.
  static func consumeURL() -> URL? {
    let url = fileURL
    guard let data = try? Data(contentsOf: url) else { return nil }
    defer { try? FileManager.default.removeItem(at: url) }
    guard
      let envelope = try? JSONDecoder().decode(
        QingJiAgentIntentEnvelope.self,
        from: data
      ),
      envelope.schemaVersion == 1
    else {
      return nil
    }

    var components = URLComponents()
    components.scheme = "qingjiai"
    switch envelope.action {
    case .openPending:
      components.host = "pending"
    case .preview, .preparePending:
      guard
        let text = envelope.text,
        !text.isEmpty,
        text.count <= maxTextLength,
        !text.contains("\0")
      else {
        return nil
      }
      components.host = "entry"
      components.path = "/smart"
      components.queryItems = [
        URLQueryItem(name: "text", value: text),
        URLQueryItem(name: "source", value: "agent"),
      ]
    }
    return components.url
  }
}

@available(iOS 16.0, *)
struct QingJiPreviewBillIntent: AppIntent {
  static var title: LocalizedStringResource = "在轻记 AI 中预览账单"
  static var description = IntentDescription(
    "打开轻记 AI 的智能记账核对页。此操作不会写入或确认交易。"
  )
  static var openAppWhenRun: Bool = true

  @Parameter(title: "账单文字")
  var billText: String

  static var parameterSummary: some ParameterSummary {
    Summary("预览 \(\.$billText)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try QingJiAgentIntentInbox.enqueueReview(
      text: billText,
      preparePending: false
    )
    return .result(dialog: "已打开核对页；尚未写入账本。")
  }
}

@available(iOS 16.0, *)
struct QingJiPreparePendingBillIntent: AppIntent {
  static var title: LocalizedStringResource = "在轻记 AI 中准备待确认账单"
  static var description = IntentDescription(
    "打开核对页并填入账单。必须在 App 内明确保存，快捷指令本身不会创建或确认交易。"
  )
  static var openAppWhenRun: Bool = true

  @Parameter(title: "账单文字")
  var billText: String

  static var parameterSummary: some ParameterSummary {
    Summary("准备待确认账单 \(\.$billText)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try QingJiAgentIntentInbox.enqueueReview(
      text: billText,
      preparePending: true
    )
    return .result(dialog: "请在轻记 AI 中核对并选择保存为待确认。")
  }
}

@available(iOS 16.0, *)
struct QingJiOpenPendingBillsIntent: AppIntent {
  static var title: LocalizedStringResource = "打开轻记 AI 待确认账单"
  static var description = IntentDescription(
    "打开待确认列表，不会修改或确认任何交易。"
  )
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try QingJiAgentIntentInbox.enqueueOpenPending()
    return .result(dialog: "已打开待确认列表。")
  }
}

@available(iOS 16.0, *)
struct QingJiAgentAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: QingJiPreviewBillIntent(),
      phrases: ["用 \(.applicationName) 预览账单"]
    )
    AppShortcut(
      intent: QingJiPreparePendingBillIntent(),
      phrases: ["用 \(.applicationName) 准备待确认账单"]
    )
    AppShortcut(
      intent: QingJiOpenPendingBillsIntent(),
      phrases: ["打开 \(.applicationName) 待确认账单"]
    )
  }
}
