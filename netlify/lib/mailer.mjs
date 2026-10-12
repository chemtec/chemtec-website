// Chemtec customer portal: sending the branded login email through Resend (8 Oct 2026).
// OFF until the Netlify environment variable RESEND_API_KEY is set. Then, when an admin ticks "Email the login now"
// (or presses Send on the one time panel), the request that made or reset the login sends one email:
//   POST https://api.resend.com/emails   Authorization: Bearer RESEND_API_KEY
//   { from: PORTAL_FROM, to: [the login's email], reply_to: PORTAL_REPLY_TO, subject, html, text }
// Environment variables (names only; values live in Netlify):
//   RESEND_API_KEY    a Resend key with "Sending access" for the sending domain only
//   PORTAL_FROM       optional, default "Chemtec Products Company <portal@chemtecpro.com>"
//   PORTAL_REPLY_TO   optional, default service@chemtecproductscompany.com
//   RESEND_API_URL    tests only: a local mock (http on localhost or 127.0.0.1). Any other value is ignored, so the
//                     key can only ever go to Resend or to this computer
// The temporary password lives only in this request's memory, inside the rendered email. It is never stored,
// never logged and never put in an error. The log says only which template, for which login, by which admin, and
// the status: never the address, never the password. Sends are limited per admin (SENDS_PER_HOUR), counted in
// the Netlify Blobs store "portal-mail" before the send.
// Built by Apex Solved for Chemtec Products Company, 8 Oct 2026.

import { getStore } from "@netlify/blobs";

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const DEFAULT_FROM = "Chemtec Products Company <portal@chemtecpro.com>";
export const DEFAULT_REPLY_TO = "service@chemtecproductscompany.com";
export const MAIL_STORE = "portal-mail";
export const SENDS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

export const MAIL_NOT_SET_UP = "Automatic email is not set up yet.";

/** True when RESEND_API_KEY is set (never reads it out). */
export function mailConfigured() {
  const k = process.env.RESEND_API_KEY;
  return typeof k === "string" && k.trim().length > 0;
}

/**
 * One email address that is safe to hand to the mail API, or null. Exactly one address: printable ASCII only
 * (so no CR, LF, tab or NUL can start a new header), no spaces, commas, semicolons, angle brackets, quotes or
 * brackets (so no second address or display name can ride along), one @, a 64 character local part,
 * a dotted domain, 254 characters at most.
 */
export function sendableEmail(raw) {
  if (typeof raw !== "string") return null;
  const e = raw.trim();
  if (e.length < 6 || e.length > 254) return null;
  if (!/^[\x21-\x7e]+$/.test(e)) return null;
  if (/[,;<>"'()\[\]\\:]/.test(e)) return null;
  const at = e.indexOf("@");
  if (at < 1 || at !== e.lastIndexOf("@")) return null;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/.test(domain)) return null;
  return e;
}

/** PORTAL_FROM as Resend takes it: "Name <address>" or a bare address. null when it is not safe. */
export function senderFrom(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return DEFAULT_FROM;
  if (v.length > 160 || /[\r\n\t\0]/.test(v)) return null;
  const m = /^([A-Za-z0-9 &'-]{1,100}) <([^<>\s]+)>$/.exec(v);
  if (m) return sendableEmail(m[2]) ? `${m[1].trim()} <${m[2]}>` : null;
  return sendableEmail(v);
}

/** PORTAL_REPLY_TO, one address. null when it is not safe. */
export function replyTo(raw) {
  const v = String(raw ?? "").trim();
  return v ? sendableEmail(v) : DEFAULT_REPLY_TO;
}

/** Where the request goes: Resend, or (tests only) a mock on this computer. */
export function endpoint() {
  const o = String(process.env.RESEND_API_URL || "").trim();
  if (!o) return RESEND_ENDPOINT;
  try {
    const u = new URL(o);
    if (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return u.toString();
  } catch {
    /* not a URL: ignored */
  }
  return RESEND_ENDPOINT;
}

/** The call behind a send, for the admin page's session log (no key, no address, no password). */
export function mailCall() {
  return {
    sdk: `fetch("${RESEND_ENDPOINT}", { method: "POST", headers: { Authorization: "Bearer <RESEND_API_KEY>" }, body: JSON.stringify({ from, to, reply_to, subject, html, text }) })`,
    rest: `POST ${RESEND_ENDPOINT}  (Authorization: Bearer <RESEND_API_KEY>)  body: { from: PORTAL_FROM, to: [the login's email], reply_to: PORTAL_REPLY_TO, subject, html, text }`,
  };
}

function mailStore() {
  return getStore({ name: MAIL_STORE, consistency: "strong" });
}

/**
 * Take one send for this admin, BEFORE the send: at most SENDS_PER_HOUR in any hour. The count is a list of
 * times in the store "portal-mail", key sends-<admin username>, written conditionally on its etag (on Netlify)
 * so sends at the same moment cannot both take the last one. Returns { ok: true } or { ok: false, busy? }.
 */
export async function takeSendSlot(adminUsername, now = Date.now()) {
  const s = mailStore();
  const key = "sends-" + String(adminUsername || "unknown").replace(/[^a-z0-9._-]/g, "_");
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await s.getWithMetadata(key, { type: "json" });
    const old = cur && cur.data && Array.isArray(cur.data.sends) ? cur.data.sends : [];
    const recent = old.filter((t) => Number.isFinite(t) && t > now - HOUR_MS && t <= now + 60 * 1000);
    if (recent.length >= SENDS_PER_HOUR) return { ok: false };
    recent.push(now);
    const next = { sends: recent, updatedAt: new Date(now).toISOString() };
    let w;
    if (!cur) w = await s.setJSON(key, next, { onlyIfNew: true });
    else if (cur.etag) w = await s.setJSON(key, next, { onlyIfMatch: cur.etag });
    else w = await s.setJSON(key, next); // the netlify dev emulator gives no etag
    if (!w || w.modified !== false) return { ok: true };
  }
  return { ok: false, busy: true };
}

function result(status, message, extra = {}) {
  return { status, sent: status === "sent", message, call: mailCall(), ...extra };
}

function failedMessage(httpStatus) {
  if (httpStatus === 401 || httpStatus === 403) return "Not sent: Resend refused it. Check RESEND_API_KEY in Netlify, and that the sending domain is verified in Resend.";
  if (httpStatus === 400 || httpStatus === 422) return "Not sent: Resend did not accept this email. Check the address on this login, and PORTAL_FROM in Netlify.";
  if (httpStatus === 429) return "Not sent: Resend is busy right now. Press Send again in a minute.";
  return `Not sent: Resend had a problem (status ${httpStatus}). Press Send again, or use Copy branded email.`;
}

/**
 * Send one rendered login email (from renderLoginEmail) to this login's address.
 *   email   { kind, subject, html, text }   the password is inside it, in memory only
 *   user    the login's record (username, email)
 *   admin   the admin who asked (for the rate limit and the log)
 * Returns { status, sent, message, to?, call }. status: sent | not-configured | no-email | bad-email | bad-config |
 * rate-limited | busy | failed. Never throws for a send problem, never returns the password or the key.
 */
export async function sendLoginEmail({ email, user, admin }) {
  const who = `${email && email.kind} for ${(user && user.username) || "?"} by ${(admin && admin.username) || "?"}`;
  if (!mailConfigured()) return result("not-configured", MAIL_NOT_SET_UP);
  if (!user || !user.email) return result("no-email", "There is no email address on this login, so nothing was sent.");
  const to = sendableEmail(user.email);
  if (!to) {
    console.log(`[portal] login email ${who}: not sent (address refused)`);
    return result("bad-email", "Not sent: the email address on this login cannot be used for sending. Check it, then use Copy branded email.");
  }
  const from = senderFrom(process.env.PORTAL_FROM);
  const reply = replyTo(process.env.PORTAL_REPLY_TO);
  if (!from || !reply) {
    console.log(`[portal] login email ${who}: not sent (PORTAL_FROM or PORTAL_REPLY_TO is not one valid address)`);
    return result("bad-config", "Not sent: PORTAL_FROM or PORTAL_REPLY_TO in Netlify is not one valid address.");
  }
  let slot;
  try {
    slot = await takeSendSlot(admin && admin.username);
  } catch (err) {
    console.log(`[portal] login email ${who}: not sent (the send count could not be read: ${(err && err.name) || "error"})`);
    return result("failed", "Not sent: something went wrong on our side. Press Send again, or use Copy branded email.");
  }
  if (!slot.ok) {
    console.log(`[portal] login email ${who}: not sent (${slot.busy ? "busy" : "hourly limit"})`);
    return slot.busy
      ? result("busy", "Not sent: too many sends at the same moment. Press Send again.")
      : result("rate-limited", `Not sent: ${SENDS_PER_HOUR} emails in the last hour is the most one admin can send. Try again later, or use Copy branded email.`);
  }

  let res;
  try {
    res = await fetch(endpoint(), {
      method: "POST",
      redirect: "error", // the key never follows a redirect anywhere
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`,
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "chemtec-portal/1.0",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: reply,
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: [{ name: "category", value: String(email.kind || "login").replace(/[^A-Za-z0-9_-]/g, "_") }],
      }),
    });
  } catch (err) {
    console.log(`[portal] login email ${who}: failed (${(err && err.name) || "network error"})`);
    return result("failed", "Not sent: Resend did not answer. Press Send again, or use Copy branded email.");
  }
  try {
    await res.text(); // drained, never logged (an error body can echo the address)
  } catch {
    /* ignore */
  }
  if (res.ok) {
    console.log(`[portal] login email ${who}: sent (${res.status})`);
    return result("sent", `Sent to ${to}.`, { to });
  }
  console.log(`[portal] login email ${who}: failed (${res.status})`);
  return result("failed", failedMessage(res.status), { httpStatus: res.status });
}
