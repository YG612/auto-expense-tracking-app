# Native adapter boundary

Typed speech contracts and the replaceable platform adapter live in `src/speech/`. The matching native module is named `SpeechRecognition` and is implemented under the Android and iOS projects. Native code emits session-scoped state, partial text, final text, and stable errors; it never classifies or persists a transaction.

Only final, non-empty speech text enters the shared TypeScript parser. Partial text remains transient UI state, and raw audio is never represented as a file, URI, Base64 value, database field, or JavaScript payload. A network-capable system recognizer can only be selected after explicit user consent when on-device recognition is unavailable.

The future Android notification module must expose only a minimized, allow-listed source event. It must not write to SQLite, classify a transaction, or send unrelated notification content to a server. Source events will flow through an importer adapter, shared classification, duplicate detection, and confirmation policy before persistence.

Future Android notification and iOS share/OCR adapters must remain separate from speech and follow the same minimized-event boundary.
