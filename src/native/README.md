# Native adapter boundary

Typed speech contracts and the replaceable platform adapter live in `src/speech/`. The matching native module is named `SpeechRecognition` and is implemented under the Android and iOS projects. Native code emits session-scoped state, partial text, final text, and stable errors; it never classifies or persists a transaction.

Only final, non-empty speech text enters the shared TypeScript parser. Partial text remains transient UI state, and raw audio is never represented as a file, URI, Base64 value, database field, or JavaScript payload. A network-capable system recognizer can only be selected after explicit user consent when on-device recognition is unavailable.

The Android `PaymentNotificationCapture` module exposes only bounded events from the allow-listed WeChat and Alipay package names after the user grants notification-listener access. Its queue is memory-only and capped; it does not write SQLite, classify a transaction, or send notification content to a server. Source events flow through `src/importers/paymentNotification.ts`, shared merchant classification, repository duplicate detection, and the pending-confirmation policy before persistence.

Android notification and iOS share/OCR adapters remain separate from speech and follow the same minimized-event boundary.
