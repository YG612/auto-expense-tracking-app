import AVFoundation
import Foundation
import React
import Speech
import UIKit

@objc(SpeechRecognition)
final class SpeechRecognition: RCTEventEmitter {
  private enum EventName {
    static let state = "SpeechRecognitionState"
    static let partial = "SpeechRecognitionPartial"
    static let final = "SpeechRecognitionFinal"
    static let error = "SpeechRecognitionError"
  }

  private enum Timing {
    static let maximumSessionDuration: TimeInterval = 30
    static let finalResultTimeout: TimeInterval = 6
  }

  private var hasListeners = false
  private var activeSessionId: String?
  private var activeLocale = "zh-CN"
  private var activeUsesOnDeviceRecognition = false
  private var activeUsedNetworkFallback = false
  private var terminalEventDelivered = false
  private var stopRequested = false

  private var speechRecognizer: SFSpeechRecognizer?
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var audioEngine: AVAudioEngine?
  private var audioInputNode: AVAudioInputNode?
  private var audioTapInstalled = false
  private var sessionTimeoutTimer: Timer?
  private var finalResultTimeoutTimer: Timer?

  override init() {
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(applicationDidEnterBackground),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(audioSessionWasInterrupted(_:)),
      name: AVAudioSession.interruptionNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    cleanupRecognitionResources(cancelTask: true)
  }

  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String]! {
    [EventName.state, EventName.partial, EventName.final, EventName.error]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
    // Never leave the microphone active after the JS consumer disappears.
    onMain { [weak self] in
      guard let self, self.activeSessionId != nil else { return }
      self.cancelActiveSession(reason: "listeners-removed")
    }
  }

  @objc(getCapabilities:resolver:rejecter:)
  func getCapabilities(
    _ localeIdentifier: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    onMain { [weak self] in
      guard let self else { return }
      let locale = self.normalizedLocaleIdentifier(localeIdentifier)
      let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale))
      let permission = self.permissionPayload()
      let onDeviceAvailable = recognizer?.supportsOnDeviceRecognition ?? false
      resolve([
        "available": onDeviceAvailable || (recognizer?.isAvailable ?? false),
        "onDeviceAvailable": onDeviceAvailable,
        "locale": locale,
        "platform": "ios",
        "permission": permission,
      ])
    }
  }

  @objc(requestPermission:rejecter:)
  func requestPermission(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    onMain { [weak self] in
      guard let self else { return }
      self.requestSpeechPermission { [weak self] _ in
        guard let self else { return }
        self.requestMicrophonePermission { [weak self] _ in
          guard let self else { return }
          resolve(self.permissionPayload())
        }
      }
    }
  }

  @objc(start:locale:preferOnDevice:allowNetworkFallback:resolver:rejecter:)
  func start(
    _ sessionId: String,
    locale localeIdentifier: String,
    preferOnDevice: Bool,
    allowNetworkFallback: Bool,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    onMain { [weak self] in
      guard let self else { return }
      self.startOnMain(
        sessionId: sessionId,
        localeIdentifier: localeIdentifier,
        preferOnDevice: preferOnDevice,
        allowNetworkFallback: allowNetworkFallback,
        resolve: resolve,
        reject: reject
      )
    }
  }

  @objc(stop:resolver:rejecter:)
  func stop(
    _ sessionId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    onMain { [weak self] in
      guard let self else { return }
      guard self.activeSessionId == sessionId else {
        resolve(false)
        return
      }
      guard !self.stopRequested else {
        resolve(true)
        return
      }

      self.stopRequested = true
      self.sessionTimeoutTimer?.invalidate()
      self.sessionTimeoutTimer = nil
      self.stopAudioCapture(endRecognitionAudio: true)
      self.emitState(sessionId: sessionId, state: "processing")
      self.scheduleFinalResultTimeout(for: sessionId)
      resolve(true)
    }
  }

  @objc(cancel:resolver:rejecter:)
  func cancel(
    _ sessionId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    onMain { [weak self] in
      guard let self else { return }
      guard self.activeSessionId == sessionId else {
        resolve(false)
        return
      }
      self.cancelActiveSession(reason: "user-cancelled")
      resolve(true)
    }
  }

  @objc(destroy:rejecter:)
  func destroy(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    onMain { [weak self] in
      guard let self else { return }
      if self.activeSessionId != nil {
        self.cancelActiveSession(reason: "destroyed")
      } else {
        self.cleanupRecognitionResources(cancelTask: true)
      }
      resolve(true)
    }
  }

  private func startOnMain(
    sessionId rawSessionId: String,
    localeIdentifier: String,
    preferOnDevice: Bool,
    allowNetworkFallback: Bool,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let sessionId = rawSessionId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !sessionId.isEmpty else {
      reject("unknown", "sessionId 不能为空。", nil)
      return
    }
    guard activeSessionId == nil else {
      reject("busy", "已有语音识别正在进行。", nil)
      return
    }

    let speechPermission = SFSpeechRecognizer.authorizationStatus()
    let microphonePermission = AVAudioSession.sharedInstance().recordPermission
    guard speechPermission == .authorized, microphonePermission == .granted else {
      let code = permissionErrorCode(
        speech: speechPermission,
        microphone: microphonePermission
      )
      failBeforeStart(
        sessionId: sessionId,
        code: code,
        message: "请先允许麦克风和语音识别权限。",
        recoverable: code == "permission-denied",
        reject: reject
      )
      return
    }

    let locale = normalizedLocaleIdentifier(localeIdentifier)
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)) else {
      failBeforeStart(
        sessionId: sessionId,
        code: "language-not-supported",
        message: "当前设备不支持所选语音识别语言。",
        recoverable: false,
        reject: reject
      )
      return
    }
    guard recognizer.isAvailable else {
      failBeforeStart(
        sessionId: sessionId,
        code: "service-unavailable",
        message: "系统语音识别服务当前不可用。",
        recoverable: true,
        reject: reject
      )
      return
    }

    let onDeviceAvailable = recognizer.supportsOnDeviceRecognition
    let useOnDevice: Bool
    let usedNetworkFallback: Bool
    if preferOnDevice, onDeviceAvailable {
      useOnDevice = true
      usedNetworkFallback = false
    } else if allowNetworkFallback {
      useOnDevice = false
      usedNetworkFallback = preferOnDevice
    } else if onDeviceAvailable {
      // Network recognition is never enabled unless the caller explicitly opts in.
      useOnDevice = true
      usedNetworkFallback = false
    } else {
      failBeforeStart(
        sessionId: sessionId,
        code: "model-missing",
        message: "当前设备没有可用的本地中文语音模型，且未允许联网识别。",
        recoverable: false,
        reject: reject
      )
      return
    }

    activeSessionId = sessionId
    activeLocale = locale
    activeUsesOnDeviceRecognition = useOnDevice
    activeUsedNetworkFallback = usedNetworkFallback
    terminalEventDelivered = false
    stopRequested = false
    speechRecognizer = recognizer
    emitState(sessionId: sessionId, state: "starting")

    do {
      let audioSession = AVAudioSession.sharedInstance()
      try audioSession.setCategory(.record, mode: .measurement, options: [])
      try audioSession.setActive(true)

      let request = SFSpeechAudioBufferRecognitionRequest()
      request.shouldReportPartialResults = true
      request.taskHint = .dictation
      request.requiresOnDeviceRecognition = useOnDevice
      if #available(iOS 16.0, *) {
        request.addsPunctuation = true
      }
      recognitionRequest = request

      let engine = AVAudioEngine()
      let inputNode = engine.inputNode
      let inputFormat = inputNode.outputFormat(forBus: 0)
      guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
        throw SpeechRecognitionSetupError.invalidInputFormat
      }
      audioEngine = engine
      audioInputNode = inputNode

      recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
        self?.onMain { [weak self] in
          self?.handleRecognitionCallback(
            sessionId: sessionId,
            result: result,
            error: error
          )
        }
      }

      inputNode.installTap(
        onBus: 0,
        bufferSize: 1_024,
        format: inputFormat
      ) { [weak request] buffer, _ in
        request?.append(buffer)
      }
      audioTapInstalled = true

      engine.prepare()
      try engine.start()
      scheduleSessionTimeout(for: sessionId)
      emitState(sessionId: sessionId, state: "listening")
      resolve([
        "started": true,
        "sessionId": sessionId,
        "locale": locale,
        "onDevice": useOnDevice,
        "networkFallbackUsed": usedNetworkFallback,
      ])
    } catch {
      finishWithError(
        sessionId: sessionId,
        code: "audio",
        message: "无法启动麦克风，请稍后重试。",
        recoverable: true,
        nativeError: error
      )
      reject("audio", "无法启动麦克风，请稍后重试。", error)
    }
  }

  private func handleRecognitionCallback(
    sessionId: String,
    result: SFSpeechRecognitionResult?,
    error: Error?
  ) {
    guard activeSessionId == sessionId, !terminalEventDelivered else { return }

    if let result {
      let text = result.bestTranscription.formattedString
        .trimmingCharacters(in: .whitespacesAndNewlines)
      if result.isFinal {
        guard !text.isEmpty else {
          finishWithError(
            sessionId: sessionId,
            code: "no-speech",
            message: "没有识别到可用文字，请重试。",
            recoverable: true,
            nativeError: nil
          )
          return
        }
        terminalEventDelivered = true
        var payload = basePayload(sessionId: sessionId)
        payload["text"] = text
        if let confidence = averageConfidence(result.bestTranscription) {
          payload["confidence"] = confidence
        }
        emit(name: EventName.final, body: payload)
        emitState(sessionId: sessionId, state: "completed")
        activeSessionId = nil
        cleanupRecognitionResources(cancelTask: false)
        return
      }

      if !text.isEmpty {
        var payload = basePayload(sessionId: sessionId)
        payload["text"] = text
        if let confidence = averageConfidence(result.bestTranscription) {
          payload["confidence"] = confidence
        }
        emit(name: EventName.partial, body: payload)
      }
    }

    if let error {
      let mapped = mapNativeError(error)
      finishWithError(
        sessionId: sessionId,
        code: mapped.code,
        message: mapped.message,
        recoverable: mapped.recoverable,
        nativeError: error
      )
    }
  }

  private func failBeforeStart(
    sessionId: String,
    code: String,
    message: String,
    recoverable: Bool,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    emitError(
      sessionId: sessionId,
      code: code,
      message: message,
      recoverable: recoverable,
      nativeError: nil
    )
    emitState(sessionId: sessionId, state: "error", reason: code)
    reject(code, message, nil)
  }

  private func finishWithError(
    sessionId: String,
    code: String,
    message: String,
    recoverable: Bool,
    nativeError: Error?
  ) {
    guard activeSessionId == sessionId, !terminalEventDelivered else { return }
    terminalEventDelivered = true
    emitError(
      sessionId: sessionId,
      code: code,
      message: message,
      recoverable: recoverable,
      nativeError: nativeError
    )
    emitState(sessionId: sessionId, state: "error", reason: code)
    activeSessionId = nil
    cleanupRecognitionResources(cancelTask: true)
  }

  private func cancelActiveSession(reason: String) {
    guard let sessionId = activeSessionId else {
      cleanupRecognitionResources(cancelTask: true)
      return
    }
    terminalEventDelivered = true
    activeSessionId = nil
    emitState(sessionId: sessionId, state: "cancelled", reason: reason)
    cleanupRecognitionResources(cancelTask: true)
  }

  private func stopAudioCapture(endRecognitionAudio: Bool) {
    if audioEngine?.isRunning == true {
      audioEngine?.stop()
    }
    if audioTapInstalled {
      audioInputNode?.removeTap(onBus: 0)
      audioTapInstalled = false
    }
    if endRecognitionAudio {
      recognitionRequest?.endAudio()
    }
    audioInputNode = nil
    audioEngine = nil
    deactivateAudioSession()
  }

  private func cleanupRecognitionResources(cancelTask: Bool) {
    sessionTimeoutTimer?.invalidate()
    sessionTimeoutTimer = nil
    finalResultTimeoutTimer?.invalidate()
    finalResultTimeoutTimer = nil

    stopAudioCapture(endRecognitionAudio: true)
    if cancelTask {
      recognitionTask?.cancel()
    }
    recognitionTask = nil
    recognitionRequest = nil
    speechRecognizer = nil
    stopRequested = false
    activeUsesOnDeviceRecognition = false
    activeUsedNetworkFallback = false
  }

  private func deactivateAudioSession() {
    do {
      try AVAudioSession.sharedInstance().setActive(
        false,
        options: .notifyOthersOnDeactivation
      )
    } catch {
      // Cleanup must remain best-effort and must never retain microphone access.
    }
  }

  private func scheduleSessionTimeout(for sessionId: String) {
    sessionTimeoutTimer?.invalidate()
    sessionTimeoutTimer = Timer.scheduledTimer(
      withTimeInterval: Timing.maximumSessionDuration,
      repeats: false
    ) { [weak self] _ in
      self?.finishWithError(
        sessionId: sessionId,
        code: "no-speech",
        message: "语音识别超时，请重试。",
        recoverable: true,
        nativeError: nil
      )
    }
  }

  private func scheduleFinalResultTimeout(for sessionId: String) {
    finalResultTimeoutTimer?.invalidate()
    finalResultTimeoutTimer = Timer.scheduledTimer(
      withTimeInterval: Timing.finalResultTimeout,
      repeats: false
    ) { [weak self] _ in
      self?.finishWithError(
        sessionId: sessionId,
        code: "no-speech",
        message: "未能及时生成最终文字，请重试。",
        recoverable: true,
        nativeError: nil
      )
    }
  }

  private func emitState(
    sessionId: String,
    state: String,
    reason: String? = nil
  ) {
    var payload = basePayload(sessionId: sessionId)
    payload["state"] = state
    if let reason {
      payload["reason"] = reason
    }
    emit(name: EventName.state, body: payload)
  }

  private func emitError(
    sessionId: String,
    code: String,
    message: String,
    recoverable: Bool,
    nativeError: Error?
  ) {
    var payload = basePayload(sessionId: sessionId)
    payload["code"] = code
    payload["message"] = message
    payload["recoverable"] = recoverable
    if let error = nativeError {
      let nativeNSError = error as NSError
      payload["nativeDomain"] = nativeNSError.domain
      payload["nativeCode"] = nativeNSError.code
    }
    emit(name: EventName.error, body: payload)
  }

  private func basePayload(sessionId: String) -> [String: Any] {
    [
      "sessionId": sessionId,
      "locale": activeLocale,
      "onDevice": activeUsesOnDeviceRecognition,
      "networkFallbackUsed": activeUsedNetworkFallback,
    ]
  }

  private func emit(name: String, body: [String: Any]) {
    guard hasListeners else { return }
    sendEvent(withName: name, body: body)
  }

  private func averageConfidence(_ transcription: SFTranscription) -> NSNumber? {
    let segments = transcription.segments
    guard !segments.isEmpty else { return nil }
    let total = segments.reduce(Float(0)) { $0 + $1.confidence }
    return NSNumber(value: total / Float(segments.count))
  }

  private func normalizedLocaleIdentifier(_ rawValue: String) -> String {
    let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    return (trimmed.isEmpty ? "zh-CN" : trimmed).replacingOccurrences(of: "_", with: "-")
  }

  private func permissionPayload() -> [String: Any] {
    let speech = SFSpeechRecognizer.authorizationStatus()
    let microphone = AVAudioSession.sharedInstance().recordPermission
    let speechValue = speechPermissionValue(speech)
    let microphoneValue = microphonePermissionValue(microphone)

    let aggregate: String
    if speechValue == "granted", microphoneValue == "granted" {
      aggregate = "granted"
    } else if speechValue == "restricted" || microphoneValue == "restricted" {
      aggregate = "restricted"
    } else if speechValue == "denied" || microphoneValue == "denied" {
      // iOS does not show these system prompts a second time; Settings is required.
      aggregate = "blocked"
    } else {
      aggregate = "denied"
    }

    return [
      "status": aggregate,
      "canAskAgain": speechValue == "not-determined" || microphoneValue == "not-determined",
      "speechStatus": speechValue,
      "microphoneStatus": microphoneValue,
    ]
  }

  private func requestSpeechPermission(
    completion: @escaping (SFSpeechRecognizerAuthorizationStatus) -> Void
  ) {
    let status = SFSpeechRecognizer.authorizationStatus()
    guard status == .notDetermined else {
      completion(status)
      return
    }
    SFSpeechRecognizer.requestAuthorization { newStatus in
      DispatchQueue.main.async {
        completion(newStatus)
      }
    }
  }

  private func requestMicrophonePermission(
    completion: @escaping (AVAudioSession.RecordPermission) -> Void
  ) {
    let audioSession = AVAudioSession.sharedInstance()
    let status = audioSession.recordPermission
    guard status == .undetermined else {
      completion(status)
      return
    }
    audioSession.requestRecordPermission { _ in
      DispatchQueue.main.async {
        completion(AVAudioSession.sharedInstance().recordPermission)
      }
    }
  }

  private func speechPermissionValue(
    _ status: SFSpeechRecognizerAuthorizationStatus
  ) -> String {
    switch status {
    case .authorized:
      return "granted"
    case .denied:
      return "denied"
    case .restricted:
      return "restricted"
    case .notDetermined:
      return "not-determined"
    @unknown default:
      return "restricted"
    }
  }

  private func microphonePermissionValue(
    _ status: AVAudioSession.RecordPermission
  ) -> String {
    switch status {
    case .granted:
      return "granted"
    case .denied:
      return "denied"
    case .undetermined:
      return "not-determined"
    @unknown default:
      return "restricted"
    }
  }

  private func permissionErrorCode(
    speech: SFSpeechRecognizerAuthorizationStatus,
    microphone: AVAudioSession.RecordPermission
  ) -> String {
    if speech == .notDetermined || microphone == .undetermined {
      return "permission-denied"
    }
    if speech == .restricted || speech == .denied || microphone == .denied {
      return "permission-blocked"
    }
    return "permission-blocked"
  }

  private func mapNativeError(
    _ error: Error
  ) -> (code: String, message: String, recoverable: Bool) {
    let nativeError = error as NSError
    if nativeError.domain == NSURLErrorDomain {
      if nativeError.code == NSURLErrorTimedOut {
        return ("network", "网络识别超时，请检查网络后重试。", true)
      }
      return ("network", "系统联网语音识别不可用。", true)
    }
    if nativeError.domain == AVFoundationErrorDomain {
      return ("audio", "麦克风音频处理失败，请重试。", true)
    }
    if SFSpeechRecognizer.authorizationStatus() != .authorized ||
      AVAudioSession.sharedInstance().recordPermission != .granted {
      return ("permission-blocked", "语音识别权限已被关闭。", false)
    }
    return ("no-speech", "没有识别到可用文字，请重试。", true)
  }

  @objc private func applicationDidEnterBackground() {
    onMain { [weak self] in
      guard let self, self.activeSessionId != nil else { return }
      self.cancelActiveSession(reason: "app-backgrounded")
    }
  }

  @objc private func audioSessionWasInterrupted(_ notification: Notification) {
    guard
      let rawValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      AVAudioSession.InterruptionType(rawValue: rawValue) == .began
    else {
      return
    }
    onMain { [weak self] in
      guard let self, let sessionId = self.activeSessionId else { return }
      self.finishWithError(
        sessionId: sessionId,
        code: "audio",
        message: "录音被系统中断，请重试。",
        recoverable: true,
        nativeError: nil
      )
    }
  }

  private func onMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread {
      work()
    } else {
      DispatchQueue.main.async(execute: work)
    }
  }
}

private enum SpeechRecognitionSetupError: LocalizedError {
  case invalidInputFormat

  var errorDescription: String? {
    switch self {
    case .invalidInputFormat:
      return "当前设备没有可用的麦克风输入格式。"
    }
  }
}
