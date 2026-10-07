# AtlasPay 0.5 workflows

## Team roles and independent approval

Register two separate customer accounts. The workspace owner opens **Team & approvals**, enters the teammate's registered email, and assigns preparer, approver or viewer. The teammate signs in, opens that page, and switches into the shared business workspace. Email delivery/invitations are not sent; accounts must already exist.

Owners manage access and recovery. Preparers maintain plans and supporting records. Owners and approvers decide external plan approvals, but cannot approve a plan they prepared or submitted. Viewers can inspect records and export reports but cannot mutate them. Roles are checked on the server against the current account membership; changing a role affects existing sessions. Owners cannot delegate ownership in this version.

Submit a plan, then have a different member approve or reject it. Approval binds the quote, provider and invoice number. Invoice-number changes reset approval, and altered quote details fail approval verification. Provider links in the plan/handoff require approved status and the checklist. This governs AtlasPay's workflow, not an independently opened banking app. No money is authorized or moved by an AtlasPay approval. Sandbox ledger review remains a separate demonstration workflow. The shared unsigned demo cannot provide two distinct approval identities: use customer accounts to try independent approvals.

## Duplicate checks

**Duplicate checks** reports repeated invoice numbers for the same recipient, identical attachment hashes and repeated plan details. Record invoice numbers there. Warnings do not block a legitimate repeat payment or establish fraud; investigate before sending. Checks are deterministic comparisons rather than document OCR or fuzzy identity matching.

## Exports, templates and forecasts

**Accounting exports** provides payment-record CSV and separate sandbox-journal CSV. Values use named currencies and integer minor units, with explicit evidence/status labels. CSV formula prefixes are neutralized. These files are general bookkeeping inputs, not a proprietary accounting integration or tax statement.

**Recurring templates** stores recipient, amount, currencies, purpose and provider. Weekly and monthly templates advance their next date when the operator creates a plan. Monthly schedules retain the original day where possible, clamping in shorter months. The same scheduled period returns the existing plan on a retry. A template never sends payments automatically; its generated plan needs checklist and team approval. Manual templates are reusable for their configured period; create a new dated template for a different manual period.

**Cash-flow forecast** shows 7, 30 or 90-day planned currency needs. It includes awaiting external plans, overdue/undated plans and the next scheduled occurrence of each template. Recorded actual fees are used when present; otherwise estimates are used. It compares against demo balances, not connected bank balances, and does not project every future recurrence or financial returns.

**Payment history** searches recipients, purpose, invoice numbers, attachment filenames, provider references and batch names, with date/status filters. Date filters use UTC boundaries; displayed times use the browser's locale.

## Backup and recovery

**Backup & recovery** downloads a dedicated encrypted workspace snapshot, including attachment contents, templates, idempotency records and ledger data. Password hashes, team memberships, provider secrets, session cookies and the private keyring are excluded. Retain the original keyring separately. Ordinary encrypted business exports from older releases are not recovery snapshots.

The owner uploads a snapshot to preview it. The server verifies both signatures using trusted local keys, authenticates/decrypts the envelope, enforces the original workspace ID, and verifies signed completed-payment receipts. The preview lists the snapshot time and record counts. Recovery requires explicit confirmation of that preview, which expires after five minutes and becomes invalid when workspace state changes.

Recovery replaces sandbox data with the displayed snapshot. Before replacement the server writes an encrypted safety copy in `.sandbox/recovery-<id>.json`. Existing newer idempotency keys remain to prevent repeating transfers after rollback; missing newer payment/batch records are reported as recovery-history conflicts on replay rather than re-created. For plans present in both versions, newer authenticated provider evidence is preserved. Newer records absent from the snapshot remain available only in the safety copy. This is local sandbox snapshot recovery, not production point-in-time database recovery or rollback protection for real funds.

No external money is sent by any feature in this release. Provider API credentials remain necessary for live status checks.

## Validation

`npm run test:sandbox` covers server roles, tenant isolation, independent approvals, exact amounts, duplicate checks, period replay, calendar scheduling, accounting CSV, forecasts, encrypted snapshot verification, stale previews and successful safety-copy recovery, in addition to existing payment/PQC workflows. Browser visual automation is not part of these checks.
