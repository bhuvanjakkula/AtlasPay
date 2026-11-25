import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initialState, quote, pay, balanced } from './engine.mjs';
import { newKeys, verifyReceipt, publicKeys } from './pqc.mjs';
import { sendToken, validatePasswordConfirmation } from './auth-security.mjs';
import { syncAuditChain, verifyAuditChain, merkleProof, verifyMerkleProof, anchorMerkleCheckpoint } from './audit-chain.mjs';
import { routeCorridor, assessPaymentRisk, treasuryAnalytics, rebalanceWallets } from './intelligence.mjs';
import { addWebhookEndpoint, removeWebhookEndpoint, recordOutboxEvent, signWebhookPayload, verifyWebhookSignature } from './webhooks.mjs';

test('password confirmation validation and recovery link generation', async () => {
  assert.throws(() => validatePasswordConfirmation('short', 'short'), /12–128/);
  assert.throws(() => validatePasswordConfirmation('long-password-one', 'long-password-two'), /do not match/);
  validatePasswordConfirmation('matching-secure-password', 'matching-secure-password');

  const dir = await mkdtemp(join(tmpdir(), 'atlas-reset-link-'));
  try {
    const ticket = await sendToken(
      { email: 'founder@apollo.test' },
      'reset',
      pathToFileURL(dir + sep),
      {},
      { origin: 'https://atlas-pay-flax.vercel.app' }
    );
    assert.ok(ticket.actionUrl.startsWith('https://atlas-pay-flax.vercel.app/?view=accounts&action=reset-password&email=founder%40apollo.test&token='));
    assert.equal(ticket.token, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Merkle hash-chain audit ledger detects tampering and anchors dual-signed checkpoint', () => {
  const s = initialState();
  const keys = newKeys();
  const q = quote(s, { sourceCurrency: 'USD', targetCurrency: 'EUR', amountMinor: '25000', recipient: 'Nordic Co', purpose: 'Cloud license' });
  pay(s, { quoteId: q.id }, 'merkle-test-key-001');
  syncAuditChain(s);

  const okReport = verifyAuditChain(s, [keys]);
  assert.equal(okReport.intact, true);
  assert.equal(okReport.count, 1);

  const hashes = s.auditChain.map(e => e.entryHash);
  const proof = merkleProof(hashes, 0);
  assert.equal(verifyMerkleProof(proof), true);

  const cert = anchorMerkleCheckpoint(s, keys);
  assert.equal(verifyReceipt(cert.certificate.attestation, publicKeys(keys)), true);
  assert.equal(verifyAuditChain(s, [keys]).checkpoint.valid, true);

  // Tamper audit text and confirm detection
  s.audit[0].action = 'Tampered description';
  const badReport = verifyAuditChain(s, [keys]);
  assert.equal(badReport.intact, false);
  assert.equal(badReport.brokenAt, 0);
});

test('smart FX corridor router, split-structuring risk scorer, and balanced FX rebalance', () => {
  const s = initialState();
  const routing = routeCorridor(s, { sourceCurrency: 'USD', targetCurrency: 'EUR', amountMinor: '500000', recipient: 'Euro Design GmbH' });
  assert.equal(routing.rails.length, 5);
  assert.equal(routing.recommendedRail, 'atlas_local');
  assert.ok(BigInt(routing.rails[0].savingsVsSwiftMinor) > 0n);

  // Simulate split-structuring pattern (two $6,000 transfers within 24h)
  const q1 = quote(s, { sourceCurrency: 'USD', targetCurrency: 'EUR', amountMinor: '600000', recipient: 'Split Vendor', purpose: 'Part 1' });
  pay(s, { quoteId: q1.id }, 'split-test-key-001');
  const risk = assessPaymentRisk(s, { sourceCurrency: 'USD', targetCurrency: 'EUR', amountMinor: '600000', recipient: 'Split Vendor' });
  assert.ok(risk.signals.some(sig => sig.code === 'SPLIT_STRUCTURING_ALERT'));
  assert.ok(risk.score >= 50);

  const beforeUsd = BigInt(s.wallets.USD);
  const beforeEur = BigInt(s.wallets.EUR);
  const rebalanced = rebalanceWallets(s, { fromCurrency: 'USD', toCurrency: 'EUR', amountMinor: '100000' });
  assert.equal(rebalanced.status, 'completed');
  balanced(s.journals[0].postings);
  assert.ok(BigInt(s.wallets.USD) < beforeUsd);
  assert.ok(BigInt(s.wallets.EUR) > beforeEur);

  const analytics = treasuryAnalytics(s);
  assert.equal(analytics.wallets.length, 6);
  assert.ok(BigInt(analytics.totalUsdEquivalentMinor) > 0n);
});

test('webhook endpoint validation, HMAC-SHA256 signing, and replay protection', () => {
  const s = initialState();
  assert.throws(() => addWebhookEndpoint(s, { url: 'http://example.com/hook' }), /HTTPS/);
  assert.throws(() => addWebhookEndpoint(s, { url: 'https://127.0.0.1/hook' }), /HTTPS/);

  const ep = addWebhookEndpoint(s, { url: 'https://api.example.com/webhooks/atlas', events: ['payment.settled'] });
  assert.ok(ep.secret.startsWith('whsec_'));

  const outboxEvent = recordOutboxEvent(s, 'payment.settled', { paymentId: 'pi_123' });
  assert.equal(outboxEvent.matchedEndpoints.length, 1);

  const nowSec = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ hello: 'atlas' });
  const header = signWebhookPayload(ep.secret, nowSec, body);
  assert.equal(verifyWebhookSignature(ep.secret, header, body, nowSec).valid, true);
  assert.equal(verifyWebhookSignature(ep.secret, header, body, nowSec + 400).valid, false);
  assert.equal(verifyWebhookSignature('wrong_secret', header, body, nowSec).valid, false);

  removeWebhookEndpoint(s, ep.id);
  assert.equal(s.webhooks.length, 0);
});

test('HTTP end-to-end verification for pricing links, forgot password flow, and new APIs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-adv-http-'));
  let proc;
  let output = '';
  try {
    proc = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
      env: { ...process.env, PORT: '0', ATLAS_DATA_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Server start timeout: ' + output)), 15000);
      proc.stdout.on('data', d => {
        output += d;
        const m = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (m) { clearTimeout(timer); resolve(m[0]); }
      });
      proc.stderr.on('data', d => { output += d; });
      proc.once('exit', () => { clearTimeout(timer); reject(Error(output)); });
    });

    // Verify UI assets & updates (no SANDBOX header badge, updated email, updated Stripe URLs)
    const html = await (await fetch(base + '/')).text();
    assert.ok(!html.includes('● SANDBOX'));
    assert.ok(html.includes('contact@apolloaiglobalcompany.com'));
    assert.ok(!html.includes('bjtmusic12@gmail.com'));

    const pricingJs = await (await fetch(base + '/pricing.js')).text();
    for (const url of [
      'https://buy.stripe.com/7sYcMXbtI8u10az8km2oE0K',
      'https://buy.stripe.com/4gM5kvcxM11z4qP8km2oE0L',
      'https://buy.stripe.com/fZubITeFU39H8H5bwy2oE0M',
      'https://buy.stripe.com/9B6aEPdBQ7pXbTh3022oE0N'
    ]) {
      assert.ok(pricingJs.includes(url), 'Missing Stripe link: ' + url);
    }

    for (const asset of ['/intelligence.js', '/webhooks.js']) {
      assert.equal((await fetch(base + asset)).status, 200);
    }

    const stateRes = await fetch(base + '/api/state');
    const state = await stateRes.json();
    const csrfCookie = stateRes.headers.get('set-cookie').split(';')[0];

    const post = (path, body = {}, extra = {}) => fetch(base + '/api/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, 'X-Sandbox-Token': state.token, Cookie: csrfCookie, ...extra },
      body: JSON.stringify(body)
    });

    // Register, request update password link, test mismatch rejection, then reset password
    const reg = await post('accounts/register', { name: 'Apollo Treasury', email: 'user@apollo.test', mobile: '+919876543210', password: 'initial-password-123' });
    assert.equal(reg.status, 200);

    const missingReset = await post('accounts/reset-request', { email: 'missing@apollo.test' });
    assert.equal(missingReset.status, 404);

    const reqReset = await post('accounts/reset-request', { email: 'user@apollo.test' });
    assert.equal(reqReset.status, 200);
    const resetBody = await reqReset.json();
    assert.ok(resetBody.resetUrl);
    const token = new URL(resetBody.resetUrl).searchParams.get('token');
    assert.equal(token.length, 64);

    const mismatch = await post('accounts/reset-complete', {
      email: 'user@apollo.test',
      token,
      password: 'updated-password-123',
      confirmPassword: 'different-password-123'
    });
    assert.equal(mismatch.status, 400);

    const resetDone = await post('accounts/reset-complete', {
      email: 'user@apollo.test',
      token,
      password: 'updated-password-123',
      confirmPassword: 'updated-password-123'
    });
    assert.equal(resetDone.status, 200);

    assert.equal((await post('accounts/login', { email: 'user@apollo.test', password: 'initial-password-123' })).status, 401);
    assert.equal((await post('accounts/login', { email: 'user@apollo.test', password: 'updated-password-123' })).status, 200);

    // Intelligence, Wallet Rebalance, Merkle Proof & Webhooks HTTP tests
    const routeRes = await post('intelligence/route', { sourceCurrency: 'USD', targetCurrency: 'EUR', amountMinor: '250000' });
    assert.equal(routeRes.status, 200);
    assert.equal((await routeRes.json()).recommendedRail, 'atlas_local');

    const rebRes = await post('wallets/rebalance', { fromCurrency: 'USD', toCurrency: 'EUR', amountMinor: '50000' });
    assert.equal(rebRes.status, 200);

    const proof = await (await fetch(base + '/api/security/ledger-proof')).json();
    assert.equal(proof.intact, true);
    assert.ok(proof.count >= 1);

    const certRes = await post('security/anchor-ledger', {});
    assert.equal(certRes.status, 200);

    const hookAdd = await post('webhooks/endpoint', { url: 'https://hooks.example.com/atlas', events: ['*'] });
    assert.equal(hookAdd.status, 200);
    const hookSim = await post('webhooks/simulate', { note: 'HTTP test' });
    assert.equal(hookSim.status, 200);
    const hooksList = await (await fetch(base + '/api/webhooks')).json();
    assert.equal(hooksList.endpoints.length, 1);
    assert.ok(hooksList.outbox.length >= 2);
  } catch (err) {
    err.message = `${err.message}\nServer log:\n${output}`;
    throw err;
  } finally {
    if (proc && proc.exitCode === null) {
      const exited = once(proc, 'exit');
      proc.kill();
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
