const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const webhooksTitles = {
  webhooks: 'Signed webhooks & transactional outbox.'
};

export async function renderWebhooks(state, post, load, toast) {
  const content = $('#content');
  content.innerHTML = '<div class="panel"><h2>Loading webhook &amp; outbox configuration…</h2></div>';

  try {
    const r = await fetch('/api/webhooks');
    const data = await r.json();
    if (!r.ok) throw Error(data.error);

    content.innerHTML = `
      <div class="feature-grid">
        <div class="panel">
          <h2>Register HTTPS Webhook Endpoint</h2>
          <p>Receive HMAC-SHA256 signed event notifications whenever payments settle, approvals complete, or PQC keys rotate.</p>
          <form id="webhook-add">
            <label>Public HTTPS Endpoint URL
              <input name="url" type="url" required placeholder="https://api.yourcompany.com/atlaspay/webhooks">
            </label>
            <label>Event Subscription
              <select name="event">
                ${data.supportedEvents.map(ev => `<option value="${esc(ev)}">${ev === '*' ? '* (All workspace events)' : esc(ev)}</option>`).join('')}
              </select>
            </label>
            <button class="primary wide">Add Webhook Endpoint</button>
          </form>
          <div id="webhook-secret-banner" class="feature-space"></div>
        </div>

        <div class="panel">
          <h2>Registered Endpoints (${data.endpoints.length})</h2>
          ${data.endpoints.map(ep => `
            <div class="audit recipient-row">
              <div>
                <b>${esc(ep.url)}</b>
                <small>Events: ${esc(ep.events.join(', '))} · Secret: <code>${esc(ep.secretMask)}</code></small>
              </div>
              <button class="link" data-remove-webhook="${esc(ep.id)}">Remove</button>
            </div>
          `).join('') || '<p>No endpoints registered yet. Events are still recorded in the transactional outbox below.</p>'}
          <div class="toolbar feature-space">
            <button id="simulate-webhook" class="primary">Emit Signed Test Event</button>
          </div>
        </div>
      </div>

      <div class="panel feature-space">
        <h2>Verify HMAC-SHA256 Webhook Signature</h2>
        <p>Validate <code>X-AtlasPay-Signature</code> headers with replay-window enforcement (300 seconds).</p>
        <form id="webhook-verify">
          <div class="row">
            <label>Signing Secret<input name="secret" required placeholder="whsec_..."></label>
            <label>X-AtlasPay-Signature Header<input name="signature" required placeholder="t=...,v1=..."></label>
          </div>
          <label>Canonical JSON Payload<textarea name="payload" rows="4" required spellcheck="false"></textarea></label>
          <button class="primary wide">Verify Signature</button>
        </form>
        <p id="webhook-verify-result" role="status"></p>
      </div>

      <div class="panel feature-space">
        <h2>Transactional Outbox Stream (${data.outbox.length})</h2>
        <p>Tamper-evident event log signed at emission with SHA-384 payload hash and HMAC-SHA256 headers.</p>
        ${data.outbox.map(ev => `
          <div class="audit">
            <div class="recipient-row">
              <div>
                <b>${esc(ev.type)}</b>
                <small>${esc(new Date(ev.at).toLocaleString())} · ID: ${esc(ev.id)}</small>
              </div>
              <span class="badge">${ev.matchedEndpoints?.length ? ev.matchedEndpoints.length + ' endpoint(s) signed' : 'Outbox recorded'}</span>
            </div>
            <small class="hash-chip">SHA-384: ${esc(ev.payloadHash.slice(0, 36))}… · Sig: ${esc(ev.signature.slice(0, 34))}…</small>
            <pre class="payload-view">${esc(JSON.stringify(ev.payload, null, 2))}</pre>
          </div>
        `).join('') || '<div class="empty">Settle a payment, rotate PQC keys, or emit a test event to inspect signed outbox records.</div>'}
      </div>
    `;

    $('#webhook-add').onsubmit = async e => {
      e.preventDefault();
      const f = e.target.elements;
      const b = e.target.querySelector('button');
      b.disabled = true;
      try {
        const created = await post('webhooks/endpoint', { url: f.url.value, events: [f.event.value] });
        toast('Webhook endpoint added');
        await renderWebhooks(state, post, load, toast);
        const banner = $('#webhook-secret-banner');
        if (banner && created.secret) {
          banner.innerHTML = `<div class="reset-link-card"><strong>Save Signing Secret Now</strong><p>Copy this HMAC secret — it is masked after reload:</p><code>${esc(created.secret)}</code></div>`;
        }
      } catch (err) {
        toast(err.message);
        b.disabled = false;
      }
    };

    content.querySelectorAll('[data-remove-webhook]').forEach(btn => {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await post('webhooks/endpoint', { action: 'remove', id: btn.dataset.removeWebhook });
          toast('Webhook endpoint removed');
          await renderWebhooks(state, post, load, toast);
        } catch (err) {
          toast(err.message);
          btn.disabled = false;
        }
      };
    });

    $('#simulate-webhook').onclick = async () => {
      const b = $('#simulate-webhook');
      b.disabled = true;
      try {
        await post('webhooks/simulate', { note: 'Manual outbox signature test' });
        toast('Signed test event emitted to outbox');
        await renderWebhooks(state, post, load, toast);
      } catch (err) {
        toast(err.message);
        b.disabled = false;
      }
    };

    $('#webhook-verify').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        const res = await post('webhooks/verify-signature', f);
        $('#webhook-verify-result').textContent = (res.valid ? '✓ VALID: ' : '✕ INVALID: ') + res.reason;
        $('#webhook-verify-result').className = res.valid ? 'match-ok' : 'match-err';
      } catch (err) {
        toast(err.message);
      }
    };
  } catch (err) {
    content.innerHTML = `<div class="panel"><p class="match-err">${esc(err.message)}</p></div>`;
  }
}
