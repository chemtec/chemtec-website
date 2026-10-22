/* Chemtec customer portal: log in, choose a password, the customer page, log out (8 Oct 2026).
   Your documents (9 Oct 2026): the test sheets and invoices Chemtec uploaded for this login, newest first, from
   GET /api/files; each opens as a PDF from /api/files/<id> in a new tab.
   v1.2 (22 Oct 2026, Alex): right below Pay, two columns: Invoices (type "invoice") on the left and Reports (the stored
   type "test-sheet": Field Service Reports, boiler reports, test sheets) on the right, each newest first. The safety
   data sheets, manuals and bulletins sit in a <details> accordion, closed until opened; an address that points into
   it (#documents, #docs-...) opens it.
   Talks only to this site's own /api/ functions. The session is an HttpOnly cookie this script never sees.
   Nothing secret is in this file. */
(function () {
  'use strict';
  var OFFICE = '(215) 721-1636';
  var GENERIC = 'Something went wrong on our side. Please try again, or call the office at ' + OFFICE + '.';

  function api(method, path, body) {
    var headers = { accept: 'application/json' };
    if (method !== 'GET') headers['x-requested-with'] = 'chemtec-portal';
    if (body !== undefined) headers['content-type'] = 'application/json';
    return fetch(path, {
      method: method,
      headers: headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d || {} }; });
      })
      .catch(function () { return { ok: false, status: 0, data: { error: 'We could not reach the portal. Check your connection and try again.' } }; });
  }

  // a "next" address from the query: this site only, a plain path, no tricks
  function safeNext(raw, fallback) {
    var s = String(raw || '');
    if (s.length > 300) return fallback;
    if (!/^\/(?![\/\\])[A-Za-z0-9\-._~\/%]*(\?[A-Za-z0-9\-._~=&%]*)?(#[A-Za-z0-9\-_]*)?$/.test(s)) return fallback;
    if (/(^|\/)\.\.?(\/|$)/.test(s) || /%2e|%2f|%5c/i.test(s)) return fallback;
    return s;
  }

  var params = new URLSearchParams(window.location.search);

  function homeFor(user) { return user && user.role === 'admin' ? '/portal/admin/' : '/portal/'; }

  function show(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
    el.hidden = !msg;
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
    btn.disabled = on;
    btn.textContent = on ? label : btn.getAttribute('data-label');
  }

  function markField(form, field) {
    var bad = form.querySelectorAll('[aria-invalid="true"]');
    for (var i = 0; i < bad.length; i++) bad[i].removeAttribute('aria-invalid');
    if (!field) return;
    var f = form.querySelector('[name="' + field + '"]');
    if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); }
  }

  // "Show password" boxes
  var toggles = document.querySelectorAll('[data-show-pw]');
  for (var t = 0; t < toggles.length; t++) {
    toggles[t].addEventListener('change', function (e) {
      var form = e.target.form || document;
      var pws = form.querySelectorAll('input[data-pw]');
      for (var i = 0; i < pws.length; i++) pws[i].type = e.target.checked ? 'text' : 'password';
    });
  }

  // Log out buttons, on every portal page
  function wireLogout() {
    var outs = document.querySelectorAll('[data-logout]');
    for (var i = 0; i < outs.length; i++) {
      if (outs[i].getAttribute('data-wired')) continue;
      outs[i].setAttribute('data-wired', '1');
      outs[i].addEventListener('click', function (e) {
        e.preventDefault();
        var b = e.currentTarget;
        busy(b, true, 'Logging out...');
        api('POST', '/api/logout', {}).then(function () { window.location.assign('/portal/login/?ended=1'); });
      });
    }
  }
  wireLogout();

  // ---------- the log in form (on /portal/login/ and on /portal/ when logged out) ----------
  var loginForms = document.querySelectorAll('[data-login-form]');
  var next = safeNext(params.get('next'), '');
  for (var lf = 0; lf < loginForms.length; lf++) (function (form) {
    var msg = form.querySelector('[data-msg]');
    var btn = form.querySelector('button[type="submit"]');
    if (params.get('ended') === '1') show(msg, 'You are logged out.', 'good');
    else if (params.get('expired') === '1') show(msg, 'Your session ended. Please log in again.');
    else if (next && /\.pdf/i.test(next)) show(msg, 'Please log in to open that document.');
    else if (next) show(msg, 'Please log in to continue.');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      show(msg, '');
      markField(form, null);
      var u = form.username.value.trim();
      var p = form.password.value;
      if (!u) { show(msg, 'Enter your account number.', 'bad'); markField(form, 'username'); return; }
      if (!p) { show(msg, 'Enter your password.', 'bad'); markField(form, 'password'); return; }
      busy(btn, true, 'Logging in...');
      api('POST', '/api/login', { username: u, password: p }).then(function (res) {
        if (res.ok && res.data && res.data.ok) {
          form.password.value = '';
          var user = res.data.user;
          var dest = next || homeFor(user);
          if (res.data.mustChangePassword) dest = '/portal/change-password/?next=' + encodeURIComponent(dest);
          window.location.assign(dest);
          return;
        }
        busy(btn, false);
        form.password.value = '';
        show(msg, (res.data && res.data.error) || GENERIC, 'bad');
        markField(form, res.data && res.data.locked ? null : 'password');
      });
    });
  })(loginForms[lf]);

  // On the log in page: already logged in? go straight on.
  if (document.querySelector('[data-login-page]') && params.get('ended') !== '1') {
    api('GET', '/api/me').then(function (res) {
      var d = res.data || {};
      if (!d.loggedIn) {
        if (d.setup === false) show(document.querySelector('[data-login-form] [data-msg]'), 'The customer portal is being set up. Please call the office at ' + OFFICE + '.', 'bad');
        return;
      }
      var dest = next || homeFor(d.user);
      if (d.user.mustChangePassword) dest = '/portal/change-password/?next=' + encodeURIComponent(dest);
      window.location.replace(dest);
    });
  }

  // ---------- choose a password ----------
  var changeForm = document.querySelector('[data-change-form]');
  if (changeForm) {
    var cMsg = changeForm.querySelector('[data-msg]');
    var cBtn = changeForm.querySelector('button[type="submit"]');
    var me = null;
    api('GET', '/api/me').then(function (res) {
      var d = res.data || {};
      if (!d.loggedIn) {
        window.location.replace('/portal/login/?next=' + encodeURIComponent('/portal/change-password/' + (next ? '?next=' + encodeURIComponent(next) : '')));
        return;
      }
      me = d.user;
      var forced = me.mustChangePassword;
      var els = document.querySelectorAll('[data-forced]');
      for (var i = 0; i < els.length; i++) els[i].hidden = (els[i].getAttribute('data-forced') === 'yes') !== forced;
      var nameEls = document.querySelectorAll('[data-v="loginName"]');
      for (var j = 0; j < nameEls.length; j++) nameEls[j].textContent = me.loginName;
      var hideLoad = document.querySelectorAll('[data-view="loading"]');
      for (var h = 0; h < hideLoad.length; h++) hideLoad[h].hidden = true;
      var showIn = document.querySelectorAll('[data-view="in"]');
      for (var k = 0; k < showIn.length; k++) showIn[k].hidden = false;
    });
    changeForm.addEventListener('submit', function (e) {
      e.preventDefault();
      show(cMsg, '');
      markField(changeForm, null);
      var cur = changeForm.currentPassword.value;
      var np = changeForm.newPassword.value;
      var np2 = changeForm.confirmPassword.value;
      if (!cur) { show(cMsg, 'Enter your current password. On your first log in, that is the temporary one.', 'bad'); markField(changeForm, 'currentPassword'); return; }
      if (np.length < 10) { show(cMsg, 'Use at least 10 characters for your new password.', 'bad'); markField(changeForm, 'newPassword'); return; }
      if (np !== np2) { show(cMsg, 'The two new passwords do not match.', 'bad'); markField(changeForm, 'confirmPassword'); return; }
      busy(cBtn, true, 'Saving...');
      api('POST', '/api/change-password', { currentPassword: cur, newPassword: np }).then(function (res) {
        if (res.ok && res.data && res.data.ok) {
          changeForm.reset();
          show(cMsg, 'Your password is saved.', 'good');
          window.location.assign(next || homeFor(res.data.user));
          return;
        }
        busy(cBtn, false);
        if (res.status === 401) { window.location.assign('/portal/login/?expired=1'); return; }
        show(cMsg, (res.data && res.data.error) || GENERIC, 'bad');
        markField(changeForm, res.data && res.data.field);
      });
    });
  }

  // ---------- the customer page ----------
  var page = document.querySelector('[data-portal-page]');
  if (page) {
    var views = {
      loading: document.querySelectorAll('[data-view="loading"]'),
      out: document.querySelectorAll('[data-view="out"]'),
      inn: document.querySelectorAll('[data-view="in"]')
    };
    function setView(which) {
      for (var l = 0; l < views.loading.length; l++) views.loading[l].hidden = which !== 'loading';
      for (var i = 0; i < views.out.length; i++) views.out[i].hidden = which !== 'out';
      for (var j = 0; j < views.inn.length; j++) views.inn[j].hidden = which !== 'in';
    }
    function setText(sel, value) {
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].textContent = value;
    }
    api('GET', '/api/me').then(function (res) {
      var d = res.data || {};
      if (!d.loggedIn) {
        setView('out');
        if (d.setup === false) show(document.querySelector('[data-login-form] [data-msg]'), 'The customer portal is being set up. Please call the office at ' + OFFICE + '.', 'bad');
        return;
      }
      var u = d.user;
      if (u.mustChangePassword) {
        window.location.replace('/portal/change-password/?next=' + encodeURIComponent('/portal/' + (window.location.hash || '')));
        return;
      }
      var first = (u.displayName || '').split(' ')[0] || u.displayName;
      setText('[data-v="firstName"]', first);
      setText('[data-v="displayName"]', u.displayName);
      setText('[data-v="company"]', u.company);
      setText('[data-v="loginName"]', u.loginName);
      var co = document.querySelectorAll('[data-if="company"]');
      for (var i = 0; i < co.length; i++) co[i].hidden = !u.company;
      var acct = document.querySelectorAll('[data-if="account"]');
      for (var a = 0; a < acct.length; a++) acct[a].hidden = u.role !== 'customer';
      var adm = document.querySelectorAll('[data-if="admin"]');
      for (var k = 0; k < adm.length; k++) adm[k].hidden = u.role !== 'admin';
      var cus = document.querySelectorAll('[data-if="customer"]');
      for (var c = 0; c < cus.length; c++) cus[c].hidden = u.role !== 'customer';
      if (params.get('notice') === 'staff-only') show(document.querySelector('[data-notice]'), 'The admin page is for Chemtec staff only.', 'bad');
      setView('in');
      wireLogout();
      loadMyFiles(u, scrollToHash);
      loadDocuments(scrollToHash);
      openDocsForHash();
      setTimeout(scrollToHash, 30);
    });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // "B-110", "b110" and "b 110" all find the same sheet
  function squash(s) { return String(s || '').toLowerCase().replace(/[\s.\-_]+/g, ''); }

  // the sections only appear after the log in check, so jump to #documents (or #pay) by hand, once more when
  // the documents list has drawn, unless the visitor has already scrolled
  var userScrolled = false;
  window.addEventListener('wheel', function () { userScrolled = true; }, { passive: true });
  window.addEventListener('touchmove', function () { userScrolled = true; }, { passive: true });
  function scrollToHash() {
    if (userScrolled || !window.location.hash) return;
    var target = document.getElementById(window.location.hash.slice(1));
    if (target && !target.hidden) target.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  if (page && 'scrollRestoration' in history) history.scrollRestoration = 'manual';

  // the safety data sheets accordion: open it when the address (or a link on this page) points into it
  var docsAcc = document.querySelector('[data-docs-acc]');
  function pointsIntoDocs(hash) {
    if (!docsAcc || !hash || hash.length < 2) return false;
    var id = hash.slice(1);
    if (id === 'documents') return true;
    var t = document.getElementById(id);
    return !!(t && docsAcc.contains(t)) || /^docs-[a-z0-9\-]+$/i.test(id);
  }
  function openDocsForHash() {
    if (docsAcc && pointsIntoDocs(window.location.hash)) docsAcc.open = true;
  }
  if (page && docsAcc) {
    window.addEventListener('hashchange', function () {
      if (!pointsIntoDocs(window.location.hash)) return;
      docsAcc.open = true;
      userScrolled = false;
      setTimeout(scrollToHash, 0);
    });
    // a jump link to the address already shown fires no hashchange, so open it on the click as well
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (a && pointsIntoDocs(a.getAttribute('href'))) docsAcc.open = true;
    });
  }

  function kb(n) {
    n = Number(n) || 0;
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  // Your documents: this login's own invoices (left column) and reports (right column), newest first; an admin sees
  // a pointer to the admin page instead. A long column shows the newest few and a Show all button.
  var FIRST_SHOWN = 8;
  var COLS = {
    invoice: { one: 'invoice', many: 'invoices' },
    report: { one: 'report', many: 'reports' }
  };
  function colFor(d) { return d.type === 'invoice' ? 'invoice' : 'report'; } // anything not an invoice is a report

  function fileRow(d) {
    var li = el('li');
    var a = el('a');
    a.href = d.href;
    a.target = '_blank';
    a.rel = 'noopener';
    var main = el('span', 'fmain');
    main.appendChild(el('b', null, d.title || d.dateLabel));
    if (d.title) main.appendChild(el('span', 'fdate', d.dateLabel));
    a.appendChild(main);
    a.appendChild(el('span', 'dl', 'PDF \u00b7 ' + kb(d.size)));
    a.setAttribute('aria-label', d.typeLabel + ', ' + d.dateLabel + (d.title ? ', ' + d.title : '') + ', PDF, ' + kb(d.size) + ', opens in a new tab');
    li.appendChild(a);
    return li;
  }

  function fillColumn(key, docs) {
    var list = document.querySelector('[data-files="' + key + '"]');
    var empty = document.querySelector('[data-files-empty="' + key + '"]');
    var n = document.querySelector('[data-files-n="' + key + '"]');
    var more = document.querySelector('[data-files-more="' + key + '"]');
    if (!list) return;
    list.textContent = '';
    docs.forEach(function (d, i) {
      var li = fileRow(d);
      if (i >= FIRST_SHOWN) li.hidden = true;
      list.appendChild(li);
    });
    list.hidden = docs.length === 0;
    if (empty) empty.hidden = docs.length > 0;
    if (n) n.textContent = docs.length ? docs.length + ' ' + (docs.length === 1 ? COLS[key].one : COLS[key].many) : '';
    if (more) {
      more.hidden = docs.length <= FIRST_SHOWN;
      more.textContent = 'Show all ' + docs.length + ' ' + COLS[key].many;
      more.onclick = function () {
        var rows = list.children;
        for (var i = 0; i < rows.length; i++) rows[i].hidden = false;
        more.hidden = true;
        if (rows[FIRST_SHOWN]) { var link = rows[FIRST_SHOWN].querySelector('a'); if (link) link.focus(); }
      };
    }
  }

  function loadMyFiles(user, done) {
    var cols = document.querySelector('[data-files-cols]');
    if (!cols) return;
    var status = document.querySelector('[data-files-status]');
    var help = document.querySelector('[data-files-help]');
    var adminNote = document.querySelector('[data-files-admin]');
    if (user && user.role === 'admin') {
      if (status) status.hidden = true;
      if (adminNote) adminNote.hidden = false;
      return;
    }
    api('GET', '/api/files').then(function (res) {
      if (!res.ok || !res.data || !res.data.documents) {
        if (res.status === 401) { window.location.assign('/portal/login/?next=' + encodeURIComponent('/portal/#your-documents') + '&expired=1'); return; }
        if (status) { status.textContent = 'Your invoices and reports did not load. Refresh the page, or call ' + OFFICE + ' and we will send what you need.'; status.hidden = false; }
        return;
      }
      if (status) status.hidden = true;
      var split = { invoice: [], report: [] };
      res.data.documents.forEach(function (d) { split[colFor(d)].push(d); }); // the server already sends newest first
      fillColumn('invoice', split.invoice);
      fillColumn('report', split.report);
      cols.hidden = false;
      if (help) help.hidden = false;
      if (done) setTimeout(done, 30);
    });
  }

  function loadDocuments(done) {
    var box = document.querySelector('[data-docs]');
    if (!box) return;
    var status = document.querySelector('[data-docs-status]');
    api('GET', '/api/documents').then(function (res) {
      if (!res.ok || !res.data || !res.data.groups) {
        if (status) { status.textContent = 'The documents list did not load. Refresh the page, or call ' + OFFICE + ' and we will send what you need.'; status.hidden = false; }
        var t = document.querySelector('[data-docs-total]');
        if (t) t.textContent = 'The list did not load. Open for details.';
        return;
      }
      if (status) status.hidden = true;
      box.textContent = '';
      var all = [];
      res.data.groups.forEach(function (g) {
        var wrap = el('div', 'doc-group');
        wrap.id = 'docs-' + g.id;
        wrap.appendChild(el('h3', null, g.title));
        if (g.note) wrap.appendChild(el('p', null, g.note));
        var ul = el('ul', 'sds-grid two-col');
        g.items.forEach(function (it) {
          var li = el('li');
          var a = el('a');
          a.href = it.href;
          a.appendChild(el('span', 'code', it.code));
          a.appendChild(el('span', 'use', it.use || ''));
          a.appendChild(el('span', 'dl', it.request ? 'Request' : 'PDF · ' + it.size));
          if (!it.request) a.setAttribute('aria-label', 'Safety data sheet ' + it.code + ', PDF, ' + it.size);
          li.appendChild(a);
          li.setAttribute('data-find', squash(it.code + ' ' + (it.use || '') + ' ' + g.title));
          ul.appendChild(li);
          all.push(li);
        });
        wrap.appendChild(ul);
        box.appendChild(wrap);
      });
      var groups = box.querySelectorAll('.doc-group');
      var find = document.querySelector('[data-docs-find]');
      var none = document.querySelector('[data-docs-none]');
      var count = document.querySelector('[data-docs-count]');
      var total = document.querySelector('[data-docs-total]');
      if (total) total.textContent = all.length + (all.length === 1 ? ' document' : ' documents');
      function filter() {
        var v = find ? squash(find.value) : '';
        var shown = 0;
        all.forEach(function (li) { var ok = !v || li.getAttribute('data-find').indexOf(v) > -1; li.hidden = !ok; if (ok) shown++; });
        for (var i = 0; i < groups.length; i++) groups[i].hidden = !groups[i].querySelector('li:not([hidden])');
        if (none) none.hidden = shown > 0;
        if (count) count.textContent = v ? shown + ' of ' + all.length + ' shown' : all.length + ' documents';
      }
      if (find) find.addEventListener('input', filter);
      filter();
      if (done) setTimeout(done, 30);
    });
  }
})();
