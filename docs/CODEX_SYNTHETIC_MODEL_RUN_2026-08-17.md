# Codex synthetic model run — 2026-08-17

## Outcome

Codex generated two complete synthetic-only corpus versions and trained two
unified nine-label fastText candidates. Candidate 1 was rejected at 97.78%
frozen high-confidence precision. After treating that frozen result as
development feedback, Codex generated a new prompt family and sealed frozen set.
Candidate 2 passed the algorithmic release gates at 99.02% high-confidence
precision. No shadow activation or automatic bookkeeping commit was enabled.

## Data produced

| Dataset                     | Accepted rows |
| --------------------------- | ------------: |
| Category development source |        31,500 |
| Category train split        |        27,000 |
| Category validation split   |         4,500 |
| Category frozen test        |         9,000 |
| Risk and OOD                |         8,000 |
| Amount parser               |         3,000 |
| End-to-end candidates       |         4,500 |
| Total accepted source rows  |        56,000 |

The category preparation pass found zero exact or approximate duplicates. Split
groups are assigned by SHA-256, and the frozen prompt family is disjoint from
the development prompt family.

The corpus uses Codex-authored semantic templates with deterministic expansion
and validation. It does not claim independent LLM or human review. Generated
JSONL files remain local and reproducible; schemas, generator code and audit
rules are versioned.

## Candidate 1 result

- Model version: `3.0.0-codex-candidate.1`
- Quantized model size: 333,125 bytes
- Validation: 100% accuracy and 100% accepted precision
- Frozen overall accuracy: 97.81%
- Frozen macro F1: 97.98%
- Frozen accepted precision: 97.78% — **gate failed**
- Frozen coverage: 99.76%
- Frozen minimum label recall: 89.5%
- Risk/OOD false accepts after deterministic prefilter: 0 / 8,000
- Automatic commits from risk/OOD cases: 0

The gap between perfect synthetic validation and the failed frozen precision
gate is evidence that template-like validation is too optimistic. The frozen
result was not tuned against row by row; it became development feedback for a
new corpus and newly sealed frozen set.

## Candidate 2 result

- Model version: `3.0.0-codex-candidate.2`
- Quantized model size: 344,770 bytes
- Validation: 100% accuracy and 100% accepted precision
- All eight required validation/risk error slices populated and passed
- Frozen overall accuracy: 98.80%
- Frozen macro F1: 98.88%
- Frozen accepted precision: 99.02% — **algorithmic gate passed**
- Frozen coverage: 99.63%
- Frozen minimum label recall: 94.9%
- Risk/OOD false accepts: 0 / 8,000
- Automatic commits from risk/OOD cases: 0

Passing on LLM-synthetic data is not a production claim. It permits device
benchmarking and human audit; it does not permit shadow activation by itself.

## Defect found and fixed

The initial evaluation runner sent special-fund and OOD text directly to the
category classifier. It accepted 7,062 of 8,000 risk cases. A deterministic
prefilter now rejects transfers, refunds, reimbursements, debt movements,
stored-value recharge and text without transaction evidence before model
inference. Dedicated tests cover this boundary.

The first generated development corpus also populated only two of six category
error-slice scenario tags. The generator has been fixed so future corpus
versions cover all required slices. The consumed candidate data and frozen
evidence were left immutable; therefore the current candidate's error-slice
report remains failed rather than being retroactively rewritten.

## Release blockers

1. A real person must audit at least 450 stratified samples and create
   `data/synthetic/reviewed/codex-v2/human-audit.json` bound to the prepared
   manifest.
2. Collect hash-bound Android and iOS device latency/memory/golden-vector
   evidence.
3. Run model selection. Only a passing winner may receive a separately authored
   A3 approval and enter shadow mode.

## Android device benchmark

Candidate 2 was installed as a separately identified `BENCHMARK_ONLY` Internal
build on an authorized OnePlus 9R (LE2100). This mode is bound to the candidate
manifest, frozen evaluation, error-slice report and frozen lock hashes. It
forces `allowAutoCommit=false` and is not shadow approval.

- Android/Windows golden vectors: 100/100 exact outcome matches
- Android ARM64 p95 core inference latency: 0.013334 ms
- Baseline PSS: 1.3086 MB
- Candidate PSS: 2.3828 MB
- Extra peak PSS: 1.0742 MB
- Candidate Internal APK SHA-256:
  `47E0818C9769DDCE15409894D9D6550D5E9B9979164135AE707DAF0529AFF369`
- Baseline Internal APK SHA-256:
  `B475D927DE7973BA4136A027BC54BD0F950795E2977F33FA6C8CC6A8D4E09FCE`
- Reported APK delta: 0 bytes (the unified model replaces a larger legacy
  15-model payload)

Device work uncovered and fixed two build-evidence defects: Windows PowerShell
5 did not support `Path.IsPathFullyQualified`, and placing benchmark outputs in
the Android asset root recursively packaged evidence/APK files. Model assets and
runtime evidence now use separate directories.

## Android USB agent E2E

The installed candidate build also passed the destructive-write agent contract
over USB with an explicitly acknowledged synthetic pending record:

- first submission: `COMMITTED`
- exact retry: `ALREADY_COMMITTED`
- same idempotency key with a changed payload: `REJECTED` with
  `AGENT-IDEMPOTENCY-PAYLOAD-MISMATCH`
- request key:
  `9d5dd0239a70727bdaf2eb539b491149e8c4b975d14df8d0920a7795d42f4eec`
- transaction ID: `agent-pending-msx33ic2-1-1rjg27q`
- persistence check after a forced app restart: one pending record remained
- cleanup check: the synthetic record was removed from the pending inbox and
  the inbox returned to `0` records

The product implements deletion as a recoverable soft delete, so the synthetic
record remains visible in the recycle bin and was not removed by bypassing the
application's supported UI.

## Human-audit preparation

`outputs/01a00105-cb43-7880-85e6-97e7021468ae/QingJiAI_Codex_v2_人工审计_450条.xlsx`
contains the required 450-row stratified review set: 360 category, 40 risk/OOD,
20 amount and 30 end-to-end samples. Its summary and sign-off pages bind the
prepared-manifest SHA-256
`b13917cd175aecc856b58da619fa828006d428f3692fd06bf25abce546944ec6`.
The workbook intentionally remains `INCOMPLETE`; reviewer identity, date and
`HUMAN_REVIEWED` proof are blank and must be completed by a real auditor.

The completed workbook can be converted only after an explicit human-review
acknowledgement. The converter verifies all 450 decisions, zero failed rows,
the reviewer name/date, `HUMAN_REVIEWED`, workbook formulas and both prepared
manifest hashes before atomically writing `human-audit.json`.

## iOS and selection handoff

The iOS native module now contains a physical-device-only benchmark entrypoint.
It refuses Simulator, non-`BENCHMARK_ONLY` assets and already-loaded classifier
state. A macOS orchestration command stages immutable assets, builds and installs
the app, copies the 100-vector input into the sandbox, launches with the explicit
benchmark argument, retrieves golden/memory evidence and validates all hashes.

The runtime report protocol was corrected to avoid three impossible release
flows discovered during the handoff audit:

- selection-time evidence now requires `BENCHMARK_ONLY`, not a post-selection
  shadow receipt;
- the portable candidate APK is supplied explicitly instead of relying on an
  absolute build-machine path from the Android receipt;
- candidate-manifest and staged benchmark-manifest hashes are recorded
  separately and cross-bound during model selection.

Algorithmically failed candidates may remain in the selection report without a
runtime report, so they no longer prevent a passing candidate from being
evaluated.

## Shadow observation and final evidence chain

The App records privacy-minimal model observations only after a user confirms a
transaction produced by a `SHADOW` model. The table excludes source text,
amount and account data, is idempotent per transaction, and cascades when the
ledger row is deleted. Settings exposes an explicit JSONL share action only
when observations exist.

The evaluator enforces 500 observations across seven calendar days, at least 20
predictions per enabled label, a 99% match rate, a 98% Wilson 95% lower bound,
100 ms p95 latency and zero automatic commits. A final immutable readiness
report rechecks these metrics and binds the human audit, prepared manifest,
runtime report, model selection, A3 approval, shadow activation, staged assets
and observation report. It reports readiness but does not deploy or enable
automatic commits.

The selection orchestrator now writes `MODEL_SELECTION_COMPLETE.json`; this
closes a previously missing hash link between the human audit and A3 approval.
The approval request generator always outputs a pending template and refuses to
name it `A3_SELECTION_APPROVED.json`.

The final ordinary Internal APK was rebuilt, safely installed over the existing
internal app while preserving its data, and launched on the OnePlus 9R. The app
process remained running. APK SHA-256:
`4BA30610F2054989E4C61B2C13489118ECE0B54DECA78BFF9967789F1AFD23D2`.
The privacy-minimal device receipt is stored outside the repository under
`D:\CodexData\TestEvidence\QingJiAI\20260817-194230`; it contains no device
serial, ledger text, logcat or raw audio. Manual UI regression items remain
explicitly marked `NOT_RUN` rather than being inferred from process liveness.

## Verification completed

- TypeScript typecheck and ESLint: pass
- Jest: 105 suites, 934 tests: pass
- CLI: 8 tests: pass
- MCP: 7 tests: pass
- Synthetic data pipeline: 14 tests: pass
- Model pipeline: 15 tests: pass
- Native legacy and unified core smoke tests: pass
- Android Debug offline build: pass
- APK SHA-256:
  `484E56E95F23D57F9ABD9A0A4F7FA03E998D4E918FC107B3E37055237867427D`
