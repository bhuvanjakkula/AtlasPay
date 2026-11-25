const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 12) score += 40;
  else if (pw.length >= 8) score += 20;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 20;
  if (/\d/.test(pw)) score += 20;
  if (/[^A-Za-z0-9]/.test(pw)) score += 20;
  return Math.min(100, score);
}

export function installAccountSecurity(post, load, toast) {
  const content = document.querySelector('#content');
  const section = document.createElement('div');
  section.className = 'panel feature-space';
  section.innerHTML = `
    <h2>Account Security, Forgot Password &amp; Recovery</h2>
    <p>Request an update password link for your registered email, configure TOTP authenticator MFA, or verify your email address. For assistance, contact <a href="mailto:contact@apolloaiglobalcompany.com">contact@apolloaiglobalcompany.com</a>.</p>
    <div class="feature-grid">
      <form id="forgot-password-card" data-auth="reset-request">
        <h2>Forgot password?</h2>
        <p>Enter your registered email address to receive your single-use update password link.</p>
        <label>Registered Email
          <input name="email" type="email" required autocomplete="email" placeholder="you@company.com">
        </label>
        <button class="primary wide">Send Update Password Link</button>
        <div id="reset-link-box" class="feature-space"></div>
      </form>

      <form id="update-password-card" data-auth="reset-complete">
        <h2>Update password</h2>
        <p>Enter your new password and confirmation password below.</p>
        <label>Registered Email
          <input name="email" type="email" required autocomplete="email" placeholder="you@company.com">
        </label>
        <label>Recovery Token (auto-filled from Update Password Link)
          <input name="token" required minlength="64" maxlength="64" autocomplete="off" placeholder="64-character recovery token">
        </label>
        <label>New Password (12–128 characters)
          <div class="pw-wrap">
            <input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password" placeholder="At least 12 characters">
            <button type="button" class="link pw-toggle" data-toggle-pw="password">Show</button>
          </div>
        </label>
        <progress id="pw-strength-bar" class="strength-bar" max="100" value="0"></progress>
        <small id="pw-strength-label">Password strength: enter 12+ characters</small>
        <label>Confirmation Password
          <div class="pw-wrap">
            <input name="confirmPassword" type="password" minlength="12" maxlength="128" required autocomplete="new-password" placeholder="Re-enter new password">
            <button type="button" class="link pw-toggle" data-toggle-pw="confirmPassword">Show</button>
          </div>
        </label>
        <small id="pw-match-status" class="match-status"></small>
        <button class="primary wide">Update Password</button>
      </form>

      <form data-auth="verify-request">
        <h2>Verify email</h2>
        <p>Sign in to request an email verification link for your registered address.</p>
        <button class="primary wide">Request verification email</button>
      </form>

      <form data-auth="verify-complete">
        <h2>Confirm email token</h2>
        <label>Verification token<input name="token" minlength="64" maxlength="64" required autocomplete="off"></label>
        <button class="primary wide">Confirm token</button>
      </form>

      <form data-auth="mfa-start">
        <h2>Set up authenticator MFA</h2>
        <label>Current password<input name="password" type="password" required autocomplete="current-password"></label>
        <button class="primary wide">Start authenticator setup</button>
        <div id="mfa-enrollment"></div>
      </form>

      <form data-auth="mfa-enable">
        <h2>Enable MFA</h2>
        <label>Authenticator code<input name="code" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label>
        <button class="primary wide">Enable MFA</button>
        <p>Save the recovery codes shown after enabling MFA. Password recovery does not remove MFA.</p>
      </form>

      <form data-auth="mfa-disable">
        <h2>Disable MFA</h2>
        <label>Current password<input name="password" type="password" required></label>
        <label>Fresh authenticator code<input name="code" pattern="[0-9]{6}" required></label>
        <button class="primary wide">Disable MFA</button>
      </form>

      <form data-auth="mfa-recovery">
        <h2>Replace recovery codes</h2>
        <label>Current password<input name="password" type="password" required></label>
        <label>Fresh authenticator code<input name="code" pattern="[0-9]{6}" required></label>
        <button class="primary wide">Generate 10 new recovery codes</button>
        <p>Replaces all previous codes.</p>
      </form>
    </div>
    <div id="recovery-codes" role="status"></div>
    <p id="auth-status" role="status"></p>
  `;
  content.append(section);
  installActivity(post, toast, section);

  const updateForm = section.querySelector('#update-password-card');
  const pwInput = updateForm.elements.password;
  const confirmInput = updateForm.elements.confirmPassword;
  const strengthBar = section.querySelector('#pw-strength-bar');
  const strengthLabel = section.querySelector('#pw-strength-label');
  const matchStatus = section.querySelector('#pw-match-status');

  const refreshPasswordChecks = () => {
    const pw = pwInput.value;
    const cf = confirmInput.value;
    const s = passwordStrength(pw);
    strengthBar.value = s;
    strengthLabel.textContent = pw.length === 0
      ? 'Password strength: enter 12+ characters'
      : s >= 80 ? 'Password strength: Strong' : s >= 50 ? 'Password strength: Moderate' : 'Password strength: Needs 12+ mixed characters';

    if (!cf) {
      matchStatus.textContent = '';
      matchStatus.className = 'match-status';
    } else if (pw === cf) {
      matchStatus.textContent = '✓ New password and confirmation password match';
      matchStatus.className = 'match-status match-ok';
    } else {
      matchStatus.textContent = '✕ Passwords do not match';
      matchStatus.className = 'match-status match-err';
    }
  };

  pwInput.addEventListener('input', refreshPasswordChecks);
  confirmInput.addEventListener('input', refreshPasswordChecks);

  section.querySelectorAll('[data-toggle-pw]').forEach(btn => {
    btn.onclick = () => {
      const target = updateForm.elements[btn.dataset.togglePw];
      if (!target) return;
      target.type = target.type === 'password' ? 'text' : 'password';
      btn.textContent = target.type === 'password' ? 'Show' : 'Hide';
    };
  });

  const applyResetLinkParams = (email, token) => {
    updateForm.elements.email.value = email || '';
    updateForm.elements.token.value = token || '';
    updateForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    pwInput.focus();
  };

  if (window.__atlasPendingReset) {
    const { email, token } = window.__atlasPendingReset;
    window.__atlasPendingReset = null;
    applyResetLinkParams(email, token);
    toast('Update password link opened — enter your new password and confirmation password.');
  }

  section.querySelectorAll('[data-auth]').forEach(form => {
    form.onsubmit = async e => {
      e.preventDefault();
      const b = form.querySelector('button[type="submit"], button:not([type])');
      if (b?.disabled) return;

      if (form.dataset.auth === 'reset-complete') {
        if (form.elements.password.value !== form.elements.confirmPassword.value) {
          toast('New password and confirmation password do not match');
          matchStatus.textContent = '✕ Passwords do not match';
          matchStatus.className = 'match-status match-err';
          confirmInput.focus();
          return;
        }
      }

      if (b) b.disabled = true;
      try {
        const result = await post('accounts/' + form.dataset.auth, Object.fromEntries(new FormData(form)));
        if (form.dataset.auth === 'reset-request') {
          const box = section.querySelector('#reset-link-box');
          if (result.resetUrl) {
            const parsed = new URL(result.resetUrl);
            const resetEmail = parsed.searchParams.get('email') || result.email;
            const resetToken = parsed.searchParams.get('token') || '';
            box.innerHTML = `
              <div class="reset-link-card">
                <strong>Update Password Link Ready</strong>
                <p>Registered email: <b>${esc(result.email)}</b> · Expires: ${esc(new Date(result.expiresAt).toLocaleTimeString())}</p>
                <div class="toolbar">
                  <a href="${esc(result.resetUrl)}" id="open-reset-link-btn" class="primary provider-link">Open Update Password Link →</a>
                  <button type="button" id="copy-reset-link-btn" class="link">Copy Link</button>
                </div>
              </div>
            `;
            box.querySelector('#open-reset-link-btn').onclick = ev => {
              ev.preventDefault();
              applyResetLinkParams(resetEmail, resetToken);
              toast('Update password link applied — enter your new password and confirmation password.');
            };
            box.querySelector('#copy-reset-link-btn').onclick = async () => {
              try {
                await navigator.clipboard.writeText(result.resetUrl);
                toast('Update password link copied');
              } catch {
                toast('Copy failed; click Open Update Password Link instead');
              }
            };
          } else {
            box.innerHTML = `<div class="reset-link-card"><strong>Check Registered Email</strong><p>${esc(result.message)}</p></div>`;
          }
          toast(result.message);
        } else if (form.dataset.auth === 'mfa-start') {
          document.querySelector('#mfa-enrollment').innerHTML = `<p>In your authenticator app, add a time-based account using this setup key:</p><code>${esc(result.secret)}</code><p>Account: AtlasPay · SHA-1 · 6 digits · 30 seconds. Setup expires in 10 minutes.</p>`;
        } else if (result.codes) {
          if (form.dataset.auth === 'mfa-enable') await load();
          const box = document.createElement('div');
          box.className = 'panel';
          box.innerHTML = '<h2>Save your recovery codes now</h2><p>Each code works once with your password. Keep these privately in a password manager. They will not be displayed again.</p><pre>' + result.codes.map(esc).join('\n') + '</pre>';
          document.querySelector('#content').append(box);
          toast(result.message);
        } else if (['mfa-enable', 'mfa-disable', 'reset-complete'].includes(form.dataset.auth)) {
          await load();
          toast(result.message);
        } else {
          document.querySelector('#auth-status').textContent = result.message || 'Action completed.';
          toast(result.message || 'Action completed.');
        }
      } catch (err) {
        toast(err.message);
      } finally {
        if (b) b.disabled = false;
      }
    };
  });

  const login = document.querySelector('#login');
  if (login) {
    const field = document.createElement('label');
    field.innerHTML = 'Authenticator code (if MFA enabled)<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code">';
    login.querySelector('button').before(field);
    const recovery = document.createElement('label');
    recovery.innerHTML = 'Recovery code (instead of authenticator code)<input name="recoveryCode" autocomplete="off" maxlength="24">';
    login.querySelector('button').before(recovery);
  }
}

export function simplifyNavigation() {
  const nav = document.querySelector('nav');
  const groups = [
    ['Start & accounts', ['readiness', 'pricing', 'overview', 'accounts']],
    ['Payments', ['providers', 'payments', 'external', 'operations', 'batches', 'templates', 'team', 'reviews']],
    ['Records & planning', ['intelligence', 'history', 'duplicates', 'forecast', 'accounting', 'wallets', 'ledger', 'reconciliation']],
    ['Security & connections', ['security', 'recovery', 'webhooks', 'integrations', 'beneficiaries']]
  ];
  for (const [name, views] of groups) {
    const group = document.createElement('details');
    group.open = name === 'Start & accounts';
    const title = document.createElement('summary');
    title.textContent = name;
    group.append(title);
    for (const view of views) {
      const b = nav.querySelector(`[data-view="${view}"]`);
      if (b) group.append(b);
    }
    nav.append(group);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    const target = nav.querySelector(`[data-view="${b.dataset.view}"]`);
    if (target?.parentElement.tagName === 'DETAILS') target.parentElement.open = true;
  });
}

function installActivity(post, toast, section) {
  const box = document.createElement('div');
  box.className = 'panel feature-space';
  box.innerHTML = '<h2>Sessions &amp; security alerts</h2><p>Loading account activity…</p>';
  section.after(box);
  async function refresh() {
    try {
      const response = await fetch('/api/accounts/activity');
      if (!box.isConnected) return;
      if (response.status === 401) {
        box.innerHTML = '<h2>Sessions &amp; security alerts</h2><p>Sign in to view active sessions and your security history.</p>';
        return;
      }
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      box.innerHTML = `<h2>Active sessions</h2><p>Browser labels are reported by the browser. Sessions expire after 30 minutes of inactivity or eight hours total.</p>${data.sessions.map(s => `<div class="audit"><b>${s.current ? 'This session' : 'Other session'}</b><p>${esc(s.device)}</p><small>Signed in ${esc(s.createdAt)} · Last active ${esc(s.lastSeenAt)} · Expires ${esc(s.expiresAt)}</small>${s.current ? '' : `<p><button class="link" data-revoke="${esc(s.id)}">Sign out this session</button></p>`}</div>`).join('')}<button class="primary" id="revoke-others">Sign out all other sessions</button><h2>Security alerts</h2><p>${esc(data.delivery)}. Latest 100 events are retained.</p>${data.alerts.map(a => `<div class="audit"><b>${esc(a.type)}</b><small>${esc(a.at)}</small></div>`).join('') || '<p>No security events yet.</p>'}`;
      box.querySelectorAll('[data-revoke],#revoke-others').forEach(b => {
        b.onclick = async () => {
          b.disabled = true;
          try {
            const result = await post('accounts/sessions/revoke', b.id === 'revoke-others' ? { allOthers: true } : { id: b.dataset.revoke });
            toast(result.message);
            await refresh();
          } catch (err) {
            toast(err.message);
            b.disabled = false;
          }
        };
      });
    } catch (err) {
      if (box.isConnected) box.textContent = err.message;
    }
  }
  refresh();
}
