# Database layer

Stage 2 uses OP-SQLite through the project-owned `DatabaseConnection` interface. UI and feature modules must depend on repositories rather than importing OP-SQLite or issuing SQL directly.

## Startup

`getAppDatabase()` lazily opens one app-wide connection, applies connection PRAGMAs, and runs all pending migrations. `closeAppDatabase()` is reserved for teardown, database replacement, and restore workflows.

## Migrations

- Every schema change adds a new immutable, ascending migration in `migrations/`.
- Each statement is separate because native `execute()` processes one prepared statement.
- Each migration and its `schema_migrations` record run in the same transaction.
- Existing migration versions must never be edited after release.
- `PRAGMA user_version` mirrors the newest applied migration.

Current versions:

- v1 creates the ledger and reference-data schema.
- v2 seeds the documented category taxonomy and default accounts.
- v3 adds personalization settings, rule provenance, feedback processing state,
  and learned-rule deletion suppression without rebuilding existing ledgers.

## Persistence rules

- Money is stored as integer minor units.
- Transaction reads exclude soft-deleted rows unless explicitly requested.
- Foreign keys are enabled for every connection.
- Repository writes use transactions.
- Corrected transaction, tags, feedback, and a possible learned-rule promotion
  are committed atomically.
- Entity display names are never used as database identifiers.
