import { installFeatures, renderFeature, featureTitles } from './features.js';
import { installHandoff } from './external.js';
import { identity, refreshReminders } from './business.js';
import { simplifyNavigation } from './account-security.js';

installFeatures();
simplifyNavigation();

const $ = s => document.querySelector(s);
const codes = ['USD', 'EUR', 'GBP', 'INR', 'SGD', 'JPY'];
const dec = c => c === 'JPY' ? 0 : 2;

let state, view = 'readiness', q, key;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(n) / 10 ** dec(c));
const date = s => new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const titles = {
  ...featureTitles,
  overview: 'Global treasury, simplified.',
  payments: 'Payments across borders.',
  wallets: 'Six currencies. One home.',
  reviews: 'A second look, built in.',
  ledger: 'Every movement, accounted for.'
};

// Handle deep-linked views & update-password links from emails
const params = new URLSearchParams(window.location.search);
const initialView = params.get('view');
const initialAction = params.get('action');
if (initialView && Object.hasOwn(titles, initialView)) {
  view = initialView;
}
if (initialAction === 'reset-password') {
  view = 'accounts';
  window.__atlasPendingReset = {
    email: params.get('email') || '',
    token: params.get('token') || ''
  };
}
if (window.location.search) {
  window.history.replaceState({}, '', '/');
}

function downloadJson(body, name) {
  const u = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  URL.revokeObjectURL(u);
}

async function load() {
  const r = await fetch('/api/state');
  if (!r.ok) throw Error('Unable to load workspace');
  const next = await r.json();
  if (state && state.workspace?.id !== next.workspace.id) {
    clear();
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    $('#form').reset();
  }
  state = next;
  identity(state);
  render();
}

async function post(path, body, k) {
  const r = await fetch('/api/' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sandbox-Token': state.token,
      ...(k ? { 'Idempotency-Key': k } : {})
    },
    body: JSON.stringify(body)
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error);
  return result;
}

let toastTimer;
function toast(s) {
  const el = $('#toast');
  el.textContent = s;
  el.classList.add('toast-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('toast-visible'), 4000);
}

function openPaymentWith(prefill = {}) {
  const f = $('#form');
  f.reset();
  clear();
  if (prefill.recipient) f.elements.recipient.value = prefill.recipient;
  if (prefill.sourceCurrency) f.elements.sourceCurrency.value = prefill.sourceCurrency;
  if (prefill.targetCurrency) f.elements.targetCurrency.value = prefill.targetCurrency;
  else f.elements.targetCurrency.value = 'EUR';
  if (prefill.amount) f.elements.amount.value = prefill.amount;
  if (prefill.purpose) f.elements.purpose.value = prefill.purpose;
  $('#dialog').showModal();
}

installHandoff(() => q, post, load, toast);

function wallets() {
  return `<div class="wallets">${codes.map(c => `<div class="wallet"><div class="wallet-title"><span class="coin">${{ USD: '$', EUR: '€', GBP: '£', INR: '₹', SGD: 'S$', JPY: '¥' }[c]}</span>${c}</div><strong>${money(state.available[c], c)}</strong><small>AVAILABLE BALANCE</small><p>Reserved for review: ${money(state.reserved[c], c)}</p></div>`).join('')}</div>`;
}

function table(ps, review = false) {
  if (!ps.length) {
    return `<div class="empty">${review ? 'You’re all caught up.<br>Payments requiring review will appear here.' : 'Your first global payment starts here.<br>Create a quote to see your activity.'}</div>`;
  }
  return `<div class="table-wrap"><table><thead><tr><th>RECIPIENT</th><th>SEND AMOUNT</th><th>RECIPIENT ESTIMATE</th><th>STATUS</th><th>${review ? 'DECISION' : 'CREATED'}</th></tr></thead><tbody>${ps.map(p => `<tr><td>${esc(p.quote.recipient)}<small>${esc(p.quote.purpose)}</small></td><td>${money(p.quote.amountMinor, p.quote.sourceCurrency)}<small>Fee ${money(p.quote.feeMinor, p.quote.sourceCurrency)}</small></td><td>${money(p.quote.receiveMinor, p.quote.targetCurrency)}</td><td><span class="badge ${p.status}">${p.status === 'external_sent' ? 'Provider reports sent' : p.status === 'external_failed' ? 'Provider reports failed' : p.status === 'awaiting_external_payment' ? 'Awaiting external payment' : p.status === 'completed' ? 'Settled · PQC signed' : p.status === 'review' ? 'Needs review' : 'Rejected'}</span></td><td>${review ? `<div class="review-actions"><button data-decision="approve" data-id="${p.id}">Approve</button><button data-decision="reject" data-id="${p.id}">Reject</button></div>` : date(p.at)}</td></tr>`).join('')}</tbody></table></div>`;
}

function render() {
  $('#title').textContent = titles[view];
  $('#breadcrumb').textContent = view[0].toUpperCase() + view.slice(1);
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));

  if (Object.hasOwn(featureTitles, view)) {
    return renderFeature(view, state, post, load, toast, openPaymentWith);
  }

  if (view === 'overview') {
    $('#content').innerHTML = `
      <div class="metrics">
        <div class="metric"><label>USD available balance ↗</label><strong>${money(state.available.USD, 'USD')}</strong><small>Primary treasury liquidity</small></div>
        <div class="metric"><label>Completed payments</label><strong>${state.payments.filter(p => p.status === 'completed').length.toString().padStart(2, '0')}</strong><small>PQC-signed settlements</small></div>
        <div class="metric"><label>Pending review</label><strong>${state.payments.filter(p => p.status === 'review').length.toString().padStart(2, '0')}</strong><small>Operator decision required</small></div>
      </div>
      <div class="section-title"><h2>Your currency wallets</h2><button class="link" data-view="wallets">View wallets ↗</button></div>
      ${wallets()}
      <div class="lower">
        <div class="panel">
          <div class="section-title"><h2>Recent payments</h2><button class="link" data-view="payments">View all ↗</button></div>
          ${table(state.payments.slice(0, 5))}
        </div>
        <div class="panel network">
          <h2>A world of possibilities.</h2>
          <div class="globe">◎</div>
          <strong>Smart FX Corridor AI</strong>
          <p>Compare settlement rails, pre-screen compliance risk, and protect receipts with ML-DSA-65 PQC.</p>
          <hr>
          <button class="link network-cta" data-view="intelligence">Open Treasury AI &amp; FX ↗</button>
        </div>
      </div>`;
  }

  if (view === 'wallets') {
    $('#content').innerHTML = `
      ${wallets()}
      <div class="feature-grid feature-space">
        <div class="panel">
          <h2>Internal FX Treasury Rebalance</h2>
          <p>Convert liquidity between your six currency wallets with balanced double-entry journals and instant PQC receipt attestation.</p>
          <form id="rebalance-form">
            <div class="row">
              <label>From currency<select name="fromCurrency">${codes.map(c => `<option ${c === 'USD' ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
              <label>To currency<select name="toCurrency">${codes.map(c => `<option ${c === 'EUR' ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
            </div>
            <label>Amount to convert<input name="amount" inputmode="decimal" required placeholder="2500.00"></label>
            <button class="primary wide">Execute FX Rebalance →</button>
          </form>
        </div>
        <div class="panel">
          <h2>How your balances work</h2>
          <p>Each currency is held separately. Settled payouts debit your source wallet for principal plus fees, while pending review payments reserve funds and reduce available liquidity. Internal FX rebalances execute balanced clearing postings across both currency legs.</p>
          <button class="link" data-view="intelligence">Check Liquidity Shortfall Radar →</button>
        </div>
      </div>`;

    $('#rebalance-form').onsubmit = async e => {
      e.preventDefault();
      const b = e.target.querySelector('button');
      b.disabled = true;
      try {
        const f = e.target.elements, c = f.fromCurrency.value, d = dec(c), v = f.amount.value.trim();
        if (!/^\d+(?:\.\d{1,2})?$/.test(v) || (d === 0 && v.includes('.'))) throw Error('Enter a valid amount');
        const [whole, fraction = ''] = v.split('.');
        const amountMinor = (BigInt(whole) * 10n ** BigInt(d) + BigInt((fraction + '00').slice(0, d) || '0')).toString();
        await post('wallets/rebalance', { fromCurrency: c, toCurrency: f.toCurrency.value, amountMinor });
        await load();
        toast('Treasury FX rebalance settled with PQC receipt');
      } catch (err) {
        toast(err.message);
        b.disabled = false;
      }
    };
  }

  if (view === 'payments') {
    $('#content').innerHTML = `<div class="panel"><div class="toolbar"><input id="search" placeholder="Search recipients or purpose" aria-label="Search payments"><select id="filter" aria-label="Status"><option value="all">All statuses</option><option value="completed">Completed</option><option value="review">Needs review</option><option value="rejected">Rejected</option><option value="awaiting_external_payment">Awaiting external payment</option><option value="external_sent">Provider reports sent</option><option value="external_failed">Provider reports failed</option></select><button class="link" data-view="providers">Choose payment provider ↗</button><button class="link" id="export">Export CSV ↓</button></div><div id="table">${table(state.payments)}</div></div>`;
  }

  if (view === 'reviews') {
    $('#content').innerHTML = `<div class="panel"><h2>Pending decisions</h2>${table(state.payments.filter(p => p.status === 'review'), true)}</div>`;
  }

  if (view === 'ledger') {
    const chainMap = new Map((state.auditChain || []).map(c => [c.auditId, c]));
    $('#content').innerHTML = `
      <div id="chain-proof-box" class="panel chain-banner">
        <div class="recipient-row">
          <div>
            <h2>Cryptographic Hash-Chain &amp; Merkle Ledger</h2>
            <p id="chain-summary">Verifying SHA-384 audit chain integrity…</p>
          </div>
          <div class="toolbar">
            <button id="verify-chain-btn" class="link">Verify Chain</button>
            <button id="anchor-chain-btn" class="primary">Anchor Merkle Certificate ↓</button>
          </div>
        </div>
      </div>
      <div class="panel feature-space">
        <h2>Double-entry journals</h2>
        ${state.journals.map(j => `<div class="audit">${esc(j.paymentId)} · ${date(j.at)}<div class="table-wrap"><table><thead><tr><th>ACCOUNT</th><th>CURRENCY</th><th>DEBIT</th><th>CREDIT</th></tr></thead><tbody>${j.postings.map(p => `<tr><td>${p.account}</td><td>${p.currency}</td><td>${money(p.debit, p.currency)}</td><td>${money(p.credit, p.currency)}</td></tr>`).join('')}</tbody></table></div></div>`).join('') || '<div class="empty">Journals appear after a payment settles.</div>'}
      </div>
      <div class="panel feature-space">
        <h2>Hash-Chained Activity Trail</h2>
        ${state.audit.map(a => {
          const link = chainMap.get(a.id);
          return `<div class="audit"><b>${esc(a.action)}</b><small>${date(a.at)} · ${esc(a.actor)} · ${esc(a.reference)}</small>${link ? `<small class="hash-chip">Seq #${link.seq} · SHA-384: ${esc(link.entryHash.slice(0, 28))}…</small>` : ''}</div>`;
        }).join('') || '<div class="empty">No activity yet.</div>'}
      </div>`;

    const refreshChain = async () => {
      try {
        const res = await fetch('/api/security/ledger-proof');
        const proof = await res.json();
        const el = $('#chain-summary');
        if (el && res.ok) {
          el.textContent = `${proof.intact ? '✓ CHAIN INTACT' : '✕ TAMPER DETECTED'} · ${proof.count} chained entries · Merkle Root: ${proof.merkleRoot.slice(0, 28)}…`;
        }
      } catch {
        // Ignore transient disconnect
      }
    };
    refreshChain();
    $('#verify-chain-btn').onclick = () => refreshChain().then(() => toast('Merkle hash chain verified'));
    $('#anchor-chain-btn').onclick = async () => {
      const b = $('#anchor-chain-btn');
      b.disabled = true;
      try {
        const cert = await post('security/anchor-ledger', {});
        downloadJson(cert, 'atlaspay-merkle-checkpoint.json');
        await load();
        toast('Signed Merkle checkpoint anchored');
      } catch (err) {
        toast(err.message);
      } finally {
        b.disabled = false;
      }
    };
  }
}

document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.view) {
    view = b.dataset.view;
    render();
  }
  if (b.dataset.decision) {
    b.disabled = true;
    try {
      await post('review', { id: b.dataset.id, decision: b.dataset.decision });
      await load();
      toast('Review saved');
    } catch (err) {
      toast(err.message);
      b.disabled = false;
    }
  }
  if (b.id === 'export') {
    const rows = [
      ['Reference', 'Recipient', 'Source currency', 'Amount minor', 'Fee minor', 'Target currency', 'Received minor', 'Status'],
      ...state.payments.map(p => [p.id, p.quote.recipient, p.quote.sourceCurrency, p.quote.amountMinor, p.quote.feeMinor, p.quote.targetCurrency, p.quote.receiveMinor, p.status])
    ];
    const csv = rows.map(row => row.map(v => '"' + String(v).replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"').join(',')).join('\r\n');
    const u = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = u;
    a.download = 'atlaspay-payments.csv';
    a.click();
    URL.revokeObjectURL(u);
  }
});

function filter() {
  const term = $('#search').value.toLowerCase();
  const f = $('#filter').value;
  $('#table').innerHTML = table(state.payments.filter(p => (f === 'all' || p.status === f) && (p.quote.recipient + ' ' + p.quote.purpose).toLowerCase().includes(term)));
}

document.addEventListener('input', e => { if (e.target.id === 'search') filter(); });
document.addEventListener('change', e => { if (e.target.id === 'filter') filter(); });

codes.forEach(c => document.querySelectorAll('#form select').forEach(s => s.add(new Option(c, c))));
$('#form').elements.targetCurrency.value = 'EUR';
$('#new').onclick = () => $('#dialog').showModal();
$('#close').onclick = () => $('#dialog').close();

function clear() {
  q = null;
  key = null;
  $('#quote').innerHTML = '';
  $('#confirm').hidden = true;
  $('#get-quote').hidden = false;
}

$('#form').addEventListener('input', clear);
$('#form').addEventListener('change', clear);

$('#form').onsubmit = async e => {
  e.preventDefault();
  const b = $('#get-quote');
  b.disabled = true;
  $('#error').textContent = '';
  try {
    const f = e.target.elements, c = f.sourceCurrency.value, d = dec(c), v = f.amount.value.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(v) || (d === 0 && v.includes('.'))) {
      throw Error('Enter a valid amount with up to ' + d + ' decimal places');
    }
    const [whole, fraction = ''] = v.split('.');
    const minor = (BigInt(whole) * 10n ** BigInt(d) + BigInt((fraction + '00').slice(0, d) || '0')).toString();
    q = await post('quotes', { sourceCurrency: c, targetCurrency: f.targetCurrency.value, amountMinor: minor, recipient: f.recipient.value, purpose: f.purpose.value });
    key = crypto.randomUUID();
    $('#quote').innerHTML = `<div class="quote-box"><div><span>Fee</span><b>${money(q.feeMinor, c)}</b></div><div><span>Total wallet debit</span><b>${money(q.totalMinor, c)}</b></div><div><span>Recipient receives</span><b>${money(q.receiveMinor, q.targetCurrency)}</b></div><div><span>Valid for 2 minutes</span><span>Indicative FX</span></div></div>`;
    b.hidden = true;
    $('#confirm').hidden = false;
  } catch (err) {
    $('#error').textContent = err.message;
  } finally {
    b.disabled = false;
  }
};

$('#confirm').onclick = async () => {
  const b = $('#confirm');
  b.disabled = true;
  try {
    const p = await post('payments', { quoteId: q.id }, key);
    $('#dialog').close();
    $('#form').reset();
    clear();
    await load();
    toast(p.status === 'review' ? 'Payment added to compliance review queue' : 'Payment settled with PQC receipt');
  } catch (err) {
    $('#error').textContent = err.message;
  } finally {
    b.disabled = false;
  }
};

load().catch(e => $('#content').textContent = e.message);
setInterval(async () => {
  try {
    const r = await fetch('/api/state');
    if (!r.ok) return;
    const next = await r.json();
    if (next.workspace.id === state?.workspace.id) {
      state.reminders = next.reminders;
      refreshReminders(state);
    }
  } catch {
    // Ignore background poll error
  }
}, 60000);
