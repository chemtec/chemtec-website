/* Chemtec customer portal: the admin page (8 Oct 2026).
   Add customers (Name, Email, Account number = their username) and admins, reset passwords, turn logins off and on,
   delete them, and show the Netlify side: where it lives, the call behind each action, and what is in the store.
   A temporary password is shown once, in this page only. It is never saved in the browser, never logged.
   Branded email (8 Oct 2026): the one time panel gets the Chemtec branded email from the server, in the same answer
   as the password, and offers, in this order: Send branded email (when RESEND_API_KEY is set), Copy branded email
   (HTML and plain text on the clipboard, to paste into Proton Mail), Open in my email app (plain text), Copy message,
   and a Preview (a sandboxed iframe, srcdoc). Closing the panel or leaving the page drops all of it.
   Nothing secret is in this file. */
(function () {
  'use strict';
  var PORTAL_URL = 'https://chemtecpro.com/portal/';
  var ADMIN_URL = 'https://chemtecpro.com/portal/admin/';
  var OFFICE = '(215) 721-1636';
  var SERVICE = 'service@chemtecproductscompany.com';
  var LOG_KEY = 'chemtec-portal-admin-log';
  var GENERIC = 'That did not work. Refresh the page and try again.';

  var root = document.querySelector('[data-admin-page]');
  if (!root) return;

  var me = null;
  var users = [];
  var MAIL = { configured: false, known: false }; // is automatic email set up (RESEND_API_KEY)? from the server
  var SUBJECTS = {
    'customer-welcome': 'Your Chemtec customer portal login',
    'admin-welcome': 'Your Chemtec portal admin login',
    'password-reset': 'Your Chemtec portal password was reset'
  };

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return [].slice.call((ctx || document).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function api(method, path, body) {
    var headers = { accept: 'application/json' };
    if (method !== 'GET') headers['x-requested-with'] = 'chemtec-portal';
    if (body !== undefined) headers['content-type'] = 'application/json';
    return fetch(path, { method: method, headers: headers, credentials: 'same-origin', cache: 'no-store', body: body !== undefined ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d || {} }; }); })
      .catch(function () { return { ok: false, status: 0, data: { error: 'We could not reach the portal. Check your connection and try again.' } }; });
  }

  // a 401 or 403 means the session ended or this is not an admin: go to the right page
  function bounce(res) {
    if (res.status === 401) { window.location.assign('/portal/login/?next=' + encodeURIComponent('/portal/admin/') + '&expired=1'); return true; }
    if (res.status === 403 && res.data && res.data.mustChangePassword) { window.location.assign('/portal/change-password/?next=' + encodeURIComponent('/portal/admin/')); return true; }
    if (res.status === 403 && /staff/i.test((res.data && res.data.error) || '')) { window.location.assign('/portal/?notice=staff-only'); return true; }
    return false;
  }

  function show(box, msg, kind) {
    if (!box) return;
    box.textContent = msg || '';
    box.className = 'msg' + (kind ? ' ' + kind : '');
    box.hidden = !msg;
  }

  function when(iso) {
    if (!iso) return 'Never';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // ---------- the session log (this tab only; never a password) ----------
  var log = [];
  try { log = JSON.parse(sessionStorage.getItem(LOG_KEY) || '[]') || []; } catch (e) { log = []; }

  function addLog(what, call) {
    log.unshift({ at: new Date().toISOString(), what: what, sdk: (call && call.sdk) || '', rest: (call && call.rest) || '' });
    log = log.slice(0, 60);
    try { sessionStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (e) { /* private window: keep it in memory */ }
    renderLog();
  }

  function renderLog() {
    var ul = $('[data-log]');
    if (!ul) return;
    ul.textContent = '';
    log.forEach(function (x) {
      var li = el('li');
      li.appendChild(el('span', 'when', when(x.at)));
      li.appendChild(el('span', 'what', x.what));
      if (x.sdk) { var s = el('code', 'mono'); s.appendChild(el('i', null, 'Netlify Blobs SDK')); s.appendChild(document.createTextNode(x.sdk)); li.appendChild(s); }
      if (x.rest) { var r = el('code', 'mono'); r.appendChild(el('i', null, 'The same call on the Netlify API')); r.appendChild(document.createTextNode(x.rest)); li.appendChild(r); }
      ul.appendChild(li);
    });
    var empty = $('[data-log-empty]');
    if (empty) empty.hidden = log.length > 0;
  }

  // ---------- the one time password panel ----------
  var once = $('[data-once]');
  var onceMail = $('[data-once-mail]');
  var onceMsg = $('[data-once-msg]');
  var oncePw = $('[data-once-pw]');
  var onceStatus = $('[data-once-status]');
  var onceSend = $('[data-once-send]');
  var onceSendBtn = $('[data-once-send-btn]');
  var onceCopyHtml = $('[data-once-copy-html]');
  var onceEnvelope = $('[data-once-envelope]');
  var oncePreview = $('[data-once-preview]');
  var oncePreviewBtn = $('[data-once-preview-btn]');
  var onceFrame = $('[data-once-frame]');
  var onceSubject = $('[data-once-subject]');
  var current = null; // { user, pw, kind, subject, text, email, sent } while the panel is open, dropped when it closes

  function kindOf(u, reset) { return reset ? 'password-reset' : u.role === 'admin' ? 'admin-welcome' : 'customer-welcome'; }

  function introLine(kind, u) {
    var admin = u.role === 'admin';
    if (kind === 'password-reset') return 'Your password was reset. Here is your new ' + (admin ? 'admin login' : 'login') + ' for the Chemtec customer portal.';
    return admin ? 'Here is your admin login for the Chemtec customer portal.' : 'Here is your login for the Chemtec customer portal.';
  }

  // the plain message, word for word the server's plain text (netlify/lib/email-templates.mjs, loginText); used only
  // if an answer ever comes without the rendered email
  function loginMessage(u, pw, kind) {
    var first = (u.displayName || '').split(' ')[0] || 'there';
    var lines = ['Hello ' + first + ',', '', introLine(kind, u), '', 'Portal: ' + PORTAL_URL];
    if (u.role === 'admin') lines.push('Admin page: ' + ADMIN_URL);
    lines.push('Username: ' + u.loginName, 'Temporary password: ' + pw, '');
    lines.push(kind === 'password-reset' ? "You'll choose your own password the next time you sign in." : "You'll choose your own password the first time you sign in.", '');
    lines.push('Questions? Call us at ' + OFFICE + ' or email ' + SERVICE + '.', '');
    lines.push('Chemtec Products Company');
    return lines.join('\n');
  }

  function mailto(u, subject, body) {
    var to = encodeURIComponent(u.email || '').replace(/%40/g, '@');
    return 'mailto:' + to + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body.replace(/\n/g, '\r\n'));
  }

  // is automatic email set up? updates the "Email the login now" boxes (only when the answer changes, so a box the
  // admin just unticked stays unticked)
  function setMail(m) {
    var configured = Boolean(m && m.configured);
    var changed = !MAIL.known || MAIL.configured !== configured;
    MAIL.configured = configured;
    MAIL.known = true;
    if (!changed) return;
    $all('[data-mail-opt]').forEach(function (box) {
      var cb = $('input[name="sendEmail"]', box);
      var hint = $('[data-mail-hint]', box);
      cb.disabled = !configured;
      cb.defaultChecked = configured;
      cb.checked = configured;
      box.classList.toggle('off', !configured);
      hint.textContent = configured ? 'The site emails them the Chemtec branded login as soon as you add them.' : 'Automatic email is not set up yet. After you add them, use Copy branded email.';
    });
  }

  function renderSend(r) {
    var c = current;
    if (!c) return;
    if (r && r.sent) c.sent = true;
    var canSend = MAIL.configured && Boolean(c.user.email) && Boolean(c.email);
    onceSendBtn.hidden = !canSend;
    onceSendBtn.disabled = false;
    onceSendBtn.textContent = c.sent ? 'Send again' : 'Send branded email';
    // the first button is the main one: Send when the site can send, otherwise Copy branded email
    onceSendBtn.className = 'btn btn-primary';
    onceCopyHtml.className = 'btn ' + (canSend ? 'btn-outline' : 'btn-primary');
    var msg = '';
    var kind = '';
    if (!MAIL.configured) msg = 'Automatic email is not set up yet. Use Copy branded email, then paste it into a new email in Proton Mail.';
    else if (r && r.sent) { msg = r.message || 'Sent.'; kind = 'good'; }
    else if (r && r.status === 'not-requested') msg = 'Not emailed yet. Press Send branded email, or use one of the other ways.';
    else if (r && r.message) { msg = r.message; kind = 'bad'; }
    show(onceSend, msg, kind);
  }

  function showOnce(d, title, reset) {
    var u = d.user;
    var pw = d.temporaryPassword;
    var email = d.email && d.email.html ? d.email : null;
    var kind = (email && email.kind) || kindOf(u, reset);
    var subject = (email && email.subject) || SUBJECTS[kind];
    var text = (email && email.text) || loginMessage(u, pw, kind);
    if (d.mail) setMail(d.mail);
    current = { user: u, pw: pw, kind: kind, subject: subject, text: text, email: email, sent: false };
    $('[data-once-title]').textContent = title;
    $('[data-once-sub]').textContent = (u.role === 'admin' ? 'Admin ' : 'Customer ') + u.displayName + (u.company && u.role !== 'admin' ? ', ' + u.company : '') + '. Username: ' + u.loginName + (u.email ? '. Email: ' + u.email : '') + '.';
    oncePw.textContent = pw;
    onceMsg.value = text;
    onceMail.setAttribute('href', mailto(u, subject, text));
    onceMail.hidden = !u.email;
    onceEnvelope.textContent = (u.email ? 'To: ' + u.email + '. ' : '') + 'Subject: ' + subject;
    onceCopyHtml.hidden = !email;
    oncePreviewBtn.parentNode.hidden = !email;
    closePreview();
    onceStatus.textContent = '';
    renderSend(d.emailSend);
    once.hidden = false;
    once.focus();
    once.scrollIntoView({ block: 'start' });
  }

  function closePreview() {
    oncePreview.hidden = true;
    onceFrame.removeAttribute('srcdoc');
    oncePreviewBtn.setAttribute('aria-expanded', 'false');
    oncePreviewBtn.textContent = 'Preview the branded email';
  }

  function hideOnce() {
    current = null;
    oncePw.textContent = '';
    onceMsg.value = '';
    onceEnvelope.textContent = '';
    onceMail.setAttribute('href', '#');
    show(onceSend, '');
    closePreview();
    once.hidden = true;
  }

  $('[data-once-done]').addEventListener('click', hideOnce);
  onceMail.addEventListener('click', function () {
    onceStatus.textContent = 'Your email app should open with the plain message ready. Check it, then send it.';
  });

  function selectAndCopy(text) {
    try { onceMsg.focus(); onceMsg.select(); return document.execCommand('copy'); } catch (e) { return false; }
  }

  $('[data-once-copy]').addEventListener('click', function () {
    var text = onceMsg.value;
    function done(ok) { onceStatus.textContent = ok ? 'Copied. Paste it into an email or a text.' : 'Copy did not work here. Select the message and copy it by hand.'; }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(selectAndCopy(text)); });
    } else done(selectAndCopy(text));
  });

  // Copy branded email: the HTML (for an email composer) and the plain text (for anything else), together
  function legacyCopyHtml(html, text) {
    var ok = false;
    function onCopy(e) {
      if (!e.clipboardData) return;
      e.clipboardData.setData('text/html', html);
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
      ok = true;
    }
    document.addEventListener('copy', onCopy, true);
    selectAndCopy(text);
    document.removeEventListener('copy', onCopy, true);
    try { onceMsg.setSelectionRange(0, 0); onceCopyHtml.focus(); } catch (e) { /* nothing to undo */ }
    return ok;
  }

  onceCopyHtml.addEventListener('click', function () {
    var c = current;
    if (!c || !c.email) return;
    var html = c.email.pasteHtml || c.email.html;
    var text = c.email.text;
    function done(ok) {
      onceStatus.textContent = ok ? 'Copied. Paste it into a new email in Proton Mail.' : 'Copy did not work in this browser. Use Copy message, or Open in my email app.';
    }
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write && window.isSecureContext) {
      try {
        var item = new window.ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        });
        navigator.clipboard.write([item]).then(function () { done(true); }, function () { done(legacyCopyHtml(html, text)); });
        return;
      } catch (e) { /* fall back below */ }
    }
    done(legacyCopyHtml(html, text));
  });

  // Send branded email: the browser still holds the temporary password it was shown; the server checks it against
  // the stored hash before it sends, so only this login's current temporary password can go out
  onceSendBtn.addEventListener('click', function () {
    var c = current;
    if (!c) return;
    onceSendBtn.disabled = true;
    onceSendBtn.textContent = 'Sending...';
    show(onceSend, '');
    api('POST', '/api/admin/users/' + encodeURIComponent(c.user.username) + '/email', { password: c.pw, kind: c.kind === 'password-reset' ? 'reset' : 'welcome' }).then(function (res) {
      if (bounce(res)) return;
      if (current !== c) return; // the panel was closed meanwhile
      var d = res.data || {};
      var r = d.emailSend || { status: 'failed', sent: false, message: d.error || GENERIC };
      if (!r.sent && !r.message) r.message = d.error || GENERIC;
      if (r.status === 'not-configured') setMail({ configured: false });
      renderSend(r);
      if (r.sent) addLog('Emailed the branded login to ' + label(c.user) + ' through Resend.', r.call);
    });
  });

  // the preview: the real email in a sandboxed frame (no scripts, no access to this page); its links open a new tab
  function setPreviewWidth(w) {
    oncePreview.setAttribute('data-width', w);
    $all('[data-preview-width]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-preview-width') === w)); });
  }
  $all('[data-preview-width]').forEach(function (b) {
    b.addEventListener('click', function () { setPreviewWidth(b.getAttribute('data-preview-width')); });
  });
  oncePreviewBtn.addEventListener('click', function () {
    if (!current || !current.email) return;
    if (!oncePreview.hidden) { closePreview(); return; }
    onceFrame.srcdoc = current.email.html.replace(/<head>/i, '<head><base target="_blank">');
    onceSubject.textContent = 'Subject: ' + current.subject;
    setPreviewWidth('computer');
    oncePreview.hidden = false;
    oncePreviewBtn.setAttribute('aria-expanded', 'true');
    oncePreviewBtn.textContent = 'Hide the preview';
  });

  // ---------- the users table ----------
  function activeAdmins() { return users.filter(function (u) { return u.role === 'admin' && u.active; }).length; }

  function pill(text, cls) { return el('span', 'pill ' + (cls || ''), text); }

  function renderUsers() {
    var tb = $('[data-users]');
    tb.textContent = '';
    var cust = users.filter(function (u) { return u.role === 'customer'; }).length;
    $('[data-count]').textContent = users.length + (users.length === 1 ? ' login' : ' logins') + ': ' + cust + ' customer' + (cust === 1 ? '' : 's') + ', ' + (users.length - cust) + ' admin' + (users.length - cust === 1 ? '' : 's');
    if (!users.length) {
      var tr0 = el('tr'); var td0 = el('td', 'muted', 'No logins yet.'); td0.colSpan = 6; tr0.appendChild(td0); tb.appendChild(tr0); return;
    }
    users.forEach(function (u) {
      var tr = el('tr');
      tr.setAttribute('data-user', u.username);
      var self = me && u.username === me.username;

      var c1 = el('td');
      c1.appendChild(el('span', 'login', u.loginName));
      c1.appendChild(el('span', 'sub', u.role === 'admin' ? 'Admin username' : 'Account number'));
      tr.appendChild(c1);

      var c2 = el('td');
      c2.appendChild(el('span', null, u.displayName + (self ? ' (you)' : '')));
      if (u.company) c2.appendChild(el('span', 'sub', u.company));
      tr.appendChild(c2);

      tr.appendChild(el('td', null, u.email || ''));

      var c4 = el('td');
      if (u.role === 'admin') c4.appendChild(pill('Admin', 'admin'));
      c4.appendChild(u.active ? pill('On', 'on') : pill('Off', 'off'));
      if (u.locked) c4.appendChild(pill('Locked 15 min', 'off'));
      if (u.mustChangePassword) c4.appendChild(pill('Temporary password', 'warn'));
      tr.appendChild(c4);

      var c5 = el('td', null, when(u.lastLoginAt));
      if (u.failedLogins) c5.appendChild(el('span', 'sub', u.failedLogins + ' wrong password' + (u.failedLogins === 1 ? '' : 's')));
      tr.appendChild(c5);

      var c6 = el('td');
      var acts = el('div', 'acts');
      var lastAdmin = u.role === 'admin' && u.active && activeAdmins() <= 1;
      acts.appendChild(button('Reset password', 'reset', u, self, self ? 'To change your own password, use Change my password.' : ''));
      if (u.active) acts.appendChild(button('Turn off', 'disable', u, self || lastAdmin, self ? 'You cannot turn off your own login.' : lastAdmin ? 'This is the last active admin.' : ''));
      else acts.appendChild(button('Turn on', 'enable', u, false, ''));
      if (u.locked && u.active) acts.appendChild(button('Unlock', 'enable', u, false, ''));
      acts.appendChild(button('Delete', 'delete', u, self || lastAdmin, self ? 'You cannot delete your own login.' : lastAdmin ? 'This is the last active admin.' : '', 'danger'));
      c6.appendChild(acts);
      tr.appendChild(c6);
      tb.appendChild(tr);
    });
  }

  function button(label, action, u, disabled, why, cls) {
    var b = el('button', cls || null, label);
    b.type = 'button';
    b.setAttribute('data-action', action);
    b.disabled = Boolean(disabled);
    if (why) b.title = why;
    b.addEventListener('click', function () { onAction(action, u, b); });
    return b;
  }

  var rowMsg = $('[data-row-msg]');

  // reset and delete ask once more, in the row itself
  function confirmInRow(btn, question, yesLabel, go, extra) {
    var acts = btn.parentNode;
    var keep = [].slice.call(acts.childNodes);
    keep.forEach(function (n) { n.hidden = true; });
    var q = el('span', 'confirm-q', question);
    var yes = el('button', 'danger', yesLabel); yes.type = 'button';
    var no = el('button', null, 'Cancel'); no.type = 'button';
    var added = extra ? [q, extra, yes, no] : [q, yes, no];
    function restore() { added.forEach(function (n) { n.remove(); }); keep.forEach(function (n) { n.hidden = false; }); }
    yes.addEventListener('click', function () { yes.disabled = true; no.disabled = true; go(restore); });
    no.addEventListener('click', restore);
    added.forEach(function (n) { acts.appendChild(n); });
    yes.focus();
  }

  function mailBox() {
    var lab = el('label', 'confirm-mail');
    var cb = el('input');
    cb.type = 'checkbox';
    cb.checked = true;
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(' Email the login now'));
    return { label: lab, box: cb };
  }

  function onAction(action, u, btn) {
    show(rowMsg, '');
    var path = '/api/admin/users/' + encodeURIComponent(u.username);
    if (action === 'reset') {
      var mb = MAIL.configured && u.email ? mailBox() : null;
      confirmInRow(btn, 'New password for ' + u.loginName + '?', 'Yes, reset', function (restore) {
        api('POST', path + '/reset', { sendEmail: Boolean(mb && mb.box.checked) }).then(function (res) {
          if (bounce(res)) return;
          restore();
          if (!res.ok) { show(rowMsg, (res.data && res.data.error) || GENERIC, 'bad'); return; }
          addLog('Reset the password for ' + label(res.data.user) + '. Their old password and sessions stopped working.', res.data.call);
          if (res.data.emailSend && res.data.emailSend.sent) addLog('Emailed the branded login to ' + label(res.data.user) + ' through Resend.', res.data.emailSend.call);
          showOnce(res.data, 'New password ready for ' + res.data.user.displayName, true);
          refresh();
        });
      }, mb && mb.label);
      return;
    }
    if (action === 'delete') {
      confirmInRow(btn, 'Delete ' + u.loginName + ' for good?', 'Yes, delete', function (restore) {
        api('DELETE', path).then(function (res) {
          if (bounce(res)) return;
          restore();
          if (!res.ok) { show(rowMsg, (res.data && res.data.error) || GENERIC, 'bad'); return; }
          addLog('Deleted the login ' + label(u) + '.', res.data.call);
          show(rowMsg, 'Deleted ' + u.loginName + '.', 'good');
          refresh();
        });
      });
      return;
    }
    btn.disabled = true;
    api('POST', path + '/' + action, {}).then(function (res) {
      if (bounce(res)) return;
      if (!res.ok) { btn.disabled = false; show(rowMsg, (res.data && res.data.error) || GENERIC, 'bad'); return; }
      var on = action === 'enable';
      addLog((on ? 'Turned on ' : 'Turned off ') + label(res.data.user) + (on ? ' (and cleared any lock).' : '. Their open sessions ended.'), res.data.call);
      show(rowMsg, (on ? 'Turned on ' : 'Turned off ') + res.data.user.loginName + '.', 'good');
      refresh();
    });
  }

  function label(u) {
    return (u.role === 'admin' ? 'admin ' : 'customer ') + u.loginName + (u.displayName ? ' (' + u.displayName + ')' : '');
  }

  function loadUsers(logIt) {
    return api('GET', '/api/admin/users').then(function (res) {
      if (bounce(res)) return;
      if (!res.ok) { show($('[data-admin-error]'), (res.data && res.data.error) || GENERIC, 'bad'); return; }
      users = res.data.users || [];
      if (res.data.mail) setMail(res.data.mail);
      renderUsers();
      if (logIt) addLog('Read every login to fill the table (' + users.length + ').', res.data.call);
    });
  }

  // ---------- the Netlify side ----------
  var ENV_WHAT = {
    SESSION_SECRET: 'signs the log in cookie',
    ADMIN_USERNAME: 'the first admin only',
    ADMIN_PASSWORD: 'the first admin only; remove after their first log in',
    RESEND_API_KEY: 'turns on automatic login emails (a Resend key that can only send)',
    PORTAL_FROM: 'optional, who login emails come from; default Chemtec Products Company <portal@chemtecpro.com>',
    PORTAL_REPLY_TO: 'optional, where replies to login emails go; default service@chemtecproductscompany.com',
    STRIPE_SECRET_KEY: 'opens online payment',
    PAY_MIN_USD: 'optional, smallest payment',
    PAY_MAX_USD: 'optional, largest payment',
    PAY_METHODS: 'optional, bank only by default'
  };

  function loadStore(logIt) {
    return api('GET', '/api/admin/store').then(function (res) {
      if (bounce(res)) return;
      if (!res.ok) return;
      var d = res.data;
      var site = $('[data-site]');
      if (site) {
        var running = d.site && (d.site.name || d.site.id);
        site.textContent = 'Netlify project: chemtecpro' + (running && d.site.name !== 'chemtecpro' ? '\nThis copy is running on: ' + (d.site.name || '') + (d.site.id ? ' (site id ' + d.site.id + ')' : '') : '');
        site.style.whiteSpace = 'pre-line';
      }
      var envs = $('[data-envs]');
      envs.textContent = '';
      Object.keys(d.env || {}).forEach(function (name) {
        var li = el('li');
        li.appendChild(el('span', null, name));
        li.appendChild(el('span', null, (d.env[name] ? 'set' : 'not set') + ', ' + (ENV_WHAT[name] || '')));
        envs.appendChild(li);
      });
      $('[data-store-sum]').textContent = 'Store ' + d.store + ': ' + d.count + (d.count === 1 ? ' record, ' : ' records, ') + d.totalBytes + ' bytes in all. Password hashes are left out of this view.';
      $('[data-store-call]').textContent = d.call ? d.call.sdk : '';
      var tb = $('[data-store]');
      tb.textContent = '';
      (d.keys || []).forEach(function (k) {
        var tr = el('tr');
        var c1 = el('td'); c1.appendChild(el('span', 'login mono', k.key)); if (k.login && k.login !== k.key) c1.appendChild(el('span', 'sub', 'typed as ' + k.login)); tr.appendChild(c1);
        tr.appendChild(el('td', null, k.role));
        var c3 = el('td');
        c3.appendChild(k.active ? pill('On', 'on') : pill('Off', 'off'));
        if (k.locked) c3.appendChild(pill('Locked', 'off'));
        if (k.mustChangePassword) c3.appendChild(pill('Temporary password', 'warn'));
        tr.appendChild(c3);
        tr.appendChild(el('td', null, k.size + ' bytes'));
        tr.appendChild(el('td', null, when(k.updatedAt)));
        tr.appendChild(el('td', 'mono', k.fields.join(', ') + (k.hasPasswordHash ? ', passwordHash (hidden)' : '')));
        tb.appendChild(tr);
      });
      if (logIt) addLog('Opened the store inspector: ' + d.count + ' record' + (d.count === 1 ? '' : 's') + ' in portal-users.', d.call);
    });
  }

  function refresh() { loadUsers(false); loadStore(false); }

  // ---------- the add forms ----------
  $all('form[data-add]').forEach(function (form) {
    var role = form.getAttribute('data-add');
    var msg = $('[data-msg]', form);
    var btn = $('button[type="submit"]', form);
    var btnLabel = btn.textContent;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      show(msg, '');
      $all('[aria-invalid="true"]', form).forEach(function (f) { f.removeAttribute('aria-invalid'); });
      var send = form.sendEmail;
      var body = { role: role, displayName: form.displayName.value, email: form.email.value, password: form.password.value, sendEmail: Boolean(send && !send.disabled && send.checked) };
      if (role === 'customer') { body.accountNumber = form.accountNumber.value; body.company = form.company.value; }
      else body.username = form.username.value;
      var need = role === 'customer' ? [['displayName', 'Enter their name.'], ['email', 'Enter their email.'], ['accountNumber', 'Enter their account number.']] : [['username', 'Enter a username for the admin.'], ['displayName', 'Enter their name.'], ['email', 'Enter their email.']];
      for (var i = 0; i < need.length; i++) {
        if (!String(body[need[i][0]] || '').trim()) { show(msg, need[i][1], 'bad'); form[need[i][0]].setAttribute('aria-invalid', 'true'); form[need[i][0]].focus(); return; }
      }
      btn.disabled = true; btn.textContent = 'Adding...';
      api('POST', '/api/admin/users', body).then(function (res) {
        btn.disabled = false; btn.textContent = btnLabel;
        if (bounce(res)) return;
        if (!res.ok) {
          show(msg, (res.data && res.data.error) || GENERIC, 'bad');
          var f = res.data && res.data.field && form[res.data.field];
          if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); }
          return;
        }
        var u = res.data.user;
        form.reset();
        var es = res.data.emailSend;
        show(msg, 'Added ' + u.loginName + '. ' + (es && es.sent ? 'Their login was emailed to ' + u.email + '.' : 'Their login email is below.'), 'good');
        addLog('Added the ' + (u.role === 'admin' ? 'admin ' : 'customer ') + u.loginName + ' (' + u.displayName + '), with a temporary password they must change.', res.data.call);
        if (res.data.emailSend && res.data.emailSend.sent) addLog('Emailed the branded login to ' + label(u) + ' through Resend.', res.data.emailSend.call);
        showOnce(res.data, 'Login ready for ' + u.displayName, false);
        refresh();
      });
    });
  });

  $('[data-refresh]').addEventListener('click', function () { loadUsers(true); });
  $('[data-store-refresh]').addEventListener('click', function () { loadStore(true); });

  // ---------- start ----------
  api('GET', '/api/me').then(function (res) {
    var d = res.data || {};
    if (!d.loggedIn) { window.location.replace('/portal/login/?next=' + encodeURIComponent('/portal/admin/')); return; }
    if (d.user.mustChangePassword) { window.location.replace('/portal/change-password/?next=' + encodeURIComponent('/portal/admin/')); return; }
    if (d.user.role !== 'admin') { window.location.replace('/portal/?notice=staff-only'); return; }
    me = d.user;
    $all('[data-v="loginName"]').forEach(function (n) { n.textContent = me.loginName; });
    $all('[data-view="loading"]').forEach(function (n) { n.hidden = true; });
    $all('[data-view="in"]').forEach(function (n) { n.hidden = false; });
    var first = log.length === 0; // log the reads once per tab, not on every visit
    renderLog();
    loadUsers(first);
    loadStore(first);
  });

  // leaving the page clears the one time password from the page
  window.addEventListener('pagehide', hideOnce);
})();
