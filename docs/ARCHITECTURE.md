# Architecture
Bounded contexts: identity/tenancy, KYB, compliance, orchestration, routing, FX/treasury, ledger, provider connectivity, reconciliation, audit.

Payment state machine: `created -> screening -> review|route_selected -> submitted -> accepted -> settled|returned|failed`.

Every external side effect requires idempotency. Callbacks must be authenticated and replay-protected. Ledger corrections are append-only.

## PQC
Use a crypto-agile provider interface. Production uses validated vendor/library/HSM implementations for FIPS 203/204, algorithm/version metadata, key inventory, rotation and migration playbooks. Do not implement lattice cryptography in application code.
