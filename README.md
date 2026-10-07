# Runnable sandbox product

Start with `node sandbox/server.mjs` or double-click `Start-AtlasPay.cmd`. Open http://127.0.0.1:8080. Read PRODUCT.md for delivered features, tests, and live-launch milestones.

---

# AtlasPay — Global Payment OS
Security-first reference monorepo for a US-based global fintech: payment intents, routing, compliance gates, double-entry ledger primitives, FX/provider abstractions, reconciliation, auditability, and crypto-agile/PQC interfaces.

> Development/reference software only. It is not a bank, money transmitter, compliance certification, or authorization to move funds. Real rails remain behind adapters until licensing, bank sponsorship, legal review, security assessment, and provider onboarding are complete.

## Flow
`client → API → idempotency/auth → compliance → route planner → provider → ledger → reconciliation/audit`

## Run
```bash
cp .env.example .env
docker compose up -d
npm install
npm test
npm run dev
```
API: `http://localhost:8080`; health: `/health`; PQC policy: `/v1/security/crypto-policy`.

## Security
Deny-by-default compliance; integer minor units; balanced journals; idempotency; strict schemas; replay-resistant webhook helper; provider isolation; secrets/KMS boundary; non-root container; CI; threat model. PQC primitives are **not reimplemented** here: production must use a validated implementation/HSM/KMS for NIST ML-KEM and ML-DSA.

