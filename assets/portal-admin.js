/* Chemtec customer portal: the admin page (8 Oct 2026).
   Add customers (Name, Email, Account number = their username) and admins, reset passwords, turn logins off and on,
   delete them, and show the Netlify side: where it lives, the call behind each action, and what is in the store.
   A temporary password is shown once, in this page only. It is never saved in the browser, never logged.
   Branded email (8 Oct 2026): the one time panel gets the Chemtec branded email from the server, in the same answer
   as the password, and offers, in this order: Send branded email (when RESEND_API_KEY is set), Copy branded email
   (HTML and plain text on the clipboard, to paste into Proton Mail), Open in my email app (plain text), Copy message,
   and a Preview (a sandboxed iframe, srcdoc). Closing the panel or leaving the page drops all of it.
   Customer documents (9 Oct 2026): upload an invoice or a report (PDF, up to 4 MB) to one customer login, with
   progress; that customer's documents, newest first, with Open and Delete (asks once); after an upload, Copy notice
   email (the Chemtec branded "new document" email from the server, to paste into Proton Mail: the portal never sends
   email), Open in my email app (plain text) and a Preview. Each customer row in All logins has a Documents button.
   v1.2 (22 Oct 2026): the type reads Invoice or Report (Field Service Report, boiler report, test sheet); the stored
   key of a report is still "test-sheet". Neither is picked ahead, so every upload lands in the column the admin chose.
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
      if (u.role === 'customer' && typeof u.documents === 'number') c1.appendChild(el('span', 'sub', u.documents + (u.documents === 1 ? ' document' : ' documents')));
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
      if (u.role === 'customer') {
        var docsBtn = el('button', null, 'Documents');
        docsBtn.type = 'button';
        docsBtn.setAttribute('data-action', 'documents');
        docsBtn.addEventListener('click', function () { pickCustomer(u.username); });
        acts.appendChild(docsBtn);
      }
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
      var docsToo = u.role === 'customer' && u.documents ? ' Their ' + u.documents + (u.documents === 1 ? ' document goes' : ' documents go') + ' too.' : '';
      confirmInRow(btn, 'Delete ' + u.loginName + ' for good?' + docsToo, 'Yes, delete', function (restore) {
        api('DELETE', path).then(function (res) {
          if (bounce(res)) return;
          restore();
          if (!res.ok) { show(rowMsg, (res.data && res.data.error) || GENERIC, 'bad'); return; }
          var gone = res.data.documentsDeleted ? ' and ' + res.data.documentsDeleted + (res.data.documentsDeleted === 1 ? ' document' : ' documents') : '';
          addLog('Deleted the login ' + label(u) + gone + '.', res.data.call);
          show(rowMsg, 'Deleted ' + u.loginName + gone + '.', 'good');
          if (shownFor === u.username) loadFiles('');
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
      fillCustomerPicker();
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


  // ---------- customer documents (9 Oct 2026) ----------
  var MAX_FILE = 4 * 1024 * 1024; // Netlify buffers 6 MB per request and base64 adds about a third
  var upForm = $('form[data-upload]');
  var upMsg = $('[data-msg]', upForm);
  var upBtn = $('button[type="submit"]', upForm);
  var filesFind = $('[data-files-find]');
  var filesAccount = $('[data-files-account]');
  var filesDate = $('#f-date');
  var filesTitle = $('#f-title');
  var filesFile = $('#f-file');
  var filesList = $('[data-files-list]');
  var filesMsg = $('[data-files-msg]');
  var filesHeading = $('[data-files-heading]');
  var filesSub = $('[data-files-sub]');
  var progress = $('[data-progress]');
  var progressBar = $('[data-progress-bar]');
  var progressText = $('[data-progress-text]');
  var shownFor = null; // the customer whose documents are listed
  var noticeNow = null; // the notice on the panel, dropped when it closes

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  filesDate.value = today();
  filesDate.max = (new Date().getFullYear() + 1) + '-12-31';

  function kb(n) {
    n = Number(n) || 0;
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' KB';
  }
  function squash(s) { return String(s || '').toLowerCase().replace(/[\s.\-_,]+/g, ''); }
  function customers() { return users.filter(function (u) { return u.role === 'customer'; }); }
  function customerBy(username) { return customers().filter(function (u) { return u.username === username; })[0] || null; }

  // the customer list under the search box: every customer, or those whose account number, name or company match
  function fillCustomerPicker() {
    var keep = filesAccount.value || shownFor || '';
    var q = squash(filesFind.value);
    var all = customers();
    var list = all.filter(function (u) { return !q || squash(u.loginName + ' ' + u.displayName + ' ' + (u.company || '')).indexOf(q) > -1; });
    filesAccount.textContent = '';
    var first = el('option', null, !all.length ? 'No customers yet: add one above' : !list.length ? 'No customer matches that' : q ? list.length + (list.length === 1 ? ' match' : ' matches') + ': choose one' : 'Choose a customer');
    first.value = '';
    filesAccount.appendChild(first);
    list.forEach(function (u) {
      var o = el('option', null, u.loginName + ' · ' + u.displayName + (u.company ? ', ' + u.company : '') + (u.active ? '' : ' (login off)'));
      o.value = u.username;
      filesAccount.appendChild(o);
    });
    if (keep && list.some(function (u) { return u.username === keep; })) filesAccount.value = keep;
    else if (q && list.length === 1) filesAccount.value = list[0].username;
    else filesAccount.value = '';
    if ((filesAccount.value || null) !== shownFor) loadFiles(filesAccount.value, true);
  }
  filesFind.addEventListener('input', fillCustomerPicker);
  filesAccount.addEventListener('change', function () { loadFiles(filesAccount.value, true); });

  // the Documents button in All logins
  function pickCustomer(username) {
    filesFind.value = '';
    filesAccount.value = '';
    shownFor = null;
    fillCustomerPicker();
    filesAccount.value = username;
    loadFiles(username, true);
    var sec = $('#customer-documents');
    if (sec) sec.scrollIntoView({ block: 'start' });
  }

  function loadFiles(username, logIt) {
    shownFor = username || null;
    filesList.textContent = '';
    show(filesMsg, '');
    if (!username) {
      filesHeading.textContent = 'Documents';
      filesSub.textContent = 'Pick a customer to see their documents.';
      return Promise.resolve();
    }
    var c = customerBy(username);
    filesHeading.textContent = 'Documents for ' + (c ? c.loginName : username);
    filesSub.textContent = 'Loading...';
    return api('GET', '/api/admin/files?account=' + encodeURIComponent(username)).then(function (res) {
      if (bounce(res)) return;
      if (shownFor !== username) return; // another customer was picked meanwhile
      if (!res.ok) { filesSub.textContent = ''; show(filesMsg, (res.data && res.data.error) || GENERIC, 'bad'); return; }
      renderFiles(res.data.customer, res.data.documents || []);
      if (logIt) addLog('Read the documents of customer ' + res.data.customer.loginName + ' (' + (res.data.documents || []).length + ').', res.data.call);
    });
  }

  function renderFiles(c, docs) {
    filesList.textContent = '';
    filesSub.textContent = c.displayName + (c.company ? ', ' + c.company : '') + '. ' + (docs.length ? docs.length + (docs.length === 1 ? ' document' : ' documents') + ', newest first.' : 'No documents yet.');
    docs.forEach(function (d) {
      var li = el('li');
      li.setAttribute('data-doc', d.id);
      var main = el('div', 'af-main');
      var top = el('div', 'af-top');
      top.appendChild(el('span', 'ftype ' + (d.type === 'invoice' ? 'invoice' : 'test-sheet'), d.typeLabel));
      top.appendChild(el('b', null, d.title || d.dateLabel));
      main.appendChild(top);
      main.appendChild(el('span', 'sub', d.dateLabel + ' · PDF · ' + kb(d.size)));
      main.appendChild(el('span', 'sub', 'Uploaded ' + when(d.uploadedAt) + ' by ' + d.uploadedBy + '. ' + (d.opens ? 'Opened by the customer ' + d.opens + (d.opens === 1 ? ' time' : ' times') + ', last ' + when(d.lastOpenedAt) + '.' : 'Not opened by the customer yet.')));
      li.appendChild(main);
      var acts = el('div', 'acts');
      var open = el('a', null, 'Open');
      open.href = d.href;
      open.target = '_blank';
      open.rel = 'noopener';
      open.setAttribute('aria-label', 'Open ' + d.typeLabel + ', ' + d.dateLabel + ', PDF, in a new tab');
      acts.appendChild(open);
      var del = el('button', 'danger', 'Delete');
      del.type = 'button';
      del.addEventListener('click', function () { deleteFile(del, d); });
      acts.appendChild(del);
      li.appendChild(acts);
      filesList.appendChild(li);
    });
  }

  function deleteFile(btn, d) {
    show(filesMsg, '');
    confirmInRow(btn, 'Delete this ' + d.typeLabel.toLowerCase() + ' for good?', 'Yes, delete', function (restore) {
      api('DELETE', d.href).then(function (res) {
        if (bounce(res)) return;
        restore();
        if (!res.ok) { show(filesMsg, (res.data && res.data.error) || GENERIC, 'bad'); return; }
        addLog('Deleted the ' + d.typeLabel.toLowerCase() + (d.title ? ' "' + d.title + '"' : '') + ' (' + d.dateLabel + ') of customer ' + d.accountNumber + '. The PDF and its record are gone.', res.data.call);
        loadFiles(shownFor).then(function () { show(filesMsg, 'Deleted the ' + d.typeLabel.toLowerCase() + ' of ' + d.dateLabel + '.', 'good'); });
        loadUsers(false);
      });
    });
  }

  // the column of the customer's portal a document shows in
  function whereFor(doc) { return doc.type === 'invoice' ? 'Invoices' : 'Reports'; }

  function markBad(input, text) {
    show(upMsg, text, 'bad');
    if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
  }

  function uploadDone(xhr) {
    var d = {};
    try { d = JSON.parse(xhr.responseText || '{}') || {}; } catch (e) { d = {}; }
    return { ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data: d };
  }

  upForm.addEventListener('submit', function (e) {
    e.preventDefault();
    show(upMsg, '');
    $all('[aria-invalid="true"]', upForm).forEach(function (f) { f.removeAttribute('aria-invalid'); });
    var account = filesAccount.value;
    if (!account) { markBad(filesFind, 'Pick the customer this document is for.'); return; }
    var typeEl = $('input[name="type"]:checked', upForm);
    if (!typeEl) { markBad($('input[name="type"]', upForm), 'Pick Invoice or Report.'); return; }
    if (!filesDate.value) { markBad(filesDate, "Enter the document's date."); return; }
    if (filesDate.validity && (filesDate.validity.rangeOverflow || filesDate.validity.rangeUnderflow || filesDate.validity.badInput)) { markBad(filesDate, 'Check the date. Use the date on the document (1982 to next year).'); return; }
    var file = filesFile.files && filesFile.files[0];
    if (!file) { markBad(filesFile, 'Choose the PDF to upload.'); return; }
    if (file.size > MAX_FILE) { markBad(filesFile, 'That file is ' + kb(file.size) + '. The website takes PDFs up to 4 MB. Scan it again in black and white at 200 dpi, or save it as a smaller PDF, then upload it.'); return; }
    var isPdfName = /\.pdf$/i.test(file.name || '');
    if (file.type !== 'application/pdf' && !(file.type === '' && isPdfName)) { markBad(filesFile, 'Only PDF files can be uploaded.'); return; }
    if (file.type === '') file = new File([file], file.name, { type: 'application/pdf' }); // the server still checks it starts with %PDF-

    var fd = new FormData();
    fd.append('account', account);
    fd.append('type', typeEl.value);
    fd.append('date', filesDate.value);
    fd.append('title', filesTitle.value);
    fd.append('file', file, file.name);

    upBtn.disabled = true;
    upBtn.textContent = 'Uploading...';
    progress.hidden = false;
    progressBar.value = 0;
    progressText.textContent = 'Uploading... 0%';
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/files');
    xhr.setRequestHeader('x-requested-with', 'chemtec-portal');
    xhr.setRequestHeader('accept', 'application/json');
    xhr.upload.addEventListener('progress', function (ev) {
      if (!ev.lengthComputable) return;
      var p = Math.min(100, Math.round((ev.loaded / ev.total) * 100));
      progressBar.value = p;
      progressText.textContent = p < 100 ? 'Uploading... ' + p + '%' : 'Checking the file...';
    });
    function finish() { upBtn.disabled = false; upBtn.textContent = 'Upload'; progress.hidden = true; }
    xhr.addEventListener('error', function () { finish(); show(upMsg, 'We could not reach the portal. Check your connection and try again.', 'bad'); });
    xhr.addEventListener('load', function () {
      finish();
      var res = uploadDone(xhr);
      if (bounce(res)) return;
      if (!res.ok) {
        var field = res.data && res.data.field;
        var input = field === 'account' ? filesFind : field === 'date' ? filesDate : field === 'file' ? filesFile : null;
        markBad(input, (res.data && res.data.error) || (res.status === 413 ? 'That file is over 4 MB, the most the website takes in one upload. Scan it again in black and white at 200 dpi, or save it as a smaller PDF, then upload it.' : GENERIC));
        return;
      }
      var d = res.data;
      var doc = d.document;
      filesFile.value = '';
      filesTitle.value = '';
      show(upMsg, 'Uploaded. ' + d.customer.loginName + ' sees it now under ' + whereFor(doc) + '.', 'good');
      addLog('Uploaded ' + (doc.type === 'invoice' ? 'an invoice' : 'a report') + (doc.title ? ' "' + doc.title + '"' : '') + ' (' + doc.dateLabel + ', ' + kb(doc.size) + ') for customer ' + d.customer.loginName + ' (' + d.customer.displayName + ').', d.call);
      showNotice(d);
      loadFiles(d.customer.username);
      loadUsers(false);
    });
    xhr.send(fd);
  });

  // ---------- the notice panel: Copy notice email ----------
  var noticePanel = $('[data-notice]');
  var noticeStatus = $('[data-notice-status]');
  var noticeMail = $('[data-notice-mail]');
  var noticeCopy = $('[data-notice-copy]');
  var noticePreview = $('[data-notice-preview]');
  var noticePreviewBtn = $('[data-notice-preview-btn]');
  var noticeFrame = $('[data-notice-frame]');

  function showNotice(d) {
    var n = d.notice;
    var c = d.customer;
    var doc = d.document;
    noticeNow = { subject: n.subject, html: n.html, pasteHtml: n.pasteHtml, text: n.text };
    $('[data-notice-title]').textContent = 'Uploaded for ' + c.loginName;
    $('[data-notice-sub]').textContent = doc.typeLabel + ', ' + doc.dateLabel + (doc.title ? ', ' + doc.title : '') + '. ' + c.displayName + (c.company ? ', ' + c.company : '') + ' sees it now under ' + whereFor(doc) + '.';
    $('[data-notice-envelope]').textContent = (c.email ? 'To: ' + c.email + '. ' : 'There is no email on this login. ') + 'Subject: ' + n.subject;
    noticeMail.setAttribute('href', c.email ? mailto(c, n.subject, n.text) : '#');
    noticeMail.hidden = !c.email;
    noticeStatus.textContent = '';
    closeNoticePreview();
    noticePanel.hidden = false;
    noticePanel.focus();
    noticePanel.scrollIntoView({ block: 'start' });
  }

  function hideNotice() {
    noticeNow = null;
    noticeStatus.textContent = '';
    noticeMail.setAttribute('href', '#');
    closeNoticePreview();
    noticePanel.hidden = true;
  }
  $('[data-notice-done]').addEventListener('click', hideNotice);
  noticeMail.addEventListener('click', function () {
    noticeStatus.textContent = 'Your email app should open with the plain message ready. Check it, then send it.';
  });

  // HTML (for an email composer) and plain text (for anything else) together, without touching the login panel
  function copyRich(html, text, done) {
    function legacy() {
      var ok = false;
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      function onCopy(ev) {
        if (!ev.clipboardData) return;
        ev.clipboardData.setData('text/html', html);
        ev.clipboardData.setData('text/plain', text);
        ev.preventDefault();
        ok = true;
      }
      document.addEventListener('copy', onCopy, true);
      try { ta.select(); document.execCommand('copy'); } catch (e) { ok = false; }
      document.removeEventListener('copy', onCopy, true);
      ta.remove();
      try { noticeCopy.focus(); } catch (e) { /* nothing */ }
      return ok;
    }
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write && window.isSecureContext) {
      try {
        var item = new window.ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        });
        navigator.clipboard.write([item]).then(function () { done(true); }, function () { done(legacy()); });
        return;
      } catch (e) { /* fall back below */ }
    }
    done(legacy());
  }

  noticeCopy.addEventListener('click', function () {
    if (!noticeNow) return;
    copyRich(noticeNow.pasteHtml || noticeNow.html, noticeNow.text, function (ok) {
      noticeStatus.textContent = ok ? 'Copied. Paste it into a new email in Proton Mail.' : 'Copy did not work in this browser. Use Open in my email app instead.';
    });
  });

  function setNoticeWidth(w) {
    noticePreview.setAttribute('data-width', w);
    $all('[data-notice-width]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-notice-width') === w)); });
  }
  $all('[data-notice-width]').forEach(function (b) {
    b.addEventListener('click', function () { setNoticeWidth(b.getAttribute('data-notice-width')); });
  });
  function closeNoticePreview() {
    noticePreview.hidden = true;
    noticeFrame.removeAttribute('srcdoc');
    noticePreviewBtn.setAttribute('aria-expanded', 'false');
    noticePreviewBtn.textContent = 'Preview the notice email';
  }
  noticePreviewBtn.addEventListener('click', function () {
    if (!noticeNow) return;
    if (!noticePreview.hidden) { closeNoticePreview(); return; }
    noticeFrame.srcdoc = noticeNow.html.replace(/<head>/i, '<head><base target="_blank">');
    $('[data-notice-subject]').textContent = 'Subject: ' + noticeNow.subject;
    setNoticeWidth('computer');
    noticePreview.hidden = false;
    noticePreviewBtn.setAttribute('aria-expanded', 'true');
    noticePreviewBtn.textContent = 'Hide the preview';
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
