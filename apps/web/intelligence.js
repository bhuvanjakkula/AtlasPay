const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dec = c => c === 'JPY' ? 0 : 2;
const money = (n, c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(n) / 10 ** dec(c));

export const intelligenceTitles = {
  intelligence: 'Intelligent FX routing & treasury analytics.'
};

function toMinor(value, c) {
  const v = String(value || '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(v) || (c === 'JPY' && v.includes('.'))) {
    throw Error('Enter a valid amount with up to ' + dec(c) + ' decimal places');
  }
  const d = dec(c);
  const [whole, fraction = ''] = v.split('.');
  const minor = (BigInt(whole) * 10n ** BigInt(d) + BigInt((fraction + '00').slice(0, d) || '0')).toString();
  if (BigInt(minor) <= 0n) throw Error('Amount must be greater than zero');
  return minor;
}

export function renderIntelligence(state, post, load, toast, openPaymentWith) {
  const content = $('#content');
  const codes = Object.keys(state.wallets || { USD: '0', EUR: '0', GBP: '0', INR: '0', SGD: '0', JPY: '0' });

  content.innerHTML = `
    <div class="panel">
      <div class="section-title">
        <div>
          <h2>Smart FX Corridor Router &amp; Risk Pre-Screen</h2>
          <p>Score settlement rails by FX spread, fixed fee, speed, and reliability while running automated AML split-structuring &amp; velocity checks.</p>
        </div>
        <span class="badge">AI ROUTING ENGINE</span>
      </div>
      <form id="route-form">
        <div class="row">
          <label>Pay from
            <select name="sourceCurrency">${codes.map(c => `<option ${c === 'USD' ? 'selected' : ''}>${c}</option>`).join('')}</select>
          </label>
          <label>Recipient receives
            <select name="targetCurrency">${codes.map(c => `<option ${c === 'EUR' ? 'selected' : ''}>${c}</option>`).join('')}</select>
          </label>
        </div>
        <div class="row">
          <label>Send amount
            <input name="amount" inputmode="decimal" required value="5000.00" placeholder="5000.00">
          </label>
          <label>Recipient (for risk &amp; structuring check)
            <input name="recipient" maxlength="100" placeholder="Acme Global Suppliers">
          </label>
        </div>
        <button class="primary wide">Analyze Optimal Rails &amp; Compliance Risk →</button>
      </form>
      <div id="route-output" class="feature-space"></div>
    </div>

    <div class="panel feature-space">
      <div class="section-title">
        <div>
          <h2>Multi-Currency Treasury Exposure &amp; Liquidity Radar</h2>
          <p>Normalized USD liquidity distribution, scheduled payout coverage, and automatic FX rebalancing advisories.</p>
        </div>
        <button id="refresh-analytics" class="link">Refresh Analytics ↻</button>
      </div>
      <div id="analytics-output"><p>Analyzing workspace wallets and scheduled commitments…</p></div>
    </div>
  `;

  const runRoute = async () => {
    const form = $('#route-form');
    const out = $('#route-output');
    if (!form || !out) return;
    const f = form.elements;
    try {
      const amountMinor = toMinor(f.amount.value, f.sourceCurrency.value);
      const data = await post('intelligence/route', {
        sourceCurrency: f.sourceCurrency.value,
        targetCurrency: f.targetCurrency.value,
        amountMinor,
        recipient: f.recipient.value.trim()
      });

      const riskCls = data.risk.level === 'HIGH' ? 'rejected' : data.risk.level === 'ELEVATED' ? 'review' : '';
      out.innerHTML = `
        <div class="risk-banner">
          <div>
            <strong>Compliance &amp; Structuring Risk Score: ${data.risk.score} / 100</strong>
            <small>USD Equivalent: ${money(data.risk.usdEquivalentMinor, 'USD')} · Recommendation: ${esc(data.risk.recommendation.replaceAll('_', ' '))}</small>
          </div>
          <span class="badge ${riskCls}">${esc(data.risk.level)} RISK</span>
        </div>
        ${data.risk.signals.length ? `<div class="signals-list">${data.risk.signals.map(s => `<div class="audit"><b>${esc(s.code)}</b><small>${esc(s.detail)}</small></div>`).join('')}</div>` : '<p class="match-ok">✓ No anomaly, structuring, or velocity flags detected for this corridor.</p>'}
        <div class="rail-grid feature-space">
          ${data.rails.map((r, i) => `
            <div class="rail-card ${i === 0 ? 'recommended' : ''}">
              <div class="rail-top">
                <strong>${esc(r.name)}</strong>
                ${i === 0 ? '<span class="badge">OPTIMAL ROUTE</span>' : `<span class="badge">Score ${r.optimizationScore}/100</span>`}
              </div>
              <div class="rail-metrics">
                <div><span>Recipient Receives</span><b>${money(r.receiveMinor, data.targetCurrency)}</b></div>
                <div><span>Total Fee + Spread</span><b>${money(r.totalCostMinor, data.sourceCurrency)} (${r.spreadBps} bps)</b></div>
                <div><span>Settlement ETA</span><b>${esc(r.eta)} · ${r.reliabilityPct}% SLA</b></div>
                <div><span>Savings vs SWIFT</span><b class="free-text">${money(r.savingsVsSwiftMinor, data.sourceCurrency)} (${r.savingsPercent.toFixed(1)}%)</b></div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="toolbar feature-space">
          <button type="button" id="launch-optimal-payment" class="primary">Launch Payment Quote with Optimal Corridor →</button>
        </div>
      `;

      const launchBtn = $('#launch-optimal-payment');
      if (launchBtn) {
        launchBtn.onclick = () => openPaymentWith({
          sourceCurrency: f.sourceCurrency.value,
          targetCurrency: f.targetCurrency.value,
          amount: f.amount.value,
          recipient: f.recipient.value.trim()
        });
      }
    } catch (err) {
      out.innerHTML = `<p class="match-err">${esc(err.message)}</p>`;
    }
  };

  const loadAnalytics = async () => {
    const box = $('#analytics-output');
    if (!box) return;
    try {
      const r = await fetch('/api/intelligence/analytics');
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      if (!$('#analytics-output')) return;

      box.innerHTML = `
        <div class="metrics">
          <div class="metric">
            <label>Total Normalized Treasury</label>
            <strong>${money(data.totalUsdEquivalentMinor, 'USD')}</strong>
            <small>Combined liquidity across 6 currencies</small>
          </div>
          <div class="metric">
            <label>Audit Chain Integrity</label>
            <strong class="crypto-label">${data.auditIntegrity.intact ? 'VERIFIED' : 'ALERT'}</strong>
            <small>${data.auditIntegrity.count} hash-chained ledger entries</small>
          </div>
          <div class="metric">
            <label>Shortfall Alerts</label>
            <strong>${String(data.rebalancingAdvice.length).padStart(2, '0')}</strong>
            <small>${data.rebalancingAdvice.length ? 'Rebalancing recommended' : 'All upcoming payouts covered'}</small>
          </div>
        </div>
        <div class="exposure-list feature-space">
          ${data.wallets.map(w => `
            <div class="exposure-row">
              <div class="exposure-head">
                <b>${esc(w.currency)} · ${money(w.availableMinor, w.currency)}</b>
                <span>${w.allocationPct.toFixed(1)}% of treasury (${money(w.usdEquivalentMinor, 'USD')})</span>
              </div>
              <progress class="treasury-bar" max="100" value="${Math.min(100, Math.max(1, Math.round(w.allocationPct)))}"></progress>
              <small>Reserved: ${money(w.reservedMinor, w.currency)} · Planned Outflows: ${money(w.plannedOutflowMinor, w.currency)}${BigInt(w.shortfallMinor) > 0n ? ` · Shortfall: ${money(w.shortfallMinor, w.currency)}` : ''}</small>
            </div>
          `).join('')}
        </div>
        ${data.rebalancingAdvice.length ? `
          <div class="panel feature-space">
            <h2>Recommended FX Liquidity Rebalancing</h2>
            ${data.rebalancingAdvice.map(a => `
              <div class="audit recipient-row">
                <div><b>Convert ${esc(a.suggestedFromCurrency)} → ${esc(a.targetCurrency)}</b><small>${esc(a.reason)} · Estimated funding needed: ${money(a.estimatedSourceMinor, a.suggestedFromCurrency)}</small></div>
                <button class="link" data-view="wallets">Rebalance in Wallets →</button>
              </div>
            `).join('')}
          </div>
        ` : ''}
      `;
    } catch (err) {
      if (box) box.innerHTML = `<p class="match-err">${esc(err.message)}</p>`;
    }
  };

  $('#route-form').onsubmit = async e => {
    e.preventDefault();
    const b = e.target.querySelector('button');
    b.disabled = true;
    await runRoute();
    b.disabled = false;
  };
  $('#refresh-analytics').onclick = () => loadAnalytics();
  runRoute();
  loadAnalytics();
}
