# Importer boundary

Importers normalize untrusted external input into versioned TypeScript candidates. They never execute SQL or confirm a transaction. `StatementImportRepository` applies local merchant classification, duplicate checks, atomic audit writes, and creates only `PENDING` transactions.

- `statementCsv.ts` and `statementXlsx.ts` detect official WeChat/Alipay exports from provider markers and filenames. Official mappings are automatic; unknown tabular exports can use explicit column mappings.
- `paymentNotification.ts` accepts only the minimized Android DTO from the native allow-list, requires an explicit settled-payment cue and a currency amount, and ignores unrelated notifications.
- Raw statement files and notification text are not persisted. Import records retain only bounded metadata and a SHA-256 content/reference hash.
- Merchant classification priority is enabled personal rule, merchant dictionary, then reliable merchant-name evidence. A suggestion is applied only when its category direction is compatible with the transaction type.
- Every imported candidate remains editable and pending. Definite duplicates are skipped; possible duplicates are visibly flagged for review.

Payment notifications are best-effort and are not an official provider synchronization API. Historical completeness must come from official bill-file import.
