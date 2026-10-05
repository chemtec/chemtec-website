/* Chemtec customer portal: pay by bank (Stripe Checkout).
   The pages ask /.netlify/functions/pay whether online payment is open. No key in Netlify, an error,
   a slow answer or a plain static preview all land on the same calm "opens soon" state.
   Test keys keep the form hidden unless the address ends in ?test=1, so customers never meet a test checkout.
   Nothing secret is in this file. */
(function () {
  'use strict';
  var API = '/.netlify/functions/pay';
  var params = new URLSearchParams(window.location.search);
  var wantsTest = params.get('test') === '1';

  function getJSON(url, ms) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 8000);
    return fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        clearTimeout(timer);
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('application/json') === -1) return { ok: false, status: r.status, data: null };
        return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
      })
      .catch(function () { clearTimeout(timer); return { ok: false, status: 0, data: null }; });
  }

  // show the children whose data-show lists this state, hide the rest
  function setState(root, state) {
    root.setAttribute('data-pay', state);
    var els = root.querySelectorAll('[data-show]');
    for (var i = 0; i < els.length; i++) {
      els[i].hidden = (' ' + els[i].getAttribute('data-show') + ' ').indexOf(' ' + state + ' ') === -1;
    }
  }

  // open = live keys, or test keys and the ?test=1 address
  function stateFrom(res) {
    var c = res && res.ok && res.data;
    if (!c || !c.open) return { state: 'closed', cfg: c || null };
    if (c.mode === 'test' && !wantsTest) return { state: 'closed', cfg: c };
    return { state: 'open', cfg: c };
  }

  function usd(n) {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); }
    catch (e) { return '$' + Number(n).toFixed(2); }
  }

  function text(root, sel, value) {
    var el = root.querySelector(sel);
    if (el) el.textContent = value;
  }

  // ---- the portal page and the pay page: is it open? ----
  var gates = document.querySelectorAll('[data-pay-gate]');
  var form = document.querySelector('[data-pay-form]');
  if (gates.length) {
    getJSON(API, 8000).then(function (res) {
      var s = stateFrom(res);
      for (var i = 0; i < gates.length; i++) {
        setState(gates[i], s.state);
        if (s.cfg && s.cfg.mode === 'test' && wantsTest) gates[i].setAttribute('data-test', '1');
        var testFlags = gates[i].querySelectorAll('[data-test-only]');
        for (var j = 0; j < testFlags.length; j++) testFlags[j].hidden = !(s.state === 'open' && s.cfg && s.cfg.mode === 'test');
        // a setup hint only for whoever is testing with ?test=1, never for customers
        var hint = gates[i].querySelector('[data-setup-hint]');
        if (hint) {
          var msg = '';
          if (wantsTest && (!s.cfg)) msg = 'Setup check: the payment function did not answer. On a plain static preview this is expected. On Netlify, check the deploy finished.';
          else if (wantsTest && s.cfg && s.cfg.problem === 'key-format') msg = 'Setup check: STRIPE_SECRET_KEY is set in Netlify but it is not a secret key. It must start sk_test_ or sk_live_ (not pk_). Fix it, then trigger a deploy.';
          else if (wantsTest && s.cfg && !s.cfg.open) msg = 'Setup check: no STRIPE_SECRET_KEY in Netlify yet, or the site was not redeployed after adding it.';
          hint.textContent = msg;
          hint.hidden = !msg;
        }
        if (s.state === 'open' && s.cfg) {
          var range = gates[i].querySelector('[data-pay-range]');
          if (range) range.textContent = 'From ' + usd(s.cfg.min) + ' to ' + usd(s.cfg.max) + ' per payment.';
        }
      }
      if (params.get('cancelled') === '1') {
        var c = document.querySelector('[data-pay-cancelled]');
        if (c && s.state === 'open') c.hidden = false;
      }
      // keep ?test=1 on the portal page's pay button so a tester lands on the open form
      if (wantsTest) {
        var links = document.querySelectorAll('a[data-pay-link]');
        for (var k = 0; k < links.length; k++) links[k].setAttribute('href', '/portal/pay/?test=1');
      }
    });
  }

  // ---- the pay form: check it here for a friendly message, the server checks it again for real ----
  if (form) {
    var btn = form.querySelector('button[type="submit"]');
    var btnLabel = btn ? btn.textContent : '';
    var msgBox = form.querySelector('[data-pay-error]');

    function showError(message, field) {
      if (msgBox) { msgBox.textContent = message; msgBox.hidden = false; }
      var bad = form.querySelectorAll('[aria-invalid="true"]');
      for (var i = 0; i < bad.length; i++) bad[i].removeAttribute('aria-invalid');
      if (field) {
        var f = form.querySelector('[name="' + field + '"]');
        if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); }
      } else if (msgBox) {
        msgBox.focus();
      }
    }

    function busy(on) {
      if (!btn) return;
      btn.disabled = on;
      btn.textContent = on ? 'Opening secure checkout...' : btnLabel;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (msgBox) msgBox.hidden = true;
      if (!form.reportValidity()) return;
      var data = {
        company: form.company.value,
        account: form.account.value,
        invoices: form.invoices.value,
        amount: form.amount.value,
        'bot-field': form['bot-field'] ? form['bot-field'].value : ''
      };
      busy(true);
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 20000);
      fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(data),
        signal: ctrl ? ctrl.signal : undefined
      })
        .then(function (r) { clearTimeout(timer); return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (res.ok && res.d && typeof res.d.url === 'string' && res.d.url.indexOf('https://checkout.stripe.com/') === 0) {
            window.location.assign(res.d.url);
            return;
          }
          busy(false);
          showError((res.d && res.d.error) || 'We could not open the secure payment page. Nothing was charged. Please call the office at (215) 721-1636.', res.d && res.d.field);
        })
        .catch(function () {
          clearTimeout(timer);
          busy(false);
          showError('We could not reach the payment service. Nothing was charged. Please try again in a minute or call the office at (215) 721-1636.');
        });
    });

    // coming back with the browser's back button after leaving for Stripe
    window.addEventListener('pageshow', function () { busy(false); });
  }

  // ---- the thank you page ----
  var thanks = document.querySelector('[data-pay-thanks]');
  if (thanks) {
    var id = params.get('session_id') || '';
    if (!/^cs_(test|live)_[A-Za-z0-9]{10,250}$/.test(id)) {
      setState(thanks, 'unknown');
    } else {
      getJSON(API + '?session_id=' + encodeURIComponent(id), 10000).then(function (res) {
        var d = res.ok && res.data;
        if (!d || !d.status) { setState(thanks, 'unknown'); return; }
        if (d.status !== 'complete') { setState(thanks, d.status === 'expired' ? 'expired' : 'unfinished'); return; }
        text(thanks, '[data-v="amount"]', d.amount != null ? usd(d.amount) : '');
        text(thanks, '[data-v="invoices"]', d.invoices || '');
        text(thanks, '[data-v="company"]', d.company || '');
        text(thanks, '[data-v="account"]', d.account || '');
        var acc = thanks.querySelector('[data-row="account"]');
        if (acc) acc.hidden = !d.account;
        text(thanks, '[data-v="status"]', d.paid ? 'Received' : 'Processing with your bank');
        var t = thanks.querySelector('[data-test-only]');
        if (t) t.hidden = !d.test;
        setState(thanks, d.paid ? 'paid' : 'processing');
      });
    }
  }
})();
