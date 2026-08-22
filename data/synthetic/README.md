# Synthetic bookkeeping data

Central model data is synthetic-only. These files define contracts for future
LLM generation; generated rows are not real-user evidence and cannot authorize
silent auto-commit.

Datasets:

- `category_examples.jsonl`: nine-label classifier training/evaluation rows.
- `amount_parser_cases.jsonl`: deterministic amount parser tests only.
- `risk_ood_cases.jsonl`: special-funds and out-of-domain rejection cases.
- `e2e_bill_cases.jsonl`: full candidate-pipeline fixtures.

Every generated row must record generator model, prompt version, taxonomy
version, scenario family and split group. Training/validation/test splitting is
performed by `splitGroup`; related rewrites must never cross splits.

The frozen test set must be produced with a different prompt family (and,
preferably, a different model family) from training data. A judge model may
reject rows, but its judgment is not ground truth by itself. Deterministic
schema checks and a human audit sample remain release requirements.

Validate JSONL files with:

```powershell
node scripts/synthetic-data/validate-dataset.cjs data/synthetic/category_examples.jsonl category
```

The validator intentionally rejects unknown fields and labels.

## Reproducible generation pipeline

The checked-in runner currently supports Claude Code's non-interactive CLI.
Every invocation disables tools and session persistence, requests JSON Schema
output, divides a user-supplied total budget across all remaining batches, and
atomically checkpoints each validated batch. Generation never reads user data.

When no external model service is available, Codex can create the complete
release-sized corpus locally:

```powershell
pnpm synthetic-data:generate:codex
```

This path uses Codex-authored semantic templates and deterministic per-row
schema/semantic validation. The audit metadata says so explicitly: it is not an
independent LLM/vendor review and never substitutes for the required human
audit.

```powershell
pnpm synthetic-data:generate -- --kind category --output data/synthetic/work/category-training.raw.jsonl --count 27000 --batch-size 20 --model sonnet --max-budget-usd 120 --prompt-version training-v1

pnpm synthetic-data:review -- --kind category --input data/synthetic/work/category-training.raw.jsonl --output data/synthetic/work/category-training.reviewed.jsonl --audit data/synthetic/work/category-training.audit.jsonl --model opus --max-budget-usd 80
```

Generation targets are **accepted** row counts. Because the independent judge
will reject some rows, generate in resumable waves until the reviewed outputs
meet the matrix; do not lower the target to match the first pass.

Use a separate prompt family (and preferably a different generator model) for
the frozen set. Then deduplicate and split by `splitGroup`:

```powershell
pnpm synthetic-data:prepare -- --train-input data/synthetic/work/category-training.reviewed.jsonl --frozen-input data/synthetic/work/category-frozen.reviewed.jsonl --output-dir data/synthetic/prepared/category-v3
```

The prepared manifest records row counts and SHA-256 hashes. Never regenerate
or inspect the frozen test set while tuning prompts/models; replace it only as a
versioned evaluation release. LLM review is a filter, not proof of correctness:
release gates still require deterministic tests and a documented human audit
sample.

Each release audit file must contain one decision for every accepted row. An
external LLM review uses `independent-review-v1` and a reviewer model different
from `generatorModel`; the Codex-local path instead declares
`deterministic-review-v1` and `DETERMINISTIC_VALIDATOR`. These modes are never
presented as equivalent evidence. In both cases, the final human audit must include
`attestation: "HUMAN_REVIEWED"` and the exact prepared manifest SHA-256 so an
old sign-off cannot be reused after regenerating data.

`pnpm synthetic-data:release-gate` fails closed until all accepted row targets,
hashes, auxiliary datasets, and a passing audit of at least 450 sampled rows are
present. This prevents a toy or partially generated corpus from being promoted.
