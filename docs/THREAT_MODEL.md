# Threat model
Assets: KYB data, bank tokens, payment instructions, ledger integrity, signing keys, sanctions decisions, audit trail.
Threats: account takeover, insider abuse, compromised provider/webhook, supply chain, injection/SSRF, replay/double-spend, exfiltration, harvest-now-decrypt-later.
Controls: phishing-resistant MFA, RBAC/ABAC, four-eyes approvals, mTLS/private provider links, strict schemas, egress allowlists, webhook verification, replay defense, idempotency, append-only ledger/audit, KMS/HSM envelope encryption, short-lived workload identity, SAST/SCA/SBOM/signing, restore drills, anomaly/velocity rules, kill switches.
