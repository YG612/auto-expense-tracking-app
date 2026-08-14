# QingJi bill category classifier model card

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
