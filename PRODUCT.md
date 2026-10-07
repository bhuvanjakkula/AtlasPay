# AtlasPay sandbox product

## Run the product

Requires Node.js 24.7 or newer with native ML-KEM and ML-DSA support. Tested with Node.js 24.20.0. No package installation needed for the sandbox.

Double-click `Start-AtlasPay.cmd`, or run `node sandbox/server.mjs`.
Open http://127.0.0.1:8080. Stop the server with Ctrl+C.
Run checks: `npm run test:sandbox`. Customer workspaces, invoice uploads, checklists, reminders, batch planning, actual cost comparisons and a read-only Wise connector are documented in `docs/BUSINESS_FEATURES.md`.

## Delivered

Responsive treasury dashboard, six separately funded currency wallets, cross-currency quotes, simulated payments, review queue with fund reservations, double-entry source-currency payout journals, activity history, payment search/status filters, CSV export, saved recipient directory, statement reconciliation, native PQC receipts, encrypted business-record exports, key rotation and security self-tests. See `docs/PQC_SECURITY.md` for implementation details and limits.

Money uses integer minor units and BigInt calculations. JPY has zero decimal places. Quotes lock illustrative rates for two minutes. Idempotency keys survive restarts and conflicting payloads are rejected. A quote can produce only one payment. Each payment debits the sending wallet for principal plus fee; recipient amounts represent external simulated payouts. Transfers at or above USD 10,000 equivalent await explicit sandbox review. Pending review payments reserve principal and fee. Their available funds cannot be used by another payment. Approval consumes the reservation; rejection releases it. Only one sandbox operator exists; review is not independent dual-user approval.

State lives in `.sandbox/state.json`. Writes are serialized and replace the state file atomically. This is a single-process, local development store; it is not a production database. Store corruption stops startup instead of silently resetting funds. The server binds to loopback and requires its exact origin and session token for writes. Recipient text is escaped and CSV formula prefixes are neutralized.

## Technology foundation and next milestones

The original TypeScript/Fastify monorepo remains available as reference source. The running sandbox uses Node's HTTP and filesystem APIs and plain browser JavaScript/CSS. These are separate implementations; the starter API should not be deployed as the completed product.

1. Replace local persistence with PostgreSQL transactions, unique idempotency constraints, durable reservations and an outbox. Add FX clearing accounts and live-provider settlement reconciliation. The implemented JSON statement matching is a sandbox operations tool.
2. Extend the implemented local password accounts and isolated workspaces with verified organizations, team roles, passkeys/MFA, dual-control approval and append-only audit storage for production.
3. Select launch countries and licensed bank/payment partners; integrate provider-hosted business onboarding, verified KYC/KYB, sanctions screening, transaction monitoring and case management. Client-provided compliance flags in the starter API must not authorize real funds.
4. Integrate contracted FX pricing, provider delivery webhooks with replay protection, settlement state machines and reconciliation against bank statements.
5. Complete infrastructure hardening, secrets management, encrypted backups, disaster recovery drills, security review and performance testing before any live launch.

No provider credentials are bundled. The Wise status adapter requires per-workspace server configuration; actual money transfers still happen in the provider's app. Fixed FX rates and the review threshold are illustrative and make no claims about regulatory compliance. Customer login verifies a password, not identity or business ownership. The ledger does not implement bank custody or complete FX accounting. Local activity history is inspectable, not immutable.

External plans normally stay Awaiting external payment after a self-reported reference is recorded. An authenticated live Wise API check may report sent or failed; a sandbox response never establishes a real transfer. External plans do not debit demo balances. See `docs/BUSINESS_FEATURES.md` for exact limits and setup.
Release 0.5 adds team roles with independent external-plan approval, duplicate checks, accounting/journal CSV exports, recurring templates, forecasts, detailed history and verified snapshot recovery. See docs/WORKFLOW_RELEASE.md for usage, validation and limits.
Release 0.6 opens on Start here: guided onboarding, current workspace/role, provider connection status, per-payment next actions and explicit evidence labels. Setup progress is not regulatory or real-payment readiness. Email verification, password recovery and MFA remain future work.
Sign up now requires email ID, password and mobile number with country code. Existing accounts can add/update their mobile from the Sign up / Sign in account page. Sign in uses email and password. No email/SMS verification or OTP is enabled.
Release 0.7 adds password recovery, email-token verification, TOTP authenticator MFA and grouped navigation. Email delivery requires RESEND_API_KEY and ATLAS_EMAIL_FROM; otherwise developer outbox tokens are explicitly non-verifying. Mobile OTP and browser visual verification remain unconnected/unverified. See docs/ACCOUNT_SECURITY.md.
