import { randomUUID } from 'node:crypto';
import { currencies, rates, available, reserved, balanced, Fault } from './engine.mjs';
import { minor } from './business.mjs';
import { verifyAuditChain } from './audit-chain.mjs';

const RAILS = [
  { id: 'atlas_local', name: 'AtlasPay Local Instant Bridge', spreadBps: 12n, fixedMinor: 50n, jpyFixed: 75n, eta: 'Instant · < 2 min', speedScore: 98, reliabilityPct: 99.94 },
  { id: 'sepa_local', name: 'SEPA / Faster Payments / UPI Express', spreadBps: 18n, fixedMinor: 80n, jpyFixed: 120n, eta: '5–30 min', speedScore: 90, reliabilityPct: 99.78 },
  { id: 'wise_mid', name: 'Wise Mid-Market API Rail', spreadBps: 28n, fixedMinor: 100n, jpyFixed: 150n, eta: '1–4 hours', speedScore: 82, reliabilityPct: 99.85 },
  { id: 'remitly_express', name: 'Remitly Express Corridor', spreadBps: 55n, fixedMinor: 120n, jpyFixed: 180n, eta: '10–45 min', speedScore: 85, reliabilityPct: 99.60 },
  { id: 'swift_wire', name: 'SWIFT Priority Wire (Benchmark)', spreadBps: 145n, fixedMinor: 2500n, jpyFixed: 3500n, eta: '1–3 business days', speedScore: 42, reliabilityPct: 99.20 }
];

function toUsdMinor(amountMinor, currency) {
  return BigInt(amountMinor) * rates.USD * 100n / (rates[currency] * 10n ** BigInt(currencies[currency]));
}

function validateAmount(sourceCurrency, targetCurrency, amountMinor) {
  if (!Object.hasOwn(currencies, sourceCurrency) || !Object.hasOwn(currencies, targetCurrency)) {
    throw new Fault('Unsupported currency selected');
  }
  if (typeof amountMinor !== 'string' || !/^[1-9]\d{0,11}$/.test(amountMinor)) {
    throw new Fault('Provide a valid positive minor-unit amount');
  }
  return BigInt(amountMinor);
}

/**
 * Evaluates payment compliance, split-structuring, velocity, and duplicate risk signals.
 */
export function assessPaymentRisk(state, input, now = Date.now()) {
  const from = input.sourceCurrency || 'USD';
  const to = input.targetCurrency || 'EUR';
  const amount = validateAmount(from, to, String(input.amountMinor || '0'));
  const recipient = String(input.recipient || '').trim().toLowerCase();
  const usdMinor = toUsdMinor(amount, from);
  const signals = [];
  let score = 8;

  if (usdMinor >= 1000000n) {
    score += 36;
    signals.push({ code: 'HIGH_VALUE_THRESHOLD', severity: 'elevated', detail: 'Transfer meets or exceeds USD 10,000 compliance review threshold' });
  }

  const dayAgo = now - 86400000;
  const hourAgo = now - 3600000;
  const recentPayments = (state.payments || []).filter(p => Date.parse(p.at) >= dayAgo && p.status !== 'rejected' && p.status !== 'plan_cancelled');
  const recentHourCount = recentPayments.filter(p => Date.parse(p.at) >= hourAgo).length;

  if (recentHourCount >= 3) {
    score += 18;
    signals.push({ code: 'VELOCITY_BURST', severity: 'elevated', detail: `${recentHourCount} transfers initiated within the past 60 minutes` });
  }

  if (recipient) {
    const sameRecipient24h = recentPayments.filter(p => p.quote.recipient.trim().toLowerCase() === recipient);
    const cumulativeUsd = sameRecipient24h.reduce((sum, p) => sum + toUsdMinor(p.quote.amountMinor, p.quote.sourceCurrency), 0n) + usdMinor;
    if (usdMinor < 1000000n && sameRecipient24h.length >= 1 && cumulativeUsd >= 1000000n) {
      score += 42;
      signals.push({ code: 'SPLIT_STRUCTURING_ALERT', severity: 'high', detail: 'Cumulative 24h transfers to this recipient reach or exceed USD 10,000 equivalent' });
    }
    const duplicate = sameRecipient24h.some(p => p.quote.amountMinor === amount.toString() && p.quote.sourceCurrency === from);
    if (duplicate) {
      score += 22;
      signals.push({ code: 'DUPLICATE_PATTERN', severity: 'elevated', detail: 'Identical amount and currency sent to this recipient in the past 24h' });
    }
    const saved = (state.beneficiaries || []).some(b => b.name.trim().toLowerCase() === recipient);
    if (!saved) {
      score += 10;
      signals.push({ code: 'UNSAVED_RECIPIENT', severity: 'info', detail: 'Recipient is not yet registered in the saved beneficiary directory' });
    }
  }

  score = Math.min(100, score);
  const level = score >= 60 ? 'HIGH' : score >= 30 ? 'ELEVATED' : 'LOW';
  const recommendation = score >= 60 ? 'DUAL_APPROVAL_REQUIRED' : score >= 30 ? 'ENHANCED_REVIEW' : 'AUTO_CLEAR';
  return { score, level, recommendation, usdEquivalentMinor: usdMinor.toString(), signals };
}

/**
 * Scores settlement rails by FX spread, fee, speed, and reliability for a currency corridor.
 */
export function routeCorridor(state, input, now = Date.now()) {
  const from = input.sourceCurrency;
  const to = input.targetCurrency;
  const amount = validateAmount(from, to, String(input.amountMinor || ''));
  const sameCurrency = from === to;
  const baseReceive = amount * rates[to] * 10n ** BigInt(currencies[to]) / (rates[from] * 10n ** BigInt(currencies[from]));
  if (baseReceive < 1n) throw new Fault('Amount is too small for destination currency');

  const evaluated = RAILS.map(rail => {
    const spreadBps = sameCurrency ? 0n : rail.spreadBps;
    const spreadCost = (amount * spreadBps + 9999n) / 10000n;
    const fixedFee = from === 'JPY' ? rail.jpyFixed : rail.fixedMinor;
    const totalCost = spreadCost + fixedFee;
    const receiveMinor = baseReceive * (10000n - spreadBps) / 10000n;
    return {
      id: rail.id,
      name: rail.name,
      eta: rail.eta,
      speedScore: rail.speedScore,
      reliabilityPct: rail.reliabilityPct,
      spreadBps: Number(spreadBps),
      fixedFeeMinor: fixedFee.toString(),
      fxSpreadMinor: spreadCost.toString(),
      totalCostMinor: totalCost.toString(),
      receiveMinor: (receiveMinor > 0n ? receiveMinor : 1n).toString(),
      totalDebitMinor: (amount + totalCost).toString()
    };
  });

  const swiftCost = BigInt(evaluated.find(r => r.id === 'swift_wire').totalCostMinor);
  const scored = evaluated.map(item => {
    const cost = BigInt(item.totalCostMinor);
    const savings = swiftCost > cost ? swiftCost - cost : 0n;
    const savingsPct = swiftCost > 0n ? Number(savings * 10000n / swiftCost) / 100 : 0;
    const costScore = swiftCost > 0n ? Math.min(100, Math.round(Number(savings * 100n / swiftCost))) : 50;
    const optimizationScore = Math.min(100, Math.round(costScore * 0.55 + item.speedScore * 0.30 + item.reliabilityPct * 0.15));
    return { ...item, savingsVsSwiftMinor: savings.toString(), savingsPercent: savingsPct, optimizationScore };
  }).sort((a, b) => b.optimizationScore - a.optimizationScore);

  const risk = assessPaymentRisk(state, { ...input, amountMinor: amount.toString() }, now);
  return {
    sourceCurrency: from,
    targetCurrency: to,
    amountMinor: amount.toString(),
    recommendedRail: scored[0].id,
    rails: scored,
    risk
  };
}

/**
 * Aggregates multi-currency treasury exposure, planned liquidity gaps, and FX rebalancing advice.
 */
export function treasuryAnalytics(state, keys = []) {
  let totalUsdMinor = 0n;
  const plannedByCurrency = Object.fromEntries(Object.keys(currencies).map(c => [c, 0n]));

  for (const p of state.payments || []) {
    if (p.mode === 'external' && p.status === 'awaiting_external_payment' && !p.archivedAt) {
      plannedByCurrency[p.quote.sourceCurrency] += BigInt(p.quote.amountMinor) + BigInt(p.actualCost?.feeMinor ?? p.quote.feeMinor);
    }
  }
  for (const t of state.templates || []) {
    if (!t.runs?.[t.nextDate]) {
      const m = minor(t.details.amount, t.details.sourceCurrency);
      plannedByCurrency[t.details.sourceCurrency] += BigInt(m);
    }
  }

  const rawWallets = Object.keys(currencies).map(currency => {
    const avail = available(state, currency);
    const res = reserved(state, currency);
    const total = BigInt(state.wallets[currency]);
    const planned = plannedByCurrency[currency];
    const usdEq = toUsdMinor(total, currency);
    totalUsdMinor += usdEq;
    return {
      currency,
      availableMinor: avail.toString(),
      reservedMinor: res.toString(),
      totalMinor: total.toString(),
      plannedOutflowMinor: planned.toString(),
      shortfallMinor: planned > avail ? (planned - avail).toString() : '0',
      usdEquivalentMinor: usdEq.toString()
    };
  });

  const wallets = rawWallets.map(w => ({
    ...w,
    allocationPct: totalUsdMinor > 0n ? Number(BigInt(w.usdEquivalentMinor) * 1000n / totalUsdMinor) / 10 : 0
  }));

  const usdSurplus = BigInt(wallets.find(w => w.currency === 'USD')?.availableMinor || '0');
  const rebalancingAdvice = wallets
    .filter(w => BigInt(w.shortfallMinor) > 0n)
    .map(w => {
      const neededUsd = toUsdMinor(w.shortfallMinor, w.currency);
      return {
        targetCurrency: w.currency,
        shortfallMinor: w.shortfallMinor,
        suggestedFromCurrency: usdSurplus > neededUsd ? 'USD' : 'EUR',
        estimatedSourceMinor: neededUsd.toString(),
        reason: `Upcoming ${w.currency} plans exceed available ${w.currency} balance`
      };
    });

  const chain = verifyAuditChain(state, keys);
  return {
    totalUsdEquivalentMinor: totalUsdMinor.toString(),
    wallets,
    rebalancingAdvice,
    paymentsCount: (state.payments || []).length,
    externalPlansCount: (state.payments || []).filter(p => p.mode === 'external').length,
    auditIntegrity: { intact: chain.intact, count: chain.count, merkleRoot: chain.merkleRoot }
  };
}

/**
 * Executes a balanced internal FX rebalance across two workspace currency wallets.
 */
export function rebalanceWallets(state, input) {
  const from = input.fromCurrency;
  const to = input.toCurrency;
  if (from === to) throw new Fault('Choose two different currencies for FX rebalancing');
  const amount = validateAmount(from, to, String(input.amountMinor || ''));
  const fee = (amount * 12n + 9999n) / 10000n + (from === 'JPY' ? 75n : 50n);
  const total = amount + fee;
  if (available(state, from) < total) {
    throw new Fault(`Insufficient available ${from} balance for FX rebalance`, 409);
  }
  const receive = amount * rates[to] * 10n ** BigInt(currencies[to]) / (rates[from] * 10n ** BigInt(currencies[from]));
  if (receive < 1n) throw new Fault('Rebalance amount too small for destination currency');

  const paymentId = 'fx_' + randomUUID();
  const at = new Date().toISOString();
  const postings = [
    { account: 'wallet', currency: from, debit: total.toString(), credit: '0' },
    { account: 'fx-clearing', currency: from, debit: '0', credit: amount.toString() },
    { account: 'fee-revenue', currency: from, debit: '0', credit: fee.toString() },
    { account: 'fx-clearing', currency: to, debit: receive.toString(), credit: '0' },
    { account: 'wallet', currency: to, debit: '0', credit: receive.toString() }
  ];
  balanced(postings);

  state.wallets[from] = (BigInt(state.wallets[from]) - total).toString();
  state.wallets[to] = (BigInt(state.wallets[to]) + receive).toString();

  const quoteSnapshot = {
    id: randomUUID(),
    sourceCurrency: from,
    targetCurrency: to,
    amountMinor: amount.toString(),
    feeMinor: fee.toString(),
    totalMinor: total.toString(),
    receiveMinor: receive.toString(),
    recipient: `Internal Treasury (${from} → ${to})`,
    purpose: 'Multi-currency liquidity rebalance',
    expiresAt: Date.now() + 120000,
    rail: 'ATLAS_FX_INTERNAL',
    eta: 'Instant internal settlement'
  };
  const record = { id: paymentId, quote: quoteSnapshot, at, status: 'completed', kind: 'fx_rebalance' };
  state.payments.unshift(record);
  state.journals.unshift({ id: randomUUID(), paymentId, at, postings });
  state.audit.unshift({ id: randomUUID(), action: `Treasury FX rebalance ${from} → ${to}`, reference: paymentId, at, actor: 'Treasury operator' });
  return record;
}
