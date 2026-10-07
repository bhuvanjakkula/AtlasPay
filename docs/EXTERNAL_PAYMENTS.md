# Pay through provider

Create a payment quote, then choose **Pay through provider**. Select a listed provider or enter the name and official HTTPS website of the bank/payment app you already use. Complete the checklist. AtlasPay does not verify provider authorization. The optional read-only Wise status connector requires server credentials; see `BUSINESS_FEATURES.md`.

Choose **Prepare external payment** to save a plan with the status **Awaiting external payment**. The handoff screen shows an **Open provider** link. The link opens only the website you entered; it sends no payment parameters, logs in to no account, and executes no transfer. Re-enter and verify recipient banking details, amount and purpose with the provider. The provider's actual quote, fees, eligibility and exchange rate supersede AtlasPay's illustrative estimate.

The **External payments** page keeps these plans separate from simulated settlement. After paying through your provider, save its transaction reference there. This self-reported reference never confirms settlement or overwrites an authenticated provider status. A configured live Wise status check may report payment sent or failed; a sandbox check cannot establish a real transfer. Recipient delivery is never inferred from a sent response.

External plans do not debit or reserve demo wallets, create ledger settlement postings, generate completed-payment receipts, or participate in the completed sandbox-payment reconciliation. A quote can produce only one plan or sandbox transfer. Repeated submissions use persisted idempotency keys. Expired quotes must be refreshed before preparing a plan. Once prepared, a plan remains available after its illustrative quote expires.

Provider links must be public HTTPS URLs without credentials, custom ports, query parameters or fragments. Only the name and ordinary website are recorded. AtlasPay never requests provider passwords. Opening a provider site does not imply that the site supports this transfer.
The Payment providers sidebar page lists Wise (https://wise.com/), PayPal (https://www.paypal.com/), Remitly (https://www.remitly.com/) and a custom bank/app option. Provider selection pre-fills the official website. Links are a directory, not API integrations, endorsements, or guarantees of eligibility.
