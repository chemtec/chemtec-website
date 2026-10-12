// Chemtec customer portal: what every portal function shares (Node only).
//   the user store      Netlify Blobs, store "portal-users", one JSON record per login,
//                       key = the username in lowercase (a customer's account number, or an admin's username)
//   passwords           node:crypto scrypt with a random 16 byte salt; a plain password is never stored, logged or returned
//                       (the one exception: a new temporary password goes back ONCE to the admin who made it)
//   sessions            the signed cookie in ./session.mjs
//   requests            JSON in and out, never cached, and every POST or DELETE must carry the header
//                       X-Requested-With: chemtec-portal (a page on another site cannot add it), plus SameSite cookies
//
// Netlify environment variables (names only; the values live in Netlify, never in the code):
//   SESSION_SECRET   at least 32 random characters; signs the session cookie
//   ADMIN_USERNAME   the first admin login, used only while the store holds no admin
//   ADMIN_PASSWORD   that first admin's starting password (at least 10 characters); remove it once the admin exists
//   RESEND_API_KEY, PORTAL_FROM, PORTAL_REPLY_TO   the branded login email (optional; see ./mailer.mjs)
//
// Built by Apex Solved for Chemtec Products Company, 8 Oct 2026.

import { webcrypto, scrypt as scryptCb, randomBytes, randomInt, timingSafeEqual, createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import {
  USERNAME_RE,
  ACCOUNT_RE,
  ADMIN_USERNAME_RE,
  COOKIE_NAME,
  readCookie,
  verifySession,
  signSession,
  sessionCookie,
  clearedCookie,
  secretProblem,
} from "./session.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto; // older Node runtimes

export const STORE_NAME = "portal-users";
export const OFFICE = "(215) 721-1636";
export const SERVICE_EMAIL = "service@chemtecproductscompany.com";
export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "chemtec-portal";
export const MAX_FAILS = 10;
export const LOCK_MINUTES = 15;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const ENV_NAMES = [
  "SESSION_SECRET",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "RESEND_API_KEY",
  "PORTAL_FROM",
  "PORTAL_REPLY_TO",
  "STRIPE_SECRET_KEY",
  "PAY_MIN_USD",
  "PAY_MAX_USD",
  "PAY_METHODS",
];
export const EMAIL_RE = /^[^\s@<>"'(),;:\\]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

// ---------- the store ----------

export function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

export async function getUser(username) {
  if (!USERNAME_RE.test(username || "")) return null;
  const u = await store().get(username, { type: "json" });
  return u && typeof u === "object" ? u : null;
}

let warnedNoEtag = false;
/**
 * Read, change and write one record, retrying if someone else wrote it in between. On Netlify the write is
 * conditional on the etag read (onlyIfMatch), which is what makes the try counter in takeTry hold under a
 * burst. The netlify dev emulator returns no etag on a read, so there (only) the write is plain.
 */
export async function updateUser(username, mutate) {
  const s = store();
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await s.getWithMetadata(username, { type: "json" });
    if (!cur || !cur.data) return null;
    if (!cur.etag && !warnedNoEtag) {
      warnedNoEtag = true;
      console.warn("[portal] the store gave no etag, so this write is not conditional (expected only under netlify dev)");
    }
    const next = mutate(structuredClone(cur.data));
    if (!next) return cur.data;
    const w = cur.etag ? await s.setJSON(username, next, { onlyIfMatch: cur.etag }) : await s.setJSON(username, next);
    if (!w || w.modified !== false) return next;
  }
  throw new Error("The record kept changing; try again");
}

/** Every record in the store (read eight at a time). Each: { key, etag, size, data }. */
export async function listUsers() {
  const s = store();
  const { blobs } = await s.list();
  const out = [];
  for (let i = 0; i < blobs.length; i += 8) {
    const batch = await Promise.all(
      blobs.slice(i, i + 8).map(async (b) => {
        const raw = await s.get(b.key, { type: "text" });
        if (raw == null) return null;
        let data = null;
        try {
          data = JSON.parse(raw);
        } catch {
          data = null;
        }
        return { key: b.key, etag: b.etag || "", size: Buffer.byteLength(raw, "utf8"), data };
      })
    );
    for (const r of batch) if (r) out.push(r);
  }
  return out;
}

// ---------- usernames and passwords ----------

/** Any login name typed on the log in form (an account number or an admin username) as its store key. */
export function cleanUsername(raw) {
  const u = String(raw ?? "").trim().toLowerCase();
  return USERNAME_RE.test(u) ? u : null;
}

/** A customer's account number: { typed, key } or null. The typed form is shown, the lowercase key is stored. */
export function cleanAccountNumber(raw) {
  const typed = String(raw ?? "").trim();
  if (!ACCOUNT_RE.test(typed)) return null;
  return { typed, key: typed.toLowerCase() };
}

/** An admin's username (3 to 40 characters, lowercase letters, digits, . _ -), or null. */
export function cleanAdminUsername(raw) {
  const u = String(raw ?? "").trim().toLowerCase();
  return ADMIN_USERNAME_RE.test(u) ? u : null;
}

export function cleanText(raw, max) {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function cleanEmail(raw) {
  const e = cleanText(raw, 254);
  return EMAIL_RE.test(e) ? e : null;
}

export function passwordProblem(pw, username) {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (username && pw.trim().toLowerCase() === String(username).toLowerCase()) return "Do not use the username or account number as the password.";
  if (/^(.)\1+$/.test(pw)) return "Use a mix of characters, not one repeated.";
  return null;
}

function scrypt(password, salt, params) {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: params.maxmem }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password).normalize("NFKC"), salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

let dummyHash = null;
/** True only when the password matches the stored hash. Takes the same time when there is no hash. */
export async function verifyPassword(password, stored) {
  if (!dummyHash) dummyHash = await hashPassword(randomBytes(12).toString("hex"));
  const parts = String(stored || dummyHash).split("$");
  const usable = parts.length === 6 && parts[0] === "scrypt";
  const p = usable ? parts : dummyHash.split("$");
  const params = { N: Number(p[1]), r: Number(p[2]), p: Number(p[3]), keylen: 64, maxmem: SCRYPT.maxmem };
  const salt = Buffer.from(p[4], "base64");
  const want = Buffer.from(p[5], "base64");
  const got = await scrypt(String(password ?? "").normalize("NFKC"), salt, { ...params, keylen: want.length || 64 });
  return usable && Boolean(stored) && got.length === want.length && timingSafeEqual(got, want);
}

/** Constant time string comparison (hashes both first so the lengths match). */
export function sameString(a, b) {
  const x = createHash("sha256").update(String(a ?? "")).digest();
  const y = createHash("sha256").update(String(b ?? "")).digest();
  return timingSafeEqual(x, y);
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"; // no 0 O 1 l I
/** A strong temporary password: four groups of four, about 92 bits. */
export function temporaryPassword() {
  const groups = [];
  for (let g = 0; g < 4; g++) {
    let s = "";
    for (let i = 0; i < 4; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(s);
  }
  return groups.join("-");
}

// ---------- records ----------

export function newUserRecord({ username, accountNumber, displayName, company, email, role, passwordHash, createdBy }) {
  const now = new Date().toISOString();
  return {
    username, // the store key, lowercase
    accountNumber: role === "customer" ? accountNumber || username : "", // as the admin typed it
    displayName,
    company: company || "",
    email: email || "",
    role,
    active: true,
    mustChangePassword: true,
    passwordHash,
    sessionVersion: 1,
    createdAt: now,
    createdBy,
    updatedAt: now,
    lastLoginAt: null,
    failedLogins: 0,
    lockedUntil: null,
  };
}

export function isLocked(u, now = Date.now()) {
  return Boolean(u && u.lockedUntil && Date.parse(u.lockedUntil) > now);
}

/**
 * Take one password try for this login BEFORE the password is checked (log in and change password).
 * The count goes up first, through a conditional write (onlyIfMatch on the record's etag), and only a try
 * that got one of the MAX_FAILS slots is checked. So a burst of guesses sent all at once gets at most
 * MAX_FAILS checks per lock, not one check per request. The try that takes the last slot starts the lock;
 * a right password on it lifts the lock again.
 * Returns { ok: true, user, last } | { locked: true, until } | { busy: true } | { missing: true }.
 */
export async function takeTry(username, now = Date.now()) {
  let outcome = null;
  let rec;
  try {
    rec = await updateUser(username, (u) => {
      outcome = null;
      if (isLocked(u, now)) {
        outcome = { locked: true, until: u.lockedUntil };
        return null; // nothing to write
      }
      if (u.lockedUntil) {
        u.failedLogins = 0; // the last lock ran out: start counting again
        u.lockedUntil = null;
      }
      const lockUntil = new Date(now + LOCK_MINUTES * 60 * 1000).toISOString();
      if ((Number(u.failedLogins) || 0) >= MAX_FAILS) {
        u.lockedUntil = lockUntil; // every slot is used: lock without checking this one
        outcome = { locked: true, until: lockUntil };
        return u;
      }
      u.failedLogins = (Number(u.failedLogins) || 0) + 1;
      if (u.failedLogins >= MAX_FAILS) u.lockedUntil = lockUntil;
      return u;
    });
  } catch {
    return { busy: true }; // the record kept changing (many tries at the same moment): refuse, do not check
  }
  if (!rec) return { missing: true };
  if (outcome) return outcome;
  return { ok: true, user: rec, last: (Number(rec.failedLogins) || 0) >= MAX_FAILS };
}

/** What a person types on the log in form: the account number as typed, or the admin username. */
export function loginName(u) {
  if (!u) return "";
  return (u.role === "customer" && u.accountNumber) || u.username;
}

/** Everything a page may see about a login. Never the password hash. */
export function publicUser(u) {
  if (!u) return null;
  return {
    username: u.username,
    loginName: loginName(u),
    accountNumber: u.role === "customer" ? u.accountNumber || u.username : "",
    displayName: u.displayName || "",
    company: u.company || "",
    email: u.email || "",
    role: u.role,
    active: u.active === true,
    mustChangePassword: u.mustChangePassword === true,
    createdAt: u.createdAt || null,
    createdBy: u.createdBy || "",
    updatedAt: u.updatedAt || null,
    lastLoginAt: u.lastLoginAt || null,
    failedLogins: Number(u.failedLogins) || 0,
    lockedUntil: isLocked(u) ? u.lockedUntil : null,
    locked: isLocked(u),
  };
}

/** What a person may see about their own login: no admin names, counters or timestamps. */
export function selfUser(u) {
  if (!u) return null;
  return {
    username: u.username,
    loginName: loginName(u),
    accountNumber: u.role === "customer" ? u.accountNumber || u.username : "",
    displayName: u.displayName || "",
    company: u.company || "",
    email: u.email || "",
    role: u.role,
    mustChangePassword: u.mustChangePassword === true,
  };
}

/** Count of admins that are turned on (reads every record). */
export async function activeAdminCount() {
  const all = await listUsers();
  return all.filter((r) => r.data && r.data.role === "admin" && r.data.active === true).length;
}

// ---------- requests and responses ----------

export function json(status, body, headers = {}) {
  const h = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
    "x-content-type-options": "nosniff",
  });
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
    else if (v != null) h.set(k, v);
  }
  return new Response(JSON.stringify(body), { status, headers: h });
}

/** A POST or DELETE that did not come from this site's own pages. */
export function csrfProblem(req) {
  if ((req.headers.get(CSRF_HEADER) || "") !== CSRF_VALUE) return true;
  const origin = req.headers.get("origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      return true;
    }
    const allowed = new Set([new URL(req.url).host, req.headers.get("host"), req.headers.get("x-forwarded-host")].filter(Boolean));
    if (!allowed.has(host)) return true;
  }
  return false;
}

export async function readJson(req, maxBytes = 8000) {
  const type = (req.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("application/json")) return null;
  const text = await req.text();
  if (!text || text.length > maxBytes) return null;
  try {
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export function sessionSecret() {
  return process.env.SESSION_SECRET || "";
}

export const NOT_SET_UP = { error: `The customer portal is being set up. Please call the office at ${OFFICE}.`, setup: false };

/** The session in this request's cookie, or null (missing, forged, tampered with or expired). */
export async function readSession(req) {
  const secret = sessionSecret();
  if (secretProblem(secret)) return null;
  const token = readCookie(req.headers.get("cookie"), COOKIE_NAME);
  return token ? verifySession(secret, token) : null;
}

/**
 * The logged in user for this request, re-read from the store every time.
 * Returns { user, session } or { error: Response }.
 */
export async function requireUser(req, { admin = false, allowMustChange = false } = {}) {
  const secret = sessionSecret();
  if (secretProblem(secret)) return { error: json(503, NOT_SET_UP) };
  const token = readCookie(req.headers.get("cookie"), COOKIE_NAME);
  const session = token ? await verifySession(secret, token) : null;
  const clear = token ? { "set-cookie": clearedCookie() } : {};
  if (!session) return { error: json(401, { error: "Please log in.", loggedIn: false }, clear) };
  const user = await getUser(session.username);
  if (!user || user.active !== true || user.sessionVersion !== session.sv) {
    return { error: json(401, { error: "Your session has ended. Please log in again.", loggedIn: false }, { "set-cookie": clearedCookie() }) };
  }
  if (!allowMustChange && user.mustChangePassword) {
    return { error: json(403, { error: "Please choose your own password first.", mustChangePassword: true }) };
  }
  if (admin && user.role !== "admin") return { error: json(403, { error: "This page is for Chemtec staff only." }) };
  return { user, session };
}

/**
 * Every portal function goes through this: an unexpected error answers with a plain message and a 500,
 * never a stack trace or an internal detail, and the log line names only the kind of error.
 */
export function guarded(handler) {
  return async (req, context) => {
    try {
      return await handler(req, context);
    } catch (err) {
      let where = "";
      try {
        where = new URL(req.url).pathname.slice(0, 80);
      } catch {
        where = "";
      }
      console.error(`[portal] ${where}: unexpected ${(err && err.name) || "error"}`);
      return json(500, { error: `Something went wrong on our side. Please try again, or call the office at ${OFFICE}.` });
    }
  };
}

export async function issueSession(user) {
  const { token } = await signSession(sessionSecret(), { username: user.username, role: user.role, sv: user.sessionVersion });
  return sessionCookie(token);
}

export { clearedCookie, secretProblem };

// ---------- the Netlify call behind each admin action, shown on the admin page ----------

export function netlifyCall(context, op, key) {
  const site = (context && context.site && context.site.id) || "<site-id>";
  const sdk = `getStore({ name: "${STORE_NAME}", consistency: "strong" })`;
  const base = `https://api.netlify.com/api/v1/blobs/${site}/site:${STORE_NAME}`;
  const auth = "Authorization: Bearer <Netlify token>";
  const k = JSON.stringify(key || "");
  const path = encodeURIComponent(key || "");
  switch (op) {
    case "list":
      return {
        sdk: `${sdk}.list()  then  .get(key, { type: "json" }) for each key`,
        rest: `GET ${base}  (${auth})  then  GET ${base}/<key> for each key`,
      };
    case "create-customer":
      return {
        sdk: `${sdk}.setJSON(${k}, { username: ${k}, accountNumber, displayName, company, email, role: "customer", active: true, mustChangePassword: true, passwordHash: "scrypt$...", createdBy, ... }, { onlyIfNew: true })`,
        rest: `PUT ${base}/${path}  (${auth}, If-None-Match: *)  body: the JSON record`,
      };
    case "create-admin":
      return {
        sdk: `${sdk}.setJSON(${k}, { username: ${k}, displayName, email, role: "admin", active: true, mustChangePassword: true, passwordHash: "scrypt$...", createdBy, ... }, { onlyIfNew: true })`,
        rest: `PUT ${base}/${path}  (${auth}, If-None-Match: *)  body: the JSON record`,
      };
    case "update":
      return {
        sdk: `${sdk}.getWithMetadata(${k}, { type: "json" })  then  .setJSON(${k}, { ...record, changes }, { onlyIfMatch: etag })`,
        rest: `GET ${base}/${path}  then  PUT ${base}/${path}  (${auth}, If-Match: "<etag>")  body: the JSON record`,
      };
    case "delete":
      return { sdk: `${sdk}.delete(${k})`, rest: `DELETE ${base}/${path}  (${auth})` };
    case "inspect":
      return {
        sdk: `${sdk}.list()  then  .get(key, { type: "text" }) for each key (sizes measured, password hashes left out)`,
        rest: `GET ${base}  (${auth})  then  GET ${base}/<key> for each key`,
      };
    default:
      return { sdk, rest: base };
  }
}
