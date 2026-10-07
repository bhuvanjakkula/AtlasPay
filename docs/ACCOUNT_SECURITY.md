# Account security

Open **Start & accounts → Sign up / Sign in**. Recovery, verification and authenticator MFA controls are below the sign-in forms.

## Email verification and password recovery

Configure `RESEND_API_KEY` and `ATLAS_EMAIL_FROM` in the server environment and restart. The sender must be accepted by your email provider. Delivery uses the fixed Resend HTTPS API; no credentials are exposed to the browser. Requests send emails only when a user invokes the request action. See [Resend send API](https://resend.com/docs/api-reference/emails/send-email).

Without that configuration, test messages containing tokens are stored in `.sandbox/mail-outbox/*.json`. A trusted local developer can open these files to test the forms. They are not served by the web app and are excluded from release ZIPs. Protect the entire runtime directory: these test tokens can recover accounts in the local sandbox. Development verification tokens do not establish email ownership or set `emailVerified` to true.

Tokens contain 32 random bytes, expire after 15 minutes, and are stored in accounts as SHA-384 hashes. A new request replaces the previous ticket. Tokens are consumed once on success. Password-reset requests use the same response for known and unknown emails; resets replace the password hash and revoke all existing sessions. Resetting a password does not disable MFA. Email service failures return an error rather than claiming delivery.

## Authenticator MFA

Enter your current password to start enrollment. Add the displayed setup key manually to a TOTP authenticator with SHA-1, 6 digits and a 30-second period. Confirm one code within 10 minutes to enable MFA. Enrollment and disable actions revoke existing sessions; sign in again with a fresh code. Wait for the next code after enabling it, because accepted codes cannot be reused. Disabling MFA requires both current password and a fresh code.

The implementation uses native HMAC and the [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238) algorithm, tolerates one time step of clock skew, and rejects previously accepted time steps. Passwords remain salted scrypt hashes. MFA seeds are stored in the local plaintext account file; production needs encrypted secrets storage and independently reviewed authentication infrastructure.

There are no emergency MFA recovery codes or device migration controls. Keep your authenticator backed up before enabling MFA; email password recovery cannot bypass it. Mobile SMS verification remains unconnected. Public email verification never establishes business identity or financial authorization.

## Navigation and testing

Navigation now groups features under Start & accounts, Payments, Records & planning, and Security & connections. Selecting a shortcut opens its sidebar group automatically.

Tests check password hash replacement, RFC TOTP output, code expiry/replay rejection, developer outbox separation and existing account/workspace HTTP behavior. Visual browser usability remains unverified because browser automation could not initialize in this Windows sandbox. Live email delivery requires credentials and was not exercised. The server remains bound to loopback and is not a production public identity service.


Payment plan lifecycle: External payments offers local cancellation of awaiting plans without a reference or provider confirmation. Archive/unarchive retains records and provider evidence; archived plans are excluded from reminders and forecasts. Cancelled plans cannot be approved or linked to a provider transfer. These actions do not cancel or refund payments at a provider.


## Sessions and security alerts (0.8.0)
Accounts shows active sessions with browser-reported labels, creation, last activity and expiry. Customers can revoke another session or every other session; the current session is preserved. Session cookies and CSRF secrets are never included in the list. Sessions expire after eight hours and are cleared on server restart. Revoked sessions cannot execute queued mutations.

The latest 100 account-scoped events are retained on disk: sign-in, password reset, MFA enable/disable, recovery-code replacement and session revocation. Alerts are in-app history only. Email/push security alerts and remote-device access are not connected in this loopback demo.
