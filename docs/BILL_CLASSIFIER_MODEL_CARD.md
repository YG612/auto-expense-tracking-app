# QingJi bill category classifier model card

> Production note (2026-08-17): the bundled asset described below remains the
> compatibility bootstrap. The codebase now contains the v3 single-head,
> nine-label training/evaluation/runtime path, but no v3 weights have been
> promoted because the LLM-only dataset release gate is not yet satisfied.

## Model

- ID: `qingji-bill-category-fasttext`
- Version: `0.1.0-bootstrap`
- Runtime: fastText 0.9.2 at commit `5b5943c118b0ec5fb9cd8d20587de2b2d3966dfe`
- License: application-owned model weights; fastText runtime is MIT
- Payload: 15 quantized `.ftz` heads, approximately 1.92 MiB total
- Taxonomy: seed taxonomy version 2, using stable `system_key` labels

## Intended use

The model proposes a parent category and, when sufficiently confident, an
expense subcategory for a single ordinary expense or income clause. It runs
entirely on the device. It does not determine amounts, dates, accounts,
transaction nature, confirmation, or persistence.

The TypeScript policy only invokes it after deterministic transaction parsing.
Explicit semantics, user rules, learned merchant rules, merchant dictionaries,
special transaction types, ambiguity, and alternatives take precedence. Every
accepted bootstrap-model suggestion carries a review advisory and cannot enter
the direct-confirm path.

## Training data

This bootstrap asset is reproducibly generated from the application's seeded
category names, hand-authored generic aliases, and neutral transaction
templates. It contains no user text or external personal data. Run:

```powershell
node scripts/bill-classifier/train-models.cjs
```

The generator emits 2,352 examples. Labels are trained hierarchically: one
expense parent model, one income model, and one child model per expense parent.
Numbers, dates, order identifiers, and account channels are placeholders.

## Limitations

This is a bootstrap model, not a model that has passed the production blind-test
gates in the research plan. Template-like phrases are represented better than
unseen conversational wording. The conservative parent threshold (0.82) and
margin (0.18) intentionally produce abstentions. A child is emitted only above
0.78 confidence and 0.15 margin.

Do not describe this version as production-validated AI accuracy. Before a
future version can relax review or expand coverage, it must pass the frozen,
merchant/user-grouped evaluation protocol in
`docs/ON_DEVICE_BILL_CLASSIFICATION_RESEARCH_2026-08-14.md`.

## Safety and privacy

- Runtime code performs no network calls and requests no permission.
- Android copies verified assets to `noBackupFilesDir`; iOS verifies bundled
  resources in place. Both validate manifest sizes and SHA-256 values.
- Model input is capped at 500 characters and replaces volatile identifiers.
- Loading, verification, inference failure, timeout, and abstention all fall
  back to the existing deterministic classification result.
- The native layer cannot access SQLite and cannot persist a transaction.

## Reproducibility

`models/bill-classifier/manifest.json` locks every model file by size and
SHA-256. `scripts/bill-classifier/verify-model-assets.cjs` checks the full set,
payload budget, taxonomy identity, provenance, notice, and SBOM.

## Version 3 candidate protocol

The next model has exactly nine labels: one `income` label and eight expense
labels (`food`, `transport`, `shopping`, `housing`, `entertainment`,
`healthcare`, `education`, `other_expense`). Amount remains deterministic and
outside the classifier. New UI surfaces expose only income/expense and an
expense primary category; historical detailed transaction types remain
readable for compatibility and risk analytics.

The v3 pipeline:

1. generates LLM-only JSONL with strict schemas and provenance;
2. performs a session-isolated judge pass, deterministic validation,
   NFKC/exact/approximate deduplication, and split-group isolation;
3. holds the frozen prompt family out of all tuning;
4. competes three fastText configurations, fits temperature calibration, and
   selects per-category confidence/margin thresholds at at least 99% validation accepted
   precision;
5. fails closed unless the 9,000-case frozen set, per-label, calibration,
   latency, coverage, and special-funds safety gates all pass.

Candidate output is written below `build/model-candidates`; it is not copied to
the bundled model directory. Android, iOS, and the desktop host runtime accept
both the current schema-v1 manifest and a future schema-v2 manifest. When v2 is
present they load only `category-v3.ftz` and do not emit a subcategory.

A schema-v2 candidate cannot be loaded directly. After selection, a separately
authored A3 approval is verified and `stage-shadow-model.cjs` creates an
immutable shadow asset root. Its manifest binds the selection and activation
SHA-256 values and fixes `allowAutoCommit=false`. Android Internal builds can
select that root with `-BillClassifierAssetsRoot`; ordinary builds continue to
use the checked-in compatibility assets.

Before selection, both Android and iOS use immutable `BENCHMARK_ONLY` assets.
Runtime evidence binds the original candidate manifest, the transformed
benchmark manifest, portable candidate APK, Android build receipt, physical iOS
device evidence and Android/iOS/host golden vectors. Shadow receipts are
deliberately rejected at this stage to prevent approval from preceding model
selection.

The selection completion receipt binds the human audit and prepared dataset to
the runtime and selection reports. A3 approval, shadow activation, staged
manifest, privacy-minimal observation export, seven-day observation report and
final release-readiness receipt extend that hash chain. None of these steps
enables automatic commits.
