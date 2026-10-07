# Business operations release 0.4

## What to use in the sidebar

- **Customer accounts:** create a business workspace, sign in and sign out. Each account gets its own sandbox wallets, quotes, recipients, payment plans, invoices, costs, reminders and batches. The original Northstar data stays in the local demo workspace.
- **Payment operations:** choose an external payment, record the four pre-payment checklist decisions, attach an invoice, set or snooze a reminder, and enter actual provider fees and recipient amount. The comparison shows fee and received-amount differences plus effective FX rate. Recorded actual figures remain self-reported.
- **Batch planning:** enter up to 50 recipients in a payment run. The entire run commits together or fails without creating partial plans. Retrying with the same idempotency key returns the existing batch. No demo balances are debited. Review each plan's checklist before sending with its provider.
- **Provider connections:** inspect configuration and check an existing Wise transfer by transfer ID and recipient account ID. No transfer is created or funded by this adapter.

The handoff dialog requires a pre-payment checklist before offering its provider link. Saved batch plans begin with an unchecked checklist; complete it in Payment operations. This records your declarations, not automated bank-detail or invoice verification.

Reminders are in-app only. The sidebar count refreshes once per minute while the browser is open. The operations list refreshes when reopened, after a save, or with its Refresh reminders button. A reminder becomes overdue only for a plan still awaiting external payment. No email, desktop notification or scheduled background task is sent.

Invoices accept PDF, PNG, JPEG and UTF-8 TXT, up to 500 KiB each, with at most 100 per workspace. Filename and file header/encoding checks reject unsupported content. Files are downloaded as attachments rather than executed or rendered inline. They are SHA-384 hashed for inspection; there is no malware scanner. Invoice content is included in PQC-encrypted exports, but local storage remains plaintext.

## Accounts and local storage

Account passwords require 12–128 characters and are salted and hashed with Node's scrypt. Login sessions use random HttpOnly, SameSite=Strict cookies, expire after eight hours and disappear on server restart. Account registration does not verify email ownership. There is no password reset, MFA, team membership, role management or live KYC. One business workspace is assigned to each account.

The server derives workspace access from its session, never a client-supplied workspace ID. API state omits password hashes, idempotency records and invoice content. Attachment downloads and all payment mutations resolve inside that workspace. Default unsigned visitors use the shared local demo; it is not private customer data. This loopback development server is not configured for public hosting or production authentication. Customer API secrets must be configured independently for their workspace.

State lives in `.sandbox/state.json` for the original demo and `.sandbox/workspace-<account-id>.json` for customer accounts. `.sandbox/accounts.json` holds the password hashes. The PQC signer/keyring is shared by the local service; key rotation remains available only in the local demo administrator context. Never publish these files. Retain the operational files and keyring for recovery. The download package excludes them.

## Wise read-only connector setup

The **Provider connections** page shows the current workspace ID. Before starting the server, set `ATLAS_WISE_CONNECTIONS` to a JSON mapping with an entry for that workspace:

```json
{
  "YOUR-WORKSPACE-ID": {
    "environment": "sandbox",
    "profileId": "YOUR-WISE-BUSINESS-PROFILE-ID",
    "token": "YOUR-SERVER-SIDE-WISE-ACCESS-TOKEN"
  }
}
```

Use `demo` only for an intentionally shared local demo connection. Do not put another customer's credentials under that ID. Use a secrets manager for production; don't paste tokens in payment records or commit them to source. Token acquisition/renewal and provider authorization are external setup steps; they are not implemented here. Restart after changing environment configuration, then sign in again.

The adapter uses `GET /2026Q4/transfers/<id>` at `https://api.wise-sandbox.com` for sandbox or `https://api.wise.com` for live. There is no arbitrary remote URL input, redirect following or payment-creation call. Requests time out after 10 seconds. Tokens are never returned by the API or browser.

Verification requires the transfer ID, operator-declared recipient account ID, configured business profile, source/target currencies and source amount to match. Personal Wise transfers with no business profile do not pass this connector. Matching the source amount is strict; create a plan for the actual provider source amount if it differs. Recipient identity must still be checked by the operator; the recipient name in AtlasPay is not proof of bank-account ownership. A provider transfer cannot be linked to two plans in the same workspace, and an already-linked plan cannot silently change its transfer identity.

Sandbox responses remain test evidence and keep the plan awaiting external payment. A live `outgoing_payment_sent` response changes the plan to **Provider reports sent**. It means payout sent, not guaranteed recipient credit. Cancelled/refunded responses show **Provider reports failed**. Other states remain awaiting with the raw provider status retained. A later bounce or rollback may change this status when checked again. This implementation uses manual authenticated API checks, not periodic polling or webhooks. PayPal and Remitly remain website handoffs.

No credentials are configured in the delivered project. Provider behavior is tested with controlled responses; a real provider account was not contacted or charged.

Sources: [Wise API environments](https://docs.wise.com/guides/developer/environments), [Transfer API](https://docs.wise.com/api-reference/transfer), [Status semantics](https://docs.wise.com/guides/product/send-money/tracking/transfer-statuses).

## Verification

Run `npm run test:sandbox`, or:

```
node --test sandbox/engine.test.mjs sandbox/pqc.test.mjs sandbox/http.test.mjs sandbox/external.test.mjs sandbox/business.test.mjs
```

Tests cover exact money arithmetic, idempotency, balanced journals, review reservations, PQC tamper detection, external planning, checklist validation, attachment guards, reminders, atomic batches, password authentication, HTTP workspace/attachment isolation and sandbox/live provider status separation. Live credentials and recipient delivery are not verified by these tests.
