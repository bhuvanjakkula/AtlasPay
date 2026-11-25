import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomBytes, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { initialState, quote, pay, review, Fault, available, reserved } from './engine.mjs';
import { newKeys, publicKeys, attest, checkPayments, seal, unseal, signReceipt, verifyReceipt } from './pqc.mjs';
import { beneficiary, reconcileStatement } from './operations.mjs';
import { recordReference, lifecycle } from './external.mjs';
import { checklist, reminder, reminders, cost, invoice, batch } from './business.mjs';
import { createAccount, authenticate, accountPublic, mobileNumber } from './accounts.mjs';
import { integrationStatus, checkProvider } from './provider.mjs';
import { tagPlans, approve, duplicates, invoiceNumber, search, forecast, template, runTemplate, accounting, backup, previewBackup } from './workflows.mjs';
import { readiness } from './readiness.mjs';
import { sendToken, tokenHash, newPassword, validatePasswordConfirmation, createEnrollment, verifyTotp, recoveryCodes, verifyFactor } from './auth-security.mjs';
import { syncAuditChain, verifyAuditChain, anchorMerkleCheckpoint } from './audit-chain.mjs';
import { routeCorridor, assessPaymentRisk, treasuryAnalytics, rebalanceWallets } from './intelligence.mjs';
import { addWebhookEndpoint, removeWebhookEndpoint, recordOutboxEvent, webhookOverview, verifyWebhookSignature } from './webhooks.mjs';

const recoveryPreviews = new Map();
const enrollments = new Map();

const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
const defaultDataDir = isServerless ? pathToFileURL(join(tmpdir(), '.sandbox') + sep) : new URL('../.sandbox/', import.meta.url);
const data = process.env.ATLAS_DATA_DIR ? pathToFileURL(resolve(process.env.ATLAS_DATA_DIR) + sep) : defaultDataDir;
await mkdir(data, { recursive: true });

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(new URL(name, data), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return fallback;
  }
}

async function writeJson(name, body) {
  const tmp = new URL(name + '.tmp', data);
  await writeFile(tmp, JSON.stringify(body, null, 2), { mode: 0o600 });
  await rename(tmp, new URL(name, data));
}

let accounts = await readJson('accounts.json', []);
const states = new Map([['demo', await readJson('state.json', initialState())]]);
const sessions = new Map();
let keyring = await readJson('keyring.json', null);

if (!keyring) {
  if (accounts.length || states.get('demo').payments.some(p => p.receipt)) {
    throw Error('PQC keyring missing; restore original keyring');
  }
  keyring = { active: 0, keys: [newKeys()] };
  await writeJson('keyring.json', keyring);
}

const activeKey = () => keyring.keys[keyring.active];
const token = randomBytes(32).toString('hex');
const IDLE_MS = 30 * 60 * 1000;

function sameToken(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function cookieValue(req, name) {
  const prefix = name + '=';
  return req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(prefix))?.slice(prefix.length) || '';
}

function requestOrigin(req) {
  const host = req.headers.host;
  if (!host) return '';
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const proto = protoHeader === 'https' || isCloud ? 'https' : 'http';
  return `${proto}://${host}`;
}

const filename = id => id === 'demo' ? 'state.json' : 'workspace-' + id + '.json';

async function workspace(id) {
  if (!states.has(id)) states.set(id, await readJson(filename(id), initialState()));
  return states.get(id);
}

async function save(next, id) {
  syncAuditChain(next);
  attest(next, activeKey());
  await writeJson(filename(id), next);
  states.set(id, next);
}

await save(structuredClone(states.get('demo')), 'demo');

function security(state) {
  syncAuditChain(state);
  return {
    mode: 'Local sandbox',
    runtime: process.version,
    signature: 'ML-DSA-65 + Ed25519 (both required)',
    encryption: 'ML-KEM-768 / HKDF-SHA384 / AES-256-GCM',
    activeKeyId: activeKey().id,
    keys: keyring.keys.map(publicKeys),
    receipts: checkPayments(state, keyring.keys),
    ledgerProof: verifyAuditChain(state, keyring.keys),
    transport: 'Loopback HTTP; no PQC transport claim',
    keyStorage: 'Local keyring file; no HSM/KMS',
    stateStorage: 'Local JSON; plaintext'
  };
}

function session(req) {
  const cookie = cookieValue(req, 'atlas_session');
  const s = sessions.get(cookie);
  if (s && s.expiresAt > Date.now() && Date.now() - Date.parse(s.lastSeenAt) < IDLE_MS) {
    s.lastSeenAt = new Date().toISOString();
    return { ...s, cookie };
  }
  if (cookie) sessions.delete(cookie);
  return { workspaceId: 'demo', token };
}

function accountEvent(a, type) {
  a.securityAlerts ??= [];
  a.securityAlerts.unshift({ id: randomUUID(), type, at: new Date().toISOString() });
  a.securityAlerts = a.securityAlerts.slice(0, 100);
}

async function issue(res, a, req) {
  const list = structuredClone(accounts);
  const target = list.find(x => x.id === a.id);
  accountEvent(target, 'New sign-in');
  await writeJson('accounts.json', list);
  accounts = list;

  const prior = cookieValue(req, 'atlas_session');
  if (prior) sessions.delete(prior);
  for (const [key, value] of sessions) {
    if (value.expiresAt <= Date.now() || Date.now() - Date.parse(value.lastSeenAt) >= IDLE_MS) {
      sessions.delete(key);
    }
  }

  const cookie = randomBytes(32).toString('hex');
  const sessionToken = randomBytes(32).toString('hex');
  sessions.set(cookie, {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    device: String(req.headers['user-agent'] || 'Unknown browser').slice(0, 200),
    workspaceId: a.id,
    accountId: a.id,
    token: sessionToken,
    expiresAt: Date.now() + 8 * 3600000
  });
  res.setHeader('Set-Cookie', [
    'atlas_session=' + cookie + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800',
    'atlas_csrf=' + sessionToken + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'
  ]);
  return accountPublic(a);
}

let queue = Promise.resolve();
const limits = new Map();
const enqueue = fn => {
  const pending = queue.then(fn);
  queue = pending.catch(() => {});
  return pending;
};

const isCloud = !!(process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.RENDER || (process.env.PORT && process.env.PORT !== '8080'));

const assets = {
  '/': 'dashboard.html',
  '/app.js': 'app.js',
  '/pricing.js': 'pricing.js',
  '/features.js': 'features.js',
  '/external.js': 'external.js',
  '/business.js': 'business.js',
  '/workflows.js': 'workflows.js',
  '/readiness.js': 'readiness.js',
  '/account-security.js': 'account-security.js',
  '/intelligence.js': 'intelligence.js',
  '/webhooks.js': 'webhooks.js',
  '/style.css': 'style.css'
};

const readRoutes = [
  '/api/accounting/export',
  '/api/search',
  '/api/forecast',
  '/api/backup/export',
  '/api/security/verify',
  '/api/security/self-test',
  '/api/security/export',
  '/api/intelligence/route',
  '/api/intelligence/risk',
  '/api/webhooks/verify-signature'
];

const server = http.createServer(async (req, res) => {
  const host = req.headers.host;
  if (!isCloud && !/^127\.0\.0\.1:\d+$/.test(host || '')) {
    res.writeHead(403);
    return res.end('Loopback host required');
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');

  const url = new URL(req.url, 'http://' + host);
  const s = session(req);
  const id = s.workspaceId;
  const json = (status, body) => {
    const serialized = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(serialized);
  };

  try {
    if (isServerless) {
      accounts = await readJson('accounts.json', accounts);
    }

    let user = accounts.find(a => a.id === s.accountId);
    const role = id === 'demo' ? 'owner' : user?.id === id ? 'owner' : user?.memberships?.find(m => m.workspaceId === id)?.role;
    if (!role) throw new Fault('Workspace access revoked', 403);
    const actor = user?.id || 'demo';

    if (req.method === 'GET') {
      if (url.pathname === '/health') return json(200, { ok: true, mode: 'sandbox', version: '0.8.1' });
      if (Object.hasOwn(assets, url.pathname)) {
        res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html');
        return res.end(await readFile(new URL('../apps/web/' + assets[url.pathname], import.meta.url)));
      }
      const state = await workspace(id);
      if (url.pathname === '/api/accounts/activity') {
        if (!user) throw new Fault('Sign in to view account activity', 401);
        return json(200, {
          sessions: [...sessions.values()]
            .filter(x => x.accountId === actor && x.expiresAt > Date.now())
            .map(x => ({ id: x.id, device: x.device, createdAt: x.createdAt, lastSeenAt: x.lastSeenAt, expiresAt: new Date(x.expiresAt).toISOString(), current: x.id === s.id })),
          alerts: user.securityAlerts || [],
          delivery: 'In-app history only; email and push alerts are not connected'
        });
      }
      if (url.pathname === '/api/profile') return json(200, user ? accountPublic(user) : null);
      if (url.pathname === '/api/readiness') {
        return json(200, readiness(state, {
          workspaceId: id,
          actor,
          role,
          name: accounts.find(a => a.id === id)?.name || 'Northstar Studio',
          email: user?.email,
          integration: integrationStatus(id),
          members: accounts.filter(a => a.id === id || a.memberships?.some(m => m.workspaceId === id))
            .map(a => ({ id: a.id, role: a.id === id ? 'owner' : a.memberships.find(m => m.workspaceId === id).role }))
        }));
      }
      if (url.pathname === '/api/workflows') {
        return json(200, {
          role,
          userId: actor,
          workspaces: user
            ? [{ id: user.id, name: user.name, role: 'owner' }, ...(user.memberships || []).map(m => ({ ...m, name: accounts.find(a => a.id === m.workspaceId)?.name || 'Workspace' }))]
            : [{ id: 'demo', name: 'Northstar Studio', role: 'owner' }],
          members: role === 'owner'
            ? accounts.filter(a => a.id === id || a.memberships?.some(m => m.workspaceId === id))
                .map(a => ({ id: a.id, email: a.email, role: a.id === id ? 'owner' : a.memberships.find(m => m.workspaceId === id).role }))
            : [],
          duplicates: duplicates(state)
        });
      }
      if (url.pathname === '/api/state') {
        const a = accounts.find(x => x.id === id);
        const isHttps = req.headers['x-forwarded-proto'] === 'https' || isCloud;
        const secureAttr = isHttps ? '; Secure' : '';
        const existingCsrf = cookieValue(req, 'atlas_csrf');
        const effectiveToken = (!s.cookie && isServerless && existingCsrf && existingCsrf.length === 64) ? existingCsrf : s.token;
        res.setHeader('Set-Cookie', `atlas_csrf=${effectiveToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureAttr}`);
        return json(200, {
          ...state,
          keys: undefined,
          batchKeys: undefined,
          quotes: undefined,
          webhooks: undefined,
          outbox: undefined,
          invoices: (state.invoices || []).map(i => ({ ...i, content: undefined })),
          workspace: a ? accountPublic(a) : { id: 'demo', name: 'Northstar Studio', email: null },
          token: effectiveToken,
          reminders: reminders(state),
          available: Object.fromEntries(Object.keys(state.wallets).map(c => [c, available(state, c).toString()])),
          reserved: Object.fromEntries(Object.keys(state.wallets).map(c => [c, reserved(state, c).toString()]))
        });
      }
      if (url.pathname === '/api/security') return json(200, security(state));
      if (url.pathname === '/api/security/ledger-proof') {
        syncAuditChain(state);
        return json(200, verifyAuditChain(state, keyring.keys));
      }
      if (url.pathname === '/api/intelligence/analytics') {
        syncAuditChain(state);
        return json(200, treasuryAnalytics(state, keyring.keys));
      }
      if (url.pathname === '/api/webhooks') return json(200, webhookOverview(state));
      if (url.pathname === '/api/integrations') return json(200, integrationStatus(id));
      if (url.pathname.startsWith('/api/invoices/')) {
        const item = state.invoices?.find(i => i.id === url.pathname.slice(14));
        if (!item) throw new Fault('Attachment not found in this workspace', 404);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(item.name));
        return res.end(Buffer.from(item.content, 'base64'));
      }
      return json(404, { error: 'Not found' });
    }

    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

    const validOrigin = !req.headers.origin || req.headers.origin === 'http://' + host || req.headers.origin === 'https://' + host;
    const headerToken = req.headers['x-sandbox-token'];
    const cookieCsrf = cookieValue(req, 'atlas_csrf');
    const validDemoServerlessCsrf = id === 'demo' && !s.cookie && cookieCsrf.length === 64 && sameToken(headerToken, cookieCsrf);
    if (!validOrigin || (!sameToken(headerToken, s.token) && !validDemoServerlessCsrf)) {
      throw new Fault('Invalid session or origin', 403);
    }

    const minute = Math.floor(Date.now() / 60000);
    const limKey = minute + ':' + (url.pathname.startsWith('/api/accounts/') ? 'auth' : 'ops');
    const count = limits.get(limKey) || 0;
    if (count >= (limKey.endsWith('auth') ? 25 : 120)) {
      throw new Fault('Too many requests; try again next minute', 429);
    }
    for (const k of limits.keys()) {
      if (!k.startsWith(minute + ':')) limits.delete(k);
    }
    limits.set(limKey, count + 1);

    if (!req.headers['content-type']?.startsWith('application/json')) throw new Fault('JSON required', 415);
    const max = url.pathname === '/api/backup/preview' ? 75000000 : url.pathname === '/api/business/invoice' ? 800000 : 65536;
    let input;
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'object') input = req.body;
      else if (typeof req.body === 'string') { try { input = JSON.parse(req.body); } catch { throw new Fault('Invalid JSON'); } }
      else if (Buffer.isBuffer(req.body)) { try { input = JSON.parse(req.body.toString('utf8')); } catch { throw new Fault('Invalid JSON'); } }
    } else {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > max) throw new Fault('Request too large', 413);
        chunks.push(chunk);
      }
      if (chunks.length) {
        try {
          input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        } catch {
          throw new Fault('Invalid JSON');
        }
      } else {
        input = {};
      }
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Fault('Invalid request');

    const result = await enqueue(async () => {
      if (s.cookie && (!sessions.has(s.cookie) || sessions.get(s.cookie).expiresAt <= Date.now() || sessions.get(s.cookie).workspaceId !== id || Date.now() - Date.parse(sessions.get(s.cookie).lastSeenAt) >= IDLE_MS)) {
        throw new Fault('Session ended; sign in again', 401);
      }
      user = accounts.find(a => a.id === s.accountId);
      if (user) {
        const currentRole = user.id === id ? 'owner' : user.memberships?.find(m => m.workspaceId === id)?.role;
        if (currentRole !== role) throw new Fault('Workspace access changed; reload', 403);
      }

      if (url.pathname === '/api/accounts/sessions/revoke') {
        if (!user) throw new Fault('Sign in first', 401);
        if (input.allOthers !== true && typeof input.id !== 'string') throw new Fault('Choose a session');
        const matches = [...sessions.entries()].filter(([key, value]) => value.accountId === actor && key !== s.cookie && (input.allOthers === true || value.id === input.id));
        if (input.allOthers !== true && !matches.length) throw new Fault('Other active session not found', 404);
        const list = structuredClone(accounts);
        accountEvent(list.find(a => a.id === actor), 'Other sessions signed out');
        await writeJson('accounts.json', list);
        accounts = list;
        for (const [key] of matches) sessions.delete(key);
        return { message: matches.length + ' other session(s) signed out' };
      }

      if (url.pathname === '/api/accounts/register') {
        const a = await createAccount(accounts, input);
        const nextAccounts = [...accounts, a];
        await save(initialState(), a.id);
        await writeJson('accounts.json', nextAccounts);
        accounts = nextAccounts;
        return issue(res, a, req);
      }

      if (url.pathname === '/api/accounts/login') {
        const a = await authenticate(accounts, input);
        if (a.mfaSecret) {
          const list = structuredClone(accounts);
          verifyFactor(list.find(x => x.id === a.id), input);
          await writeJson('accounts.json', list);
          accounts = list;
        }
        return issue(res, a, req);
      }

      if (url.pathname === '/api/accounts/reset-request') {
        const email = String(input.email || '').trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Fault('Enter a valid registered email address');
        const a = accounts.find(x => x.email === email);
        if (!a) throw new Fault('No account is registered with that email address. Please sign up first.', 404);

        const ticket = await sendToken(a, 'reset', data, process.env, { origin: requestOrigin(req) });
        const list = structuredClone(accounts);
        const target = list.find(x => x.id === a.id);
        target.resetTicket = { hash: ticket.hash, kind: ticket.kind, expiresAt: ticket.expiresAt, mode: ticket.mode };
        accountEvent(target, 'Update password link generated');
        await writeJson('accounts.json', list);
        accounts = list;

        const accountWorkspace = structuredClone(await workspace(a.id));
        recordOutboxEvent(accountWorkspace, 'account.password_reset_requested', { email: a.email, expiresAt: new Date(ticket.expiresAt).toISOString() });
        await save(accountWorkspace, a.id);

        return {
          ok: true,
          email: a.email,
          mode: ticket.mode,
          expiresAt: new Date(ticket.expiresAt).toISOString(),
          ...(ticket.mode === 'development-outbox' && ticket.actionUrl ? { resetUrl: ticket.actionUrl } : {}),
          message: ticket.mode === 'email'
            ? `Update password link sent to ${a.email}. Check your inbox (expires in 15 minutes).`
            : `Update password link ready for ${a.email}. Open the link below to set your new password.`
        };
      }

      if (url.pathname === '/api/accounts/reset-complete') {
        const email = String(input.email || '').trim().toLowerCase();
        const a = accounts.find(x => x.email === email);
        if (typeof input.token !== 'string' || input.token.length !== 64 || !a?.resetTicket || a.resetTicket.expiresAt < Date.now() || !sameToken(a.resetTicket.hash, tokenHash(input.token))) {
          throw new Fault('Invalid or expired update password link', 400);
        }
        validatePasswordConfirmation(input.password, input.confirmPassword);
        const list = structuredClone(accounts);
        const target = list.find(x => x.id === a.id);
        await newPassword(target, input.password);
        delete target.resetTicket;
        accountEvent(target, 'Password changed through recovery');
        await writeJson('accounts.json', list);
        accounts = list;
        for (const [key, value] of sessions) {
          if (value.accountId === a.id) sessions.delete(key);
        }
        const accountWorkspace = structuredClone(await workspace(a.id));
        recordOutboxEvent(accountWorkspace, 'account.password_updated', { email: a.email });
        await save(accountWorkspace, a.id);
        return { ok: true, message: 'Password updated successfully. Sign in with your new password.' };
      }

      if (url.pathname === '/api/accounts/verify-request') {
        if (!user) throw new Fault('Sign in first', 401);
        const ticket = await sendToken(user, 'verify', data, process.env, { origin: requestOrigin(req) });
        const list = structuredClone(accounts);
        list.find(x => x.id === actor).verifyTicket = { hash: ticket.hash, kind: ticket.kind, expiresAt: ticket.expiresAt, mode: ticket.mode };
        await writeJson('accounts.json', list);
        accounts = list;
        return {
          mode: ticket.mode,
          ...(ticket.mode === 'development-outbox' && ticket.actionUrl ? { verifyUrl: ticket.actionUrl } : {}),
          message: ticket.mode === 'email' ? 'Verification email sent to your registered email.' : 'Verification link saved in local mail-outbox.'
        };
      }

      if (url.pathname === '/api/accounts/verify-complete') {
        if (!user) throw new Fault('Sign in first', 401);
        if (typeof input.token !== 'string' || input.token.length !== 64 || !user.verifyTicket || user.verifyTicket.expiresAt < Date.now() || !sameToken(user.verifyTicket.hash, tokenHash(input.token))) {
          throw new Fault('Invalid or expired verification token');
        }
        const list = structuredClone(accounts);
        const target = list.find(x => x.id === actor);
        target.emailVerificationMode = target.verifyTicket.mode;
        if (target.verifyTicket.mode === 'email') target.emailVerifiedAt = new Date().toISOString();
        delete target.verifyTicket;
        await writeJson('accounts.json', list);
        accounts = list;
        return accountPublic(target);
      }

      if (url.pathname === '/api/accounts/mfa-start') {
        if (!user) throw new Fault('Sign in first', 401);
        await authenticate(accounts, { email: user.email, password: input.password });
        if (user.mfaSecret) throw new Fault('MFA already enabled', 409);
        const enrollment = createEnrollment(user.email);
        enrollments.set(actor, enrollment);
        return enrollment;
      }

      if (url.pathname === '/api/accounts/mfa-enable') {
        if (!user) throw new Fault('Sign in first', 401);
        const enrollment = enrollments.get(actor);
        if (!enrollment || enrollment.expiresAt < Date.now()) throw new Fault('Enrollment expired');
        const step = verifyTotp(enrollment.secret, input.code);
        const list = structuredClone(accounts);
        const target = list.find(x => x.id === actor);
        target.mfaSecret = enrollment.secret;
        target.mfaLastStep = step;
        const codes = recoveryCodes(target);
        accountEvent(target, 'MFA enabled');
        await writeJson('accounts.json', list);
        accounts = list;
        enrollments.delete(actor);
        for (const [key, value] of sessions) {
          if (value.accountId === actor) sessions.delete(key);
        }
        return { codes, message: 'MFA enabled. Save these single-use recovery codes privately. Sign in again.' };
      }

      if (url.pathname === '/api/accounts/mfa-disable') {
        if (!user || !user.mfaSecret) throw new Fault('MFA is not enabled');
        await authenticate(accounts, { email: user.email, password: input.password });
        const list = structuredClone(accounts);
        const target = list.find(x => x.id === actor);
        verifyFactor(target, input);
        delete target.mfaSecret;
        delete target.mfaLastStep;
        delete target.recoveryHashes;
        accountEvent(target, 'MFA disabled');
        await writeJson('accounts.json', list);
        accounts = list;
        for (const [key, value] of sessions) {
          if (value.accountId === actor) sessions.delete(key);
        }
        return { message: 'MFA disabled. Sign in again.' };
      }

      if (url.pathname === '/api/accounts/mfa-recovery') {
        if (!user?.mfaSecret) throw new Fault('Enable MFA first');
        await authenticate(accounts, { email: user.email, password: input.password });
        const list = structuredClone(accounts);
        const target = list.find(x => x.id === actor);
        verifyFactor(target, input);
        const codes = recoveryCodes(target);
        accountEvent(target, 'MFA recovery codes replaced');
        await writeJson('accounts.json', list);
        accounts = list;
        return { codes, message: 'New codes created. All previous recovery codes are invalid.' };
      }

      if (url.pathname === '/api/accounts/logout') {
        if (s.cookie) sessions.delete(s.cookie);
        res.setHeader('Set-Cookie', 'atlas_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return { ok: true };
      }

      if (url.pathname === '/api/accounts/profile') {
        if (!user) throw new Fault('Sign in to update your mobile number', 401);
        const number = mobileNumber(input.mobile);
        const list = structuredClone(accounts);
        list.find(a => a.id === actor).mobile = number;
        await writeJson('accounts.json', list);
        accounts = list;
        return accountPublic(list.find(a => a.id === actor));
      }

      if (url.pathname === '/api/accounts/switch') {
        if (!user || !s.cookie || (input.workspaceId !== user.id && !user.memberships?.some(m => m.workspaceId === input.workspaceId))) {
          throw new Fault('Workspace access denied', 403);
        }
        sessions.get(s.cookie).workspaceId = input.workspaceId;
        return { ok: true };
      }

      if (url.pathname === '/api/team/member') {
        if (role !== 'owner' || id === 'demo') throw new Fault('Sign in as the customer workspace owner', 403);
        if (!['preparer', 'approver', 'viewer'].includes(input.role)) throw new Fault('Invalid role');
        const list = structuredClone(accounts);
        const a = list.find(x => x.email === String(input.email).trim().toLowerCase());
        if (!a || a.id === id) throw new Fault('Add another registered customer account by email');
        a.memberships ??= [];
        a.memberships = a.memberships.filter(m => m.workspaceId !== id);
        a.memberships.push({ workspaceId: id, role: input.role });
        await writeJson('accounts.json', list);
        accounts = list;
        return { email: a.email, role: input.role };
      }

      const liveUser = accounts.find(a => a.id === actor);
      const liveRole = id === 'demo' ? 'owner' : liveUser?.id === id ? 'owner' : liveUser?.memberships?.find(m => m.workspaceId === id)?.role;
      if (liveRole !== role) throw new Fault('Workspace role changed; reload and try again', 403);
      if (role === 'viewer' && !readRoutes.includes(url.pathname)) throw new Fault('This workspace role is read-only', 403);
      if (['/api/backup/preview', '/api/backup/restore'].includes(url.pathname) && role !== 'owner') throw new Fault('Workspace owner required', 403);

      const next = structuredClone(await workspace(id));
      let outResult;
      const previous = new Set(next.payments.map(p => p.id));

      if (url.pathname === '/api/accounting/export') return accounting(next, input);
      if (url.pathname === '/api/search') return search(next, input);
      if (url.pathname === '/api/forecast') return forecast(next, input);
      if (url.pathname === '/api/backup/export') return backup(next, id, activeKey());
      if (url.pathname === '/api/intelligence/route') return routeCorridor(next, input);
      if (url.pathname === '/api/intelligence/risk') return assessPaymentRisk(next, input);
      if (url.pathname === '/api/webhooks/verify-signature') return verifyWebhookSignature(input.secret, input.signature, input.payload);

      if (url.pathname === '/api/backup/preview') {
        const restored = previewBackup(input.archive, id, keyring.keys);
        const previewId = randomUUID();
        const revision = createHash('sha384').update(JSON.stringify(next)).digest('hex');
        for (const [key, value] of recoveryPreviews) {
          if (value.expiresAt < Date.now() || (value.actor === actor && value.workspaceId === id)) recoveryPreviews.delete(key);
        }
        recoveryPreviews.set(previewId, { workspaceId: id, actor, restored, revision, expiresAt: Date.now() + 300000 });
        return {
          previewId,
          createdAt: restored.createdAt,
          payments: restored.state.payments.length,
          invoices: restored.state.invoices?.length || 0,
          currentPayments: next.payments.length,
          warning: 'Restores this snapshot. Current state is saved as an encrypted safety copy. Newer records are replaced.'
        };
      }

      if (url.pathname === '/api/backup/restore') {
        const p = recoveryPreviews.get(input.previewId);
        if (!p || p.workspaceId !== id || p.actor !== actor || p.expiresAt < Date.now() || p.revision !== createHash('sha384').update(JSON.stringify(next)).digest('hex')) {
          throw new Fault('Preview expired or workspace changed; preview again', 409);
        }
        const safety = 'recovery-' + randomUUID() + '.json';
        await writeJson(safety, backup(next, id, activeKey()));
        const recovered = structuredClone(p.restored.state);
        recovered.keys = { ...recovered.keys, ...next.keys };
        recovered.batchKeys = { ...recovered.batchKeys, ...next.batchKeys };
        for (const item of recovered.payments) {
          const latest = next.payments.find(q => q.id === item.id);
          if (latest?.providerConfirmation) {
            item.providerConfirmation = latest.providerConfirmation;
            item.status = latest.status;
            item.external = latest.external;
          }
        }
        recovered.audit.unshift({ id: randomUUID(), action: 'Workspace recovered from verified backup; safety copy ' + safety, reference: id, at: new Date().toISOString(), actor });
        await save(recovered, id);
        recoveryPreviews.delete(input.previewId);
        return { ok: true, safetyCopy: safety };
      }

      if (url.pathname === '/api/quotes') outResult = quote(next, input);
      else if (url.pathname === '/api/payments') {
        outResult = pay(next, input, req.headers['idempotency-key']);
        if (outResult.status === 'completed') recordOutboxEvent(next, 'payment.settled', { paymentId: outResult.id, amountMinor: outResult.quote.amountMinor, currency: outResult.quote.sourceCurrency });
        else if (outResult.status === 'review') recordOutboxEvent(next, 'payment.review_required', { paymentId: outResult.id, amountMinor: outResult.quote.amountMinor, currency: outResult.quote.sourceCurrency });
      } else if (url.pathname === '/api/review') {
        if (!['owner', 'approver'].includes(role)) throw new Fault('Approver role required', 403);
        outResult = review(next, input.id, input.decision);
        if (outResult.status === 'completed') recordOutboxEvent(next, 'payment.settled', { paymentId: outResult.id, decision: input.decision });
      } else if (url.pathname === '/api/external/lifecycle') outResult = lifecycle(next, input, actor);
      else if (url.pathname === '/api/external/reference') outResult = recordReference(next, input);
      else if (url.pathname === '/api/beneficiaries') outResult = beneficiary(next, input);
      else if (url.pathname === '/api/reconcile') { outResult = reconcileStatement(next, input.rows); next.reconciliation = outResult; }
      else if (url.pathname === '/api/business/checklist') outResult = checklist(next, input);
      else if (url.pathname === '/api/business/reminder') outResult = reminder(next, input);
      else if (url.pathname === '/api/business/cost') outResult = cost(next, input);
      else if (url.pathname === '/api/business/invoice') outResult = invoice(next, input);
      else if (url.pathname === '/api/business/batch') outResult = batch(next, input, req.headers['idempotency-key']);
      else if (url.pathname === '/api/provider/check') outResult = await checkProvider(next, input, id);
      else if (url.pathname === '/api/approval') {
        outResult = approve(next, input, actor, role);
        recordOutboxEvent(next, 'approval.decided', { paymentId: input.id, status: outResult.status, actor });
      } else if (url.pathname === '/api/invoice-number') outResult = invoiceNumber(next, input);
      else if (url.pathname === '/api/templates/create') outResult = template(next, input);
      else if (url.pathname === '/api/templates/run') outResult = runTemplate(next, input);
      else if (url.pathname === '/api/wallets/rebalance') {
        outResult = rebalanceWallets(next, input);
        recordOutboxEvent(next, 'wallets.rebalanced', { paymentId: outResult.id, from: input.fromCurrency, to: input.toCurrency, amountMinor: outResult.quote.amountMinor });
      } else if (url.pathname === '/api/webhooks/endpoint') {
        outResult = input.action === 'remove' ? removeWebhookEndpoint(next, input.id) : addWebhookEndpoint(next, input);
      } else if (url.pathname === '/api/webhooks/simulate') {
        outResult = recordOutboxEvent(next, 'webhook.test', { actor, note: String(input.note || 'AtlasPay signed outbox verification') });
      } else if (url.pathname === '/api/security/anchor-ledger') {
        outResult = anchorMerkleCheckpoint(next, activeKey());
      } else if (url.pathname === '/api/security/verify') return security(next);
      else if (url.pathname === '/api/security/self-test') {
        const probe = { challenge: randomBytes(32).toString('hex') };
        const envelope = seal(probe, activeKey());
        return {
          kemRoundTrip: unseal(envelope, activeKey()).challenge === probe.challenge,
          dualSignature: verifyReceipt(signReceipt(probe, activeKey()), publicKeys(activeKey())),
          at: new Date().toISOString()
        };
      } else if (url.pathname === '/api/security/export') {
        const { keys, quotes, batchKeys, ...records } = next;
        const envelope = seal({ mode: 'sandbox', workspaceId: id, at: new Date().toISOString(), ...records }, activeKey());
        return { envelope, attestation: signReceipt(envelope, activeKey()), publicKey: publicKeys(activeKey()) };
      } else if (url.pathname === '/api/security/rotate') {
        if (id !== 'demo') throw new Fault('Key rotation is available in the workspace administrator session', 403);
        const ring = structuredClone(keyring);
        ring.keys.push(newKeys());
        ring.active = ring.keys.length - 1;
        await writeJson('keyring.json', ring);
        keyring = ring;
        next.audit.unshift({ id: randomBytes(16).toString('hex'), action: 'PQC keys rotated; prior keys retained', reference: activeKey().id, at: new Date().toISOString(), actor: 'Security administrator' });
        recordOutboxEvent(next, 'pqc.keys_rotated', { activeKeyId: activeKey().id });
        outResult = { activeKeyId: activeKey().id };
      } else {
        throw new Fault('Not found', 404);
      }

      tagPlans(next, previous, actor);
      await save(next, id);
      return outResult;
    });

    return json(200, result);
  } catch (e) {
    if (!(e instanceof Fault)) console.error(e);
    json(e.status || 500, { error: e instanceof Fault ? e.message : 'Internal server error' });
  }
});

server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
const port = Number(process.env.PORT || 8080);
const bindHost = process.env.HOST || (isCloud ? '0.0.0.0' : '127.0.0.1');
const isDirectRun = Boolean(process.argv[1] && (process.argv[1].endsWith('server.mjs') || process.argv[1].endsWith('server-v3.mjs')));
if (isDirectRun || !process.env.VERCEL) {
  server.listen(port, bindHost, () => console.log('AtlasPay server: http://127.0.0.1:' + server.address().port));
}
export default server;
export { server, isCloud };
