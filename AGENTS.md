# AGENTS.md

React Native 0.86 (React 19, TS 5.9) app "轻记 AI" — a local-first expense tracker. The long, authoritative project doc is `README.md` (Chinese); `src/*/README.md` document the database, native, and importer boundaries. No CI, no `opencode.json`, and no other instruction files exist — quality checks are local only.

## Commands

- Install: `pnpm install --frozen-lockfile` (pnpm only; `nodeLinker: hoisted` in `pnpm-workspace.yaml` is required for RN native autolinking — never switch to npm/yarn or a non-hoisted linker).
- Full verification, in this order: `pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test:ci` (`jest --runInBand`). Auto-format with `pnpm format` (Prettier).
- Single test: `pnpm test <path>` (plain `test` runs jest in parallel; `test:ci` forces `--runInBand`, which the DB tests need).
- Android only via Windows scripts (below); iOS builds only on macOS (`bundle exec pod install --project-directory=ios`, open `ios/QingJiAI.xcworkspace`).

## Testing quirks

- Jest runs against real SQLite through OP-SQLite's Node façade, mapped in `jest.config.js` to `node_modules/@op-engineering/op-sqlite/node/dist/index.js`. There are no handwritten SQLite mocks. `better-sqlite3` is a build-only dep for Jest.
- App-level tests live in `src/tests/`; database tests in `src/tests/database/`. DB tests use `openMigratedTestDatabase()` (in-memory), which pins the migration clock to `2026-07-20` — don't rely on "now" in migration tests.
- Don't add dependencies on test snapshots; existing tests use assert/query patterns (see `src/tests/database/repositories.test.ts`).

## Architecture constraints (enforced, not optional)

- UI and features call repositories only — never OP-SQLite/SQL directly. Database layer is `src/database/` (`getAppDatabase()` singleton in `src/database/index.ts`).
- Money is stored as integer minor units (cents), never floats. Shared logic (amounts, transaction types, stats, classification, dedup) lives in shared TS under `src/domain/` and `src/classification/`.
- Native Kotlin/Swift modules (`SpeechRecognition` under `android/` and `ios/`) only emit minimal DTOs and never classify or persist transactions. `src/importers/` is a reserved boundary for future notification/share/OCR adapters — nothing implemented yet.
- `src/screens/` re-exports feature screens; implementations live in `src/features/*`. App entry: `src/app/App.tsx` → `DatabaseProvider` → `RootNavigator`.

## Migrations

- Append-only, immutable, ascending versions in `src/database/migrations/` (current schema v3). Never edit a released migration; add a new one.
- Each migration is `{ version, name, statements[] }`; one prepared statement per element (native `execute()` processes a single statement each). Migration + its `schema_migrations` record commit in one transaction. `PRAGMA user_version` mirrors the newest applied version.

## Windows Android build quirks

- `pnpm android:assemble:windows` / `android:assemble:release:windows` / `android:verify:release:windows` wrap `scripts/android-build-windows.ps1`, which temp-subst's the repo to drive `Q:` for Gradle/Kotlin/CMake incremental-cache stability while Metro/Hermes use the real path. These are Windows-only; don't substitute `Q:` yourself.
- Android SDK/Gradle caches must be on `D:`; the script falls back to `D:\CodexData`. Requires SDK Platform 36, build-tools 36.0.0, NDK/CMake, JDK 17. One-time env setup: `scripts/android-env-setup.ps1`.
- Debug APK has no embedded JS bundle: needs Metro running + `adb reverse tcp:8081 tcp:8081`; verify standalone launch with the Release APK (`android/app/build/outputs/apk/release/app-release.apk`). Release builds still use the template debug keystore — not a store build.
- `android/local.properties` (sdk.dir) is gitignored.

## Environment gotchas

- `.env` is NOT auto-loaded; `.env.example` is only a future contract. Never put API keys in `.env` or client code (APKs can be decompiled) — keys belong server-side.
- SQLite is opened once per app process via `getAppDatabase()`. `closeAppDatabase()` exists only for teardown/restore workflows.
- No audio is ever persisted: speech surfaces final non-empty text only into `parseTextTransactions`, on-device recognition is preferred, and any network-capable fallback requires explicit user consent. An explicitly chosen engine is remembered in SQLite (`personalization_settings.preferred_speech_engine_id`) and auto-reused on later sessions until it fails at the engine level.
