const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const pricingTitles = {
  pricing: 'Transparent pricing for global businesses.'
};

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 29,
    stripeUrl: 'https://buy.stripe.com/test_bJefZ93aHgX33t71dRcjS0a',
    desc: 'For freelancers & emerging cross-border businesses.',
    features: [
      '2 Global Currency Wallets (USD, EUR)',
      'Standard FX conversion quotes',
      '1 Admin account & CSV export',
      'Local sandbox & receipt access',
      'Standard customer email support'
    ]
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 99,
    popular: true,
    stripeUrl: 'https://buy.stripe.com/test_00w4grcLh5el0gV1dRcjS0b',
    desc: 'For growing teams managing regular global vendor payouts.',
    features: [
      'All 6 Global Wallets (USD, EUR, GBP, INR, SGD, JPY)',
      'Up to 5 Team Members & Role Permissions',
      'Batch Payment Planning & Invoicing',
      'Native Post-Quantum Cryptographic Receipts',
      'Payment Reminders & Checklists'
    ]
  },
  {
    id: 'scale',
    name: 'Scale / Pro',
    price: 299,
    stripeUrl: 'https://buy.stripe.com/test_9B600b8v10Y5fbP7CfcjS0c',
    desc: 'For scaling companies needing advanced compliance & approvals.',
    features: [
      'Unlimited Team Members with Dual-Control Approval',
      'Real-time Double-Entry Ledger Reconciliation',
      'Lowest FX Spread Margin across all currencies',
      'Cashflow Forecasting & Recurring Templates',
      'Priority Support with Faster Review Queue'
    ]
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 1200,
    stripeUrl: 'https://buy.stripe.com/test_3cI3cneTpfSZ2p3bSvcjS0d',
    desc: 'For multinational corporations & financial institutions.',
    features: [
      'Custom Multi-Entity Workspace Isolation',
      'Custom SLA & Dedicated Compliance Manager',
      'Automated Outbox & Provider Webhook Integration',
      'Custom Onboarding & Audit Logging',
      '24/7 Dedicated Support Channel'
    ]
  }
];

const ADDONS = [
  {
    id: 'pqc-vault',
    name: '1. Dedicated PQC Key Vault & Hardware Security Module (HSM)',
    price: 199,
    tagline: 'High-Margin Quantum Security',
    desc: 'Hardware-isolated ML-KEM-768 key encapsulation, automated key rotation schedules, zero-trust attestation, and enterprise dual-signature validation (ML-DSA-65 + Ed25519).'
  },
  {
    id: 'accounting-sync',
    name: '2. Automated Accounting & Multi-Provider Sync Engine',
    price: 99,
    tagline: 'High-Margin Financial Automation',
    desc: 'Real-time double-entry GL ledger synchronization with ERPs (NetSuite, Xero, QuickBooks), live Wise/Stripe status webhook ingestion, and automated statement reconciliation.'
  },
  {
    id: 'multi-entity',
    name: '3. Multi-Entity & Global Subsidiary Governance',
    price: 149,
    tagline: 'High-Margin Enterprise Treasury',
    desc: 'Multi-tenant workspace isolation for holding groups, cross-border intercompany balance netting, and customizable multi-tier executive approval hierarchies.'
  }
];

export function renderPricing(state, toast) {
  const content = document.querySelector('#content');
  const storedPlan = localStorage.getItem('atlas_selected_plan') || 'growth';
  const storedAddons = JSON.parse(localStorage.getItem('atlas_selected_addons') || '["pqc-vault"]');
  const currentPlanObj = PLANS.find(p => p.id === storedPlan) || PLANS[1];

  content.innerHTML = `
    <div class="pricing-banner panel">
      <div class="banner-badge">★ SPECIAL CUSTOMER OFFER</div>
      <h2>60 Days Free Trial Across All Plans &amp; Add-ons</h2>
      <p>Test all enterprise cross-border treasury features, multi-currency wallets, and post-quantum cryptographic receipts risk-free. <b>$0 due today.</b> Cancel or adjust anytime before day 60.</p>
    </div>

    <div class="section-title">
      <h2>Monthly Subscription Plans (USD)</h2>
      <span class="badge">SECURED BY STRIPE CHECKOUT</span>
    </div>

    <div class="pricing-grid">
      ${PLANS.map(p => `
        <div class="pricing-card panel ${p.popular ? 'popular' : ''} ${storedPlan === p.id ? 'active-plan' : ''}">
          ${p.popular ? '<div class="card-ribbon">MOST POPULAR</div>' : ''}
          <div class="plan-header">
            <h3>${esc(p.name)}</h3>
            <p class="plan-desc">${esc(p.desc)}</p>
          </div>
          <div class="price-box">
            <span class="currency">$</span>
            <span class="amount">${p.price}</span>
            <span class="period">/ month</span>
          </div>
          <div class="trial-pill">✓ 60 Days Free Trial</div>
          <ul class="feature-list">
            ${p.features.map(f => `<li><span class="check">✓</span> ${esc(f)}</li>`).join('')}
          </ul>
          <div class="plan-actions">
            <a href="${p.stripeUrl}" target="_blank" rel="noopener noreferrer" class="primary wide stripe-btn" data-plan="${esc(p.id)}">
              Subscribe ($${p.price}/mo) ↗
            </a>
            <button class="link select-plan-btn" data-plan="${esc(p.id)}">
              ${storedPlan === p.id ? '● Selected in Workspace' : 'Select Plan for Workspace'}
            </button>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="section-title feature-space">
      <div>
        <h2>3 High-Margin Optional Add-ons</h2>
        <p>Enhance your global treasury with dedicated enterprise modules. All add-ons include a full 60-day free trial.</p>
      </div>
      <span class="badge">OPTIONAL ADD-ONS</span>
    </div>

    <div class="addons-grid">
      ${ADDONS.map(a => {
        const isSelected = storedAddons.includes(a.id);
        return `
          <div class="addon-card panel ${isSelected ? 'selected' : ''}" data-addon="${esc(a.id)}">
            <div class="addon-top">
              <div>
                <span class="addon-tag">${esc(a.tagline)}</span>
                <h3>${esc(a.name)}</h3>
              </div>
              <div class="addon-price">
                <strong>+$${a.price}</strong>
                <small>/ month</small>
              </div>
            </div>
            <p>${esc(a.desc)}</p>
            <div class="addon-footer">
              <span class="trial-pill small">✓ 60 Days Free Trial</span>
              <button class="toggle-addon-btn ${isSelected ? 'active' : ''}" data-addon-toggle="${esc(a.id)}">
                ${isSelected ? '✓ Add-on Included in Trial' : '+ Add with 60-Day Free Trial'}
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="pricing-summary panel feature-space">
      <h2>Your Customized Subscription Summary</h2>
      <div class="summary-details">
        <div class="summary-row">
          <span>Base Plan: <b id="summary-plan-name">${esc(currentPlanObj.name)}</b></span>
          <span id="summary-plan-price">$${currentPlanObj.price} / month</span>
        </div>
        <div class="summary-row">
          <span>Active Optional Add-ons (<span id="summary-addon-count">${storedAddons.length}</span> selected):</span>
          <span id="summary-addon-price">+$${storedAddons.reduce((sum, id) => sum + (ADDONS.find(a => a.id === id)?.price || 0), 0)} / mo</span>
        </div>
        <div class="summary-row total">
          <span>Recurring Total (after 60-Day Free Trial):</span>
          <span id="summary-total-price"><b>$${currentPlanObj.price + storedAddons.reduce((sum, id) => sum + (ADDONS.find(a => a.id === id)?.price || 0), 0)} / month</b></span>
        </div>
        <div class="summary-row due-today">
          <span>Amount due today (First 60 Days):</span>
          <strong class="free-text">$0.00 (60 Days Free Trial Active)</strong>
        </div>
      </div>
      <div class="toolbar feature-space">
        <a id="stripe-checkout-btn" href="${currentPlanObj.stripeUrl}" target="_blank" rel="noopener noreferrer" class="primary stripe-checkout-cta">
          💳 Complete Subscription on Stripe ($${currentPlanObj.price}/mo) ↗
        </a>
        <button id="activate-trial" class="link">Activate Free Trial in Local Workspace</button>
        <button class="link" data-view="overview">Return to Dashboard ↗</button>
      </div>
    </div>
  `;

  // Attach handlers
  content.querySelectorAll('.select-plan-btn').forEach(btn => {
    btn.onclick = () => {
      const planId = btn.dataset.plan;
      localStorage.setItem('atlas_selected_plan', planId);
      toast(`Selected ${PLANS.find(p => p.id === planId)?.name} plan!`);
      renderPricing(state, toast);
    };
  });

  content.querySelectorAll('[data-addon-toggle]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const addonId = btn.dataset.addonToggle;
      let currentAddons = JSON.parse(localStorage.getItem('atlas_selected_addons') || '["pqc-vault"]');
      if (currentAddons.includes(addonId)) {
        currentAddons = currentAddons.filter(id => id !== addonId);
        toast(`Removed add-on from selection.`);
      } else {
        currentAddons.push(addonId);
        toast(`Added ${ADDONS.find(a => a.id === addonId)?.name} with 60-day free trial!`);
      }
      localStorage.setItem('atlas_selected_addons', JSON.stringify(currentAddons));
      renderPricing(state, toast);
    };
  });

  const activateBtn = content.querySelector('#activate-trial');
  if (activateBtn) {
    activateBtn.onclick = () => {
      activateBtn.disabled = true;
      toast('60-Day Free Trial is now active on your workspace!');
      setTimeout(() => {
        activateBtn.disabled = false;
      }, 1500);
    };
  }
}
