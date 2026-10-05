// Chemtec customer portal: pay an invoice by bank, through Stripe Checkout.
//
// One function, three jobs, all at /.netlify/functions/pay
//   GET                        is online payment open, and is it test or live?
//   POST (JSON)                check the form on the server, create a Stripe Checkout Session, return its URL
//   GET ?session_id=cs_...     what happened on Stripe's page (for the thank you page)
//
// The Stripe key lives ONLY in the Netlify environment variable STRIPE_SECRET_KEY.
// Nothing secret is in this file or in any page. No key set means payments are closed:
// the pages show "open soon" and nothing breaks.
//
// Optional Netlify environment variables (all have safe defaults):
//   PAY_MIN_USD   smallest payment accepted, default 1
//   PAY_MAX_USD   largest payment accepted, default 25000
//   PAY_METHODS   comma list, default "us_bank_account" (bank only, as agreed for v1).
//                 "us_bank_account,card" switches card on later without a code change.
//
// No packages: it talks to Stripe's REST API with fetch, so there is nothing to install.
// Built by Apex Solved for Chemtec Products Company, 5 Oct 2026.

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_VERSION = "2024-06-20"; // pinned so a Stripe account upgrade never changes behaviour
const SOURCE_TAG = "chemtec-portal";
const ALLOWED_METHODS = new Set(["us_bank_account", "card"]);
const OFFICE = "(215) 721-1636";

// ---------- settings from the Netlify environment ----------

function numberFromEnv(name, fallback) {
  const n = Number(String(process.env[name] ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function settings() {
  const raw = String(process.env.STRIPE_SECRET_KEY ?? "").trim();
  const m = /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.exec(raw);
  let min = numberFromEnv("PAY_MIN_USD", 1);
  let max = numberFromEnv("PAY_MAX_USD", 25000);
  if (min < 0.5) min = 0.5; // Stripe's own floor
  if (max < min) max = min;
  const methods = String(process.env.PAY_METHODS ?? "us_bank_account")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ALLOWED_METHODS.has(s));
  return {
    key: m ? raw : "",
    mode: m ? m[2] : null, // "test" or "live"
    keyProblem: Boolean(raw) && !m, // set, but not a Stripe secret key (a pk_ publishable key, a typo)
    minCents: Math.round(min * 100),
    maxCents: Math.round(max * 100),
    methods: methods.length ? [...new Set(methods)] : ["us_bank_account"],
  };
}

// ---------- small helpers ----------

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

function cleanText(raw, max) {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max + 1);
}

// "$1,234.50", "1234.5", "1234" -> cents as an integer. Anything else -> null.
function amountToCents(raw) {
  const s = String(raw ?? "").trim().replace(/^\$\s*/, "");
  if (!/^(\d{1,3}(,\d{3})+|\d{1,7})(\.\d{1,2})?$/.test(s)) return null;
  const [dollars, cents = ""] = s.replace(/,/g, "").split(".");
  return Number(dollars) * 100 + Number((cents + "00").slice(0, 2));
}

// "2201, 2202" or "#2201 2202" -> "2201, 2202". Up to 10, each 1 to 20 letters, digits or dashes.
function cleanInvoices(raw) {
  const parts = cleanText(raw, 300)
    .split(/[\s,;]+/)
    .map((p) => p.replace(/^#/, ""))
    .filter(Boolean);
  if (parts.length < 1 || parts.length > 10) return null;
  if (!parts.every((p) => /^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(p))) return null;
  return [...new Set(parts)].join(", ");
}

function money(cents) {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Where Stripe sends the customer back. The request already reached this site, so its own origin is right;
// plain http is only trusted for local testing.
function siteOrigin(req) {
  const u = new URL(req.url);
  if (u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1") return u.origin;
  return String(process.env.URL || u.origin).replace(/\/+$/, "");
}

async function stripe(s, method, path, form) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(STRIPE_API + path, {
      method,
      headers: {
        authorization: "Bearer " + s.key,
        "stripe-version": STRIPE_VERSION,
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form ? form.toString() : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function logStripeError(where, r) {
  // Stripe's error text never carries the full key (it masks it); the key itself is never logged.
  const e = (r && r.data && r.data.error) || {};
  console.error(`[pay] ${where}: Stripe ${r ? r.status : "no response"} ${e.type || ""} ${e.code || ""} ${e.param || ""} ${e.message || ""}`.trim());
}

// ---------- the three jobs ----------

function config(s) {
  if (s.keyProblem) console.error("[pay] STRIPE_SECRET_KEY is set but is not a Stripe secret key (it must start sk_test_, sk_live_, rk_test_ or rk_live_). Payments stay closed.");
  return json(200, {
    open: Boolean(s.key),
    mode: s.mode,
    problem: s.keyProblem ? "key-format" : null,
    min: s.minCents / 100,
    max: s.maxCents / 100,
    methods: s.methods,
  });
}

async function createCheckout(req, s) {
  if (!s.key) {
    return json(503, { error: `Online payments are not open yet. Nothing was charged. Please pay by check as usual or call the office at ${OFFICE}.` });
  }
  const type = req.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) return json(415, { error: "Please use the payment form on the site." });
  const text = await req.text();
  if (text.length > 4000) return json(413, { error: "That form was too large. Please try again." });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { error: "Please use the payment form on the site." });

  // the same hidden trap field the quote form uses; people never see it, bots fill it
  if (cleanText(body["bot-field"], 50)) return json(400, { error: "Please use the payment form on the site." });

  const company = cleanText(body.company, 100);
  if (company.length < 2 || company.length > 100 || !/^[\p{L}\p{N} &.,'\u2019()\/#+-]+$/u.test(company)) {
    return json(400, { field: "company", error: "Enter the company name as it appears on your invoice (letters, numbers and simple punctuation)." });
  }

  const account = cleanText(body.account, 30);
  if (account && !/^[A-Za-z0-9][A-Za-z0-9 .\/-]{0,29}$/.test(account)) {
    return json(400, { field: "account", error: "The account number can use letters, numbers and dashes only. Leave it blank if it is not on your invoice." });
  }

  const invoices = cleanInvoices(body.invoices);
  if (!invoices) {
    return json(400, { field: "invoices", error: "Enter one or more invoice numbers, separated by commas (up to 10)." });
  }

  const cents = amountToCents(body.amount);
  if (cents === null) return json(400, { field: "amount", error: "Enter the amount in dollars and cents, for example 1250.00." });
  if (cents < s.minCents || cents > s.maxCents) {
    return json(400, { field: "amount", error: `Online payments can be from ${money(s.minCents)} to ${money(s.maxCents)}. For a larger amount please call the office at ${OFFICE}.` });
  }

  const origin = siteOrigin(req);
  const testSuffix = s.mode === "test" ? "&test=1" : "";
  const label = `Invoice ${invoices}` + (account ? ` | Account ${account}` : "");
  const meta = { source: SOURCE_TAG, company, account: account || "", invoices, amount: money(cents) };

  const p = new URLSearchParams();
  p.append("mode", "payment");
  p.append("submit_type", "pay");
  s.methods.forEach((m, i) => p.append(`payment_method_types[${i}]`, m));
  p.append("line_items[0][quantity]", "1");
  p.append("line_items[0][price_data][currency]", "usd");
  p.append("line_items[0][price_data][unit_amount]", String(cents));
  p.append("line_items[0][price_data][product_data][name]", "Payment to Chemtec Products Company");
  p.append("line_items[0][price_data][product_data][description]", `${company} | ${label}`.slice(0, 300));
  p.append("customer_creation", "always");
  p.append("client_reference_id", (account || company).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200) || "chemtec-customer");
  p.append("success_url", `${origin}/portal/pay/thanks/?session_id={CHECKOUT_SESSION_ID}`);
  p.append("cancel_url", `${origin}/portal/pay/?cancelled=1${testSuffix}`);
  for (const [k, v] of Object.entries(meta)) {
    p.append(`metadata[${k}]`, v);
    p.append(`payment_intent_data[metadata][${k}]`, v);
  }
  // what Fay sees on the payment in Stripe and in Stripe's email, ready for Receive Payment in QuickBooks
  p.append("payment_intent_data[description]", `Chemtec portal payment: ${company} | ${label}`.slice(0, 1000));

  let r;
  try {
    r = await stripe(s, "POST", "/checkout/sessions", p);
  } catch (err) {
    console.error(`[pay] create: could not reach Stripe (${err && err.name})`);
    return json(502, { error: `We could not open the secure payment page. Nothing was charged. Please try again in a minute or call the office at ${OFFICE}.` });
  }
  if (!r.ok || !r.data || typeof r.data.url !== "string" || !r.data.url.startsWith("https://checkout.stripe.com/")) {
    logStripeError("create", r);
    return json(502, { error: `We could not open the secure payment page. Nothing was charged. Please try again in a minute or call the office at ${OFFICE}.` });
  }
  return json(200, { url: r.data.url });
}

async function sessionStatus(id, s) {
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,250}$/.test(id)) return json(400, { error: "That payment reference is not valid." });
  if (!s.key) return json(503, { error: "Online payments are not open." });
  let r;
  try {
    r = await stripe(s, "GET", `/checkout/sessions/${encodeURIComponent(id)}`);
  } catch (err) {
    console.error(`[pay] status: could not reach Stripe (${err && err.name})`);
    return json(502, { error: "We could not check the payment just now." });
  }
  // only sessions this site created; anything else in the Stripe account stays invisible here
  if (!r.ok || !r.data || !r.data.metadata || r.data.metadata.source !== SOURCE_TAG) {
    if (!r.ok && r.status !== 404) logStripeError("status", r);
    return json(404, { error: "We could not find that payment." });
  }
  const d = r.data;
  return json(200, {
    status: d.status, // open, complete or expired
    paid: d.payment_status === "paid",
    processing: d.status === "complete" && d.payment_status !== "paid", // bank payments clear in up to four business days
    amount: typeof d.amount_total === "number" ? d.amount_total / 100 : null,
    company: d.metadata.company || "",
    account: d.metadata.account || "",
    invoices: d.metadata.invoices || "",
    test: d.livemode === false,
  });
}

export default async (req) => {
  const s = settings();
  const url = new URL(req.url);
  if (req.method === "GET") {
    const id = url.searchParams.get("session_id");
    return id ? sessionStatus(id, s) : config(s);
  }
  if (req.method === "POST") return createCheckout(req, s);
  return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
};
