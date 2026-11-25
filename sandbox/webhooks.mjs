import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Fault } from './engine.mjs';
import { canonical } from './pqc.mjs';

export const WEBHOOK_EVENTS = [
  '*',
  'payment.settled',
  'payment.review_required',
  'approval.decided',
  'pqc.keys_rotated',
  'wallets.rebalanced',
  'account.password_reset_requested',
  'account.password_updated',
  'webhook.test'
];

function assertSafeHttpsUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Fault('Enter a valid HTTPS webhook URL');
  }
  const host = u.hostname.toLowerCase();
  if (
    u.protocol !== 'https:'
    || u.username
    || u.password
    || u.search
    || u.hash
    || ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host)
    || /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    || host.endsWith('.local')
  ) {
    throw new Fault('Webhook URL must be a public HTTPS endpoint without credentials or query parameters');
  }
  return u.toString();
}

/**
 * Generates an HMAC-SHA256 webhook signature header (`t=<sec>,v1=<hex>`).
 */
export function signWebhookPayload(secret, timestampSec, payload) {
  const body = typeof payload === 'string' ? payload : canonical(payload);
  const sig = createHmac('sha256', secret).update(`${timestampSec}.${body}`).digest('hex');
  return `t=${timestampSec},v1=${sig}`;
}

/**
 * Verifies an HMAC-SHA256 webhook signature header with replay window protection.
 */
export function verifyWebhookSignature(secret, header, payload, nowSec = Math.floor(Date.now() / 1000)) {
  if (typeof secret !== 'string' || typeof header !== 'string') return { valid: false, reason: 'Missing secret or signature header' };
  const parts = Object.fromEntries(header.split(',').map(p => p.trim().split('=')));
  const ts = Number(parts.t);
  if (!Number.isFinite(ts) || !parts.v1 || !/^[0-9a-f]{64}$/i.test(parts.v1)) {
    return { valid: false, reason: 'Malformed X-AtlasPay-Signature header' };
  }
  if (Math.abs(nowSec - ts) > 300) {
    return { valid: false, reason: 'Timestamp outside 300-second replay window' };
  }
  const body = typeof payload === 'string' ? payload : canonical(payload);
  const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  const valid = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(parts.v1, 'hex'));
  return { valid, reason: valid ? 'HMAC-SHA256 signature verified' : 'Signature digest mismatch' };
}

/**
 * Registers an HTTPS webhook subscription and returns its masked record plus one-time signing secret.
 */
export function addWebhookEndpoint(state, input) {
  const url = assertSafeHttpsUrl(input.url);
  const events = Array.isArray(input.events) && input.events.length ? input.events : ['*'];
  if (events.some(e => !WEBHOOK_EVENTS.includes(e))) {
    throw new Fault('Unsupported webhook event filter selected');
  }
  state.webhooks ??= [];
  if (state.webhooks.length >= 10) throw new Fault('Maximum 10 webhook endpoints per workspace', 409);
  if (state.webhooks.some(w => w.url === url)) throw new Fault('Webhook endpoint already registered', 409);

  const secret = 'whsec_' + randomBytes(24).toString('hex');
  const endpoint = {
    id: randomUUID(),
    url,
    events,
    secret,
    createdAt: new Date().toISOString(),
    active: true
  };
  state.webhooks.unshift(endpoint);
  return { ...endpoint, secretPreview: secret.slice(0, 12) + '…' };
}

/**
 * Removes a webhook subscription by ID.
 */
export function removeWebhookEndpoint(state, id) {
  state.webhooks ??= [];
  const before = state.webhooks.length;
  state.webhooks = state.webhooks.filter(w => w.id !== id);
  if (state.webhooks.length === before) throw new Fault('Webhook endpoint not found', 404);
  return { ok: true };
}

/**
 * Appends a signed transactional outbox event to workspace state.
 */
export function recordOutboxEvent(state, type, data) {
  state.outbox ??= [];
  const id = 'evt_' + randomUUID();
  const at = new Date().toISOString();
  const ts = Math.floor(Date.now() / 1000);
  const payload = { id, type, at, data };
  const body = canonical(payload);
  const payloadHash = createHash('sha384').update(body).digest('hex');
  const signingKey = state.webhooks?.[0]?.secret || 'whsec_atlaspay_outbox_local';
  const signature = signWebhookPayload(signingKey, ts, body);

  const matchedEndpoints = (state.webhooks || [])
    .filter(w => w.active && (w.events.includes('*') || w.events.includes(type)))
    .map(w => ({ id: w.id, url: w.url, signature: signWebhookPayload(w.secret, ts, body), status: 'signed_ready' }));

  const event = { id, type, at, payloadHash, signature, matchedEndpoints, payload };
  state.outbox.unshift(event);
  state.outbox = state.outbox.slice(0, 50);
  return event;
}

/**
 * Returns public webhook summary with secrets masked and latest outbox events.
 */
export function webhookOverview(state) {
  return {
    supportedEvents: WEBHOOK_EVENTS,
    endpoints: (state.webhooks || []).map(w => ({
      id: w.id,
      url: w.url,
      events: w.events,
      createdAt: w.createdAt,
      active: w.active,
      secretMask: w.secret.slice(0, 12) + '••••••••'
    })),
    outbox: state.outbox || []
  };
}
