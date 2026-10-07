import { randomUUID, createHash } from 'node:crypto';
import { providerDetails, handoffChecks } from './external.mjs';
export const currencies = { USD: 2, EUR: 2, GBP: 2, INR: 2, SGD: 2, JPY: 0 };
const rates = { USD: 1000000n, EUR: 920000n, GBP: 780000n, INR: 83500000n, SGD: 1340000n, JPY: 148000000n };
export class Fault extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function reserved(state,currency,exclude) { return state.payments.filter(p=>p.status==='review'&&p.quote.sourceCurrency===currency&&p.id!==exclude).reduce((sum,p)=>sum+BigInt(p.quote.totalMinor),0n); }
export function available(state,currency,exclude) {return BigInt(state.wallets[currency])-reserved(state,currency,exclude);}
export function initialState() { return { wallets: { USD: '12500000', EUR: '4200000', GBP: '1800000', INR: '250000000', SGD: '3200000', JPY: '1500000' }, payments: [], journals: [], audit: [], keys: {}, quotes: {} }; }
export function balanced(postings) { const totals = {}; for (const p of postings) { const d = BigInt(p.debit), c = BigInt(p.credit); if(d < 0n || c < 0n || (d && c)) throw new Fault('Invalid posting'); totals[p.currency] = (totals[p.currency] || 0n) + d - c; } if(Object.values(totals).some(v => v !== 0n)) throw new Fault('Unbalanced journal'); }
export function quote(state, input, now = Date.now()) {
  const { sourceCurrency: from, targetCurrency: to, amountMinor, recipient, purpose } = input;
  if(typeof from!=='string' || typeof to!=='string' || !Object.hasOwn(currencies,from) || !Object.hasOwn(currencies,to) || typeof amountMinor !== 'string' || !/^[1-9]\d{0,11}$/.test(amountMinor)) throw new Fault('Choose a currency and a positive amount');
  if(typeof recipient !== 'string' || recipient.trim().length < 2 || recipient.length > 100 || typeof purpose !== 'string' || purpose.trim().length < 3 || purpose.length > 140) throw new Fault('Recipient and payment purpose are required');
  const amount = BigInt(amountMinor), fee = (amount * 35n + 9999n) / 10000n + (from === 'JPY' ? 150n : 100n);
  const received = amount * rates[to] * 10n ** BigInt(currencies[to]) / (rates[from] * 10n ** BigInt(currencies[from]));
  if(received < 1n) throw new Fault('Amount is too small for the destination currency');
  const q = { id: randomUUID(), sourceCurrency: from, targetCurrency: to, amountMinor, feeMinor: fee.toString(), totalMinor: (amount + fee).toString(), receiveMinor: received.toString(), recipient: recipient.trim(), purpose: purpose.trim(), expiresAt: now + 120000, rail: 'SIMULATED LOCAL', eta: 'Instant sandbox settlement' };
  state.quotes[q.id] = q; return q;
}
function audit(state, action, id) { state.audit.unshift({ id: randomUUID(), action, reference: id, at: new Date().toISOString(), actor: 'Sandbox operator' }); }
function settle(state, p) {
  const q = p.quote, total = BigInt(q.totalMinor), currency = q.sourceCurrency;
  if(available(state,currency,p.id) < total) throw new Fault('Insufficient wallet funds', 409);
  const postings = [{ account: 'wallet', currency, debit: q.totalMinor, credit: '0' }, { account: 'payout-clearing', currency, debit: '0', credit: q.amountMinor }, { account: 'fee-revenue', currency, debit: '0', credit: q.feeMinor }];
  balanced(postings); state.wallets[currency] = (BigInt(state.wallets[currency]) - total).toString();
  state.journals.unshift({ id: randomUUID(), paymentId: p.id, at: new Date().toISOString(), postings }); p.status = 'completed'; audit(state, 'Payment simulated and ledger posted', p.id);
}
export function pay(state, input, key, now = Date.now()) {
  if(typeof input.quoteId!=='string')throw new Fault('A quote ID is required');
  if(typeof key !== 'string' || !/^[\w-]{16,100}$/.test(key)) throw new Fault('A valid idempotency key is required');
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  if(Object.hasOwn(state.keys,key)) { if(state.keys[key].fingerprint !== fingerprint) throw new Fault('Idempotency key was used for another request', 409); const previous=state.payments.find(p => p.id === state.keys[key].id);if(!previous)throw new Fault('Payment belongs to newer recovery history; inspect safety copy',409);return previous; }
  const q = Object.hasOwn(state.quotes,input.quoteId) ? state.quotes[input.quoteId] : null; if(!q || q.expiresAt <= now) throw new Fault('Quote expired. Request a new quote', 409);
  if(state.payments.some(p => p.quote.id === q.id)) throw new Fault('Quote has already been submitted', 409);
  if(input.mode!==undefined&&input.mode!=='sandbox'&&input.mode!=='external')throw new Fault('Unknown payment mode');
  if(input.mode==='external'){
    const provider=providerDetails(input);
    const p={id:'ext_'+randomUUID(),quote:q,at:new Date().toISOString(),mode:'external',status:'awaiting_external_payment',checklist:handoffChecks(input),external:{provider,confirmation:'No provider confirmation',reference:null}};
    state.payments.unshift(p);state.keys[key]={fingerprint,id:p.id};audit(state,'External payment handoff prepared; no funds moved',p.id);return p;
  }
  const usdMinor = BigInt(q.amountMinor) * rates.USD * 100n / (rates[q.sourceCurrency] * 10n ** BigInt(currencies[q.sourceCurrency]));
  const p = { id: 'pi_' + randomUUID(), quote: q, at: new Date().toISOString(), status: usdMinor >= 1000000n ? 'review' : 'ready' };
  if(available(state,q.sourceCurrency)<BigInt(q.totalMinor))throw new Fault('Insufficient wallet funds',409);
  if(p.status === 'ready') settle(state, p); else audit(state, 'Payment held for sandbox amount review', p.id);
  state.payments.unshift(p); state.keys[key] = { fingerprint, id: p.id }; return p;
}
export function review(state, id, decision) { const p = state.payments.find(p => p.id === id); if(!p || p.status !== 'review') throw new Fault('Payment is not awaiting review', 409); if(decision === 'approve') settle(state,p); else if(decision === 'reject') { p.status = 'rejected'; audit(state,'Payment rejected',id); } else throw new Fault('Unknown decision'); return p; }
