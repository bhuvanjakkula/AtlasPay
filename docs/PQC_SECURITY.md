# PQC implementation and boundaries

## Working cryptography

This sandbox uses the installed Node/OpenSSL implementation through `node:crypto`. No lattice primitive is implemented in application code. Tested on Node.js 24.20.0; requires Node.js 24.7 or newer with ML-KEM/ML-DSA support. Startup fails if required primitives are unavailable; there is no classical-only fallback.

Every completed payment receives two signatures over the same domain-separated, canonical JSON payload: ML-DSA-65 and Ed25519. Verification requires both. The payload covers payment identity, original quote, status and associated ledger journal. Inventory verification also compares the signed payload to current payment and journal contents. Legacy completed payments are attested on their first upgraded startup: this establishes a migration baseline, not proof of their earlier history.

Encrypted archives encapsulate a fresh secret using ML-KEM-768, derive a 256-bit encryption key with HKDF-SHA384, and encrypt canonical business records with AES-256-GCM. Random salt and nonce are generated per export. Envelope metadata is authenticated as additional data; the entire envelope also receives both receipt signatures. This is a PQC KEM envelope, not a hybrid classical/PQC KEM protocol or a standards-certified application protocol.

References: [Node 24 crypto API](https://nodejs.org/docs/latest-v24.x/api/crypto.html), [NIST FIPS 203](https://csrc.nist.gov/pubs/fips/203/final), [NIST FIPS 204](https://csrc.nist.gov/pubs/fips/204/final).

## Key lifecycle and trust

Private keys are generated locally into `.sandbox/keyring.json`; they never appear in API responses, downloads, or packaged project ZIPs. Keys rotate manually in the security center. Prior keys remain available to verify receipts and decrypt earlier archives. Rotating keys does not re-sign old receipts or re-encrypt old archives. Public keys and SHA-384 fingerprints are visible for inspection. Public keys included in a receipt or export are not independent proof of identity: recipients must obtain and pin trusted keys through a trusted channel.

The keyring file requests POSIX mode 0600. Windows permissions follow filesystem ACL behavior; this application does not configure an exclusive Windows ACL. Private keys are plaintext on disk. Protect access to the local workspace and retain the original keyring securely; deleting it loses export decryption capability. The distributed ZIP excludes all `.sandbox` data and keys.

## Inspect and decrypt an export

Use **PQC security → Download encrypted archive**. To decrypt using your original trusted keyring:

```
node sandbox/decrypt-export.mjs atlaspay-pqc-archive.json .sandbox/keyring.json decrypted-records.json
```

The CLI checks both signatures against that keyring, checks the signed envelope matches, authenticates/decrypts it, and creates a new output file. It refuses to overwrite existing output. It does not restore wallets. Export contains business records, not a full disaster-recovery backup: idempotency records and active quotes are omitted. Securely archive the operational state and keyring separately if recovery is needed.

## Limits

PQC protects signed receipt evidence and encrypted exports. Local operational state stays in plaintext JSON. Private keys are held by the same local process that signs receipts. A compromised process or keyring can forge new signatures. Signatures do not establish operator identity, authorization, trusted time, audit completeness, or rollback protection. The audit list itself is not append-only or hash-chained.

Transport is loopback HTTP. Local password accounts now isolate customer workspaces, but do not verify business identity. This implementation does not enable PQC TLS, end-to-end browser encryption, verified organizations, dual-user approval, HSM/KMS custody, or FIPS 140 module validation. Standardized algorithm names do not certify the module or product. Real fund execution and verified compliance remain outside the sandbox.

Production milestones: authenticated tenant and role boundaries, segregated signing service and KMS/HSM, independently pinned key distribution and revocation, transactional database and immutable audit storage, reviewed cryptographic protocol, TLS deployment, penetration testing and operational recovery controls.
