# Import adapter boundary

This directory is reserved for adapters that normalize external sources such as Android notifications, iOS shares, OCR, and statement files into a shared transaction candidate.

Adapters must not execute SQL or silently save ambiguous records. Fingerprinting, duplicate checks, confidence evaluation, and save-or-confirm decisions remain downstream shared services.

No importer is implemented in stage 1.
