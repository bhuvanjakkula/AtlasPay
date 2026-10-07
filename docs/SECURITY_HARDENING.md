# Security hardening 0.8.1

Queued mutations recheck current session, workspace and membership before executing. Account records are refreshed inside the mutation queue, preventing stale MFA or verification data from being reused by queued requests. Successful sign-in rotates the cookie and invalidates the prior browser session.

Sessions expire after 30 minutes without HTTP requests and eight hours total. Background polling counts as requests. The server enforces these limits. Recovery token comparisons use constant-time comparison; password recovery returns the same response if email delivery is unavailable, avoiding that account-existence signal.

Request bodies are decoded as strict UTF-8 after byte-based size checks. HTTP request/header timeouts bound slow requests. Browser policies reject embedded objects and framing and disable camera, microphone and location permissions.

Validation: full sandbox suite, cross-account session isolation, cookie rotation, invalid UTF-8 rejection and response headers. Visual browser verification was unavailable.

Limits: loopback HTTP demo, local plaintext account/key files, shared service PQC keys, in-memory sessions and rate limits. This update does not provide production HTTPS, managed secret storage, an independent security audit or real payment execution.

Reference: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
