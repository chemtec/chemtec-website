// Chemtec customer portal: the signed session cookie, shared by the Netlify Functions (Node)
// and the edge function that guards the documents (Deno). Web Crypto only, so it runs in both.
//
// Cookie value: v1.<payload>.<signature>
//   payload    base64url JSON { u: username, r: role, sv: session version, iat, exp } (seconds)
//   signature  base64url HMAC SHA-256 of "v1.<payload>" with the Netlify environment variable SESSION_SECRET
// Nothing secret is in the cookie: it says who you are, the signature proves the site issued it.
// Every function, and the edge function, still re-reads the user record, so turning a login off,
// resetting its password or deleting it ends its sessions at once (the session version changes).
//
// Built by Apex Solved for Chemtec Products Company, 8 Oct 2026.

export const COOKIE_NAME = "__Host-chemtec_session";
export const SESSION_SECONDS = 8 * 60 * 60; // 8 hours
// Usernames (8 Oct 2026, Alex): a customer's username IS their account number, exactly as the admin typed it
// (letters, digits, dash and dot, 1 to 20 characters, for example 0001 or C-1024). Admins have their own
// username (3 to 40 characters: lowercase letters, digits, dot, dash, underscore, for example a first name).
// Every record is stored under the lowercase form, so "C-1024" and "c-1024" are the same login.
export const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/; // as typed
export const ADMIN_USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/; // any stored key (lowercase), customer or admin
const ROLES = new Set(["customer", "admin"]);

const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error("Web Crypto is not available");
  return c.subtle;
}

function toB64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str) {
  if (typeof str !== "string" || !/^[A-Za-z0-9_-]*$/.test(str)) return null;
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Why the secret cannot be used, or null when it is fine. Never returns or logs the value. */
export function secretProblem(secret) {
  if (typeof secret !== "string" || secret.length < 32) return "SESSION_SECRET is missing or shorter than 32 characters";
  return null;
}

let cachedKey = null;
let cachedFor = null;
async function hmacKey(secret) {
  if (cachedKey && cachedFor === secret) return cachedKey;
  cachedKey = await subtle().importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  cachedFor = secret;
  return cachedKey;
}

/** A new signed token for this user. */
export async function signSession(secret, { username, role, sv }, nowMs = Date.now()) {
  const problem = secretProblem(secret);
  if (problem) throw new Error(problem);
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + SESSION_SECONDS;
  const payload = toB64url(enc.encode(JSON.stringify({ u: username, r: role, sv, iat, exp })));
  const data = "v1." + payload;
  const sig = new Uint8Array(await subtle().sign("HMAC", await hmacKey(secret), enc.encode(data)));
  return { token: data + "." + toB64url(sig), exp };
}

/** The session inside a token, or null when it is missing, forged, tampered with or expired. */
export async function verifySession(secret, token, nowMs = Date.now()) {
  if (secretProblem(secret) || typeof token !== "string" || token.length < 10 || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const sig = fromB64url(parts[2]);
  if (!sig || sig.length !== 32) return null;
  // subtle.verify compares in constant time
  const ok = await subtle().verify("HMAC", await hmacKey(secret), sig, enc.encode(parts[0] + "." + parts[1]));
  if (!ok) return null;
  const raw = fromB64url(parts[1]);
  if (!raw) return null;
  let p;
  try {
    p = JSON.parse(dec.decode(raw));
  } catch {
    return null;
  }
  if (!p || typeof p !== "object") return null;
  if (typeof p.u !== "string" || !USERNAME_RE.test(p.u)) return null;
  if (!ROLES.has(p.r)) return null;
  if (!Number.isInteger(p.sv) || !Number.isInteger(p.iat) || !Number.isInteger(p.exp)) return null;
  const now = Math.floor(nowMs / 1000);
  if (p.iat > now + 300 || p.exp <= now || p.exp - p.iat > SESSION_SECONDS) return null;
  return { username: p.u, role: p.r, sv: p.sv, iat: p.iat, exp: p.exp };
}

/** One cookie's value from a Cookie header, or "" when it is not there. */
export function readCookie(header, name = COOKIE_NAME) {
  if (typeof header !== "string" || !header) return "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

export function clearedCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/**
 * A request path made comparable, so case, percent encoding (also double encoded), backslashes,
 * double slashes and dot segments cannot slip a protected file past the gate.
 * Lowercased: use it to DECIDE, never to build a link (file names keep their case).
 */
export function normalizePath(pathname) {
  let p = String(pathname || "/");
  for (let i = 0; i < 5; i++) {
    let d;
    try {
      d = decodeURIComponent(p);
    } catch {
      // a stray % that is not an escape: keep it literal and decode the rest
      try {
        d = decodeURIComponent(p.replace(/%(?![0-9a-fA-F]{2})/g, "%25"));
      } catch {
        break;
      }
    }
    if (d === p) break;
    p = d;
  }
  p = p.replace(/\\/g, "/").replace(/[\u0000-\u001f\u007f]/g, "").toLowerCase();
  const out = [];
  for (const raw of p.split("/")) {
    if (raw === "" || raw === ".") continue;
    if (raw === "..") {
      out.pop();
      continue;
    }
    const seg = raw.split(";")[0].replace(/[\s.]+$/, ""); // drop ;params, and "x.pdf. " is "x.pdf"
    if (seg) out.push(seg);
  }
  let n = "/" + out.join("/");
  if (/\/\s*$/.test(p) && n !== "/") n += "/";
  return n;
}

// Files that are in the deploy folder but are never for the public web, matched on the normalised (lowercase)
// path so a changed case cannot reach them: the code, the package files, the Netlify config, notes, backups,
// and any dotfile (.env, .gitignore). /.netlify/ (Netlify's own routes) and /.well-known/ are left alone.
const HIDDEN = [
  /^\/netlify(\/|$)/,
  /^\/node_modules(\/|$)/,
  /^\/(package|package-lock)\.json$/,
  /^\/(netlify\.toml|deno\.lock|deno\.json)$/,
  /\.(md|mjs|cjs|ts|toml|lock|bak|env|log)$/,
  /\.bak[^/]*$/,
  /(^|\/)\.(?!netlify(\/|$)|well-known(\/|$))/,
];

/** What the gate does with a path: "hidden" (404), "doc" (a protected file), "documents" (the old public page), "admin", or null. */
export function classifyPath(normalized) {
  const n = normalized;
  if (HIDDEN.some((re) => re.test(n))) return "hidden";
  if (n.includes(".pdf") || n === "/assets/docs" || n.startsWith("/assets/docs/")) return "doc";
  if (n === "/documents" || n.startsWith("/documents/") || n.startsWith("/documents.")) return "documents";
  if (n === "/portal/admin" || n.startsWith("/portal/admin/") || n.startsWith("/portal/admin.")) return "admin";
  return null;
}

/** A "next" address the login page may send people to: this site only, a plain path, no tricks. */
export function safeNext(raw, fallback = "/portal/") {
  const s = String(raw ?? "");
  if (s.length > 300) return fallback;
  if (!/^\/(?![\/\\])[A-Za-z0-9\-._~\/%]*(\?[A-Za-z0-9\-._~=&%]*)?(#[A-Za-z0-9\-_]*)?$/.test(s)) return fallback;
  if (/(^|\/)\.\.?(\/|$)/.test(s) || /%2e|%2f|%5c/i.test(s)) return fallback;
  return s;
}
