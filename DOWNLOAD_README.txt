AtlasPay complete project 0.8.1

Extract this folder outside OneDrive, for example C:\AtlasPay.
Install Node.js 24.7 or later (Node 24 LTS recommended).
Double-click Start-AtlasPay.cmd, then open http://127.0.0.1:8080/.
The sandbox needs no npm install. It creates fresh local demo data and keys on first start.
Run npm run test:sandbox to verify the sandbox.

This archive contains all project source, tests, documentation, infrastructure examples and launcher. The runnable local app is sandbox/server.mjs and apps/web. Original monorepo components are also included as reference; they are not a production deployment.

Private .sandbox account data, signing keys, MFA secrets, provider credentials, email tokens, .env files, Git history and generated dependencies are intentionally excluded. Existing accounts and payment history are not transferred in this distributable archive.

Real money transfers take place through external payment providers. Email delivery and optional provider lookups require your own configuration. Consult docs/ACCOUNT_SECURITY.md and docs/SECURITY_HARDENING.md.
Support: bjtmusic12@gmail.com
