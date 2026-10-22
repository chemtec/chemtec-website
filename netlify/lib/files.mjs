// Chemtec customer portal: customer documents (9 Oct 2026, Alex: "we are just uploading documents... to each user
// account"). Two types: a report (a Field Service Report, a boiler report, a test sheet) and an invoice (a PDF, a
// courtesy copy only: no balances, no statements, no QuickBooks).
// v1.2 (22 Oct 2026): the report type is still STORED as "test-sheet" (records already written keep working); only
// what people read changed: the label says Report and the file name says report. Each document belongs to ONE customer login. Only an admin uploads or
// deletes (from the admin page they already have); a customer sees and opens only their own. No new role, no new login.
//
//   the store   Netlify Blobs, store "portal-files" (site wide, strong consistency). Never served publicly: only the
//               portal's own functions read it, and only after checking the session.
//                 doc/<owner>/<id>        the record (JSON): type, date, title, size, who uploaded it and when, opens
//                 pdf/<owner>/<id>        the PDF itself
//                 rate/<what>-<username>  recent times only, for the upload and open limits
//               owner = the customer's login key (their account number in lowercase, as in "portal-users")
//               ownerSince = that login's createdAt, so an account number deleted and added again later never
//               sees the earlier customer's documents (they are hidden from the new login and cleaned up on delete)
//               id    = 32 random hex characters (128 bits from node:crypto), so an address cannot be guessed
//   the rules   PDF only: sent as application/pdf AND the file starts with %PDF-. At most 4 MB (Netlify Functions
//               buffer at most 6 MB per request and per answer, and base64 adds about a third, so about 4.5 MB of
//               real file fits; 4 MB keeps a margin). Uploads: 60 an hour per admin. Opens: 120 every 10 minutes per login.
//   the portal never sends email: after an upload the admin page offers Copy notice email (../lib/email-templates.mjs).
//
// Built by Apex Solved for Chemtec Products Company, 9 Oct 2026.

import { randomBytes, createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { USERNAME_RE } from "./session.mjs";

export const FILES_STORE = "portal-files";
export const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB: Netlify buffers 6 MB and base64 adds about a third
export const MAX_FILE_LABEL = "4 MB";
export const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024; // the file plus the form fields and the multipart wrapping
// the stored type key: its label (what people read)
export const TYPES = { "test-sheet": "Report", invoice: "Invoice" };
// the stored type key: the word in the file name a browser shows or saves
const FILE_WORDS = { "test-sheet": "report", invoice: "invoice" };
export const ID_RE = /^[a-f0-9]{32}$/;
export const TITLE_MAX = 120;
export const UPLOADS_PER_HOUR = 60;
export const OPENS_PER_WINDOW = 120;
export const OPEN_WINDOW_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function filesStore() {
  return getStore({ name: FILES_STORE, consistency: "strong" });
}

/** A new document id: 128 random bits as 32 lowercase hex characters. */
export function newId() {
  return randomBytes(16).toString("hex");
}

/** The owner part of a key: a stored login key (lowercase), or null. */
export function cleanOwner(raw) {
  const o = String(raw ?? "").trim().toLowerCase();
  return USERNAME_RE.test(o) ? o : null;
}

export const docKey = (owner, id) => `doc/${owner}/${id}`;
export const pdfKey = (owner, id) => `pdf/${owner}/${id}`;

/** True when these bytes start with the PDF header %PDF- (the magic bytes). */
export function isPdf(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  return b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
}

/** A document type ("test-sheet", shown as Report, or "invoice"), or null. */
export function cleanType(raw) {
  const t = String(raw ?? "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TYPES, t) ? t : null;
}

/** A real calendar date as YYYY-MM-DD, from 1982 (the year Chemtec started) to next year, or null. */
export function cleanDate(raw, now = new Date()) {
  const s = String(raw ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1982 || y > now.getUTCFullYear() + 1) return null;
  return s;
}

/** "2026-10-09" as "October 9, 2026" (fixed English month names, so every server and browser says the same). */
export function longDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return "";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** The file name a browser shows or saves: only letters, digits, dashes and the date, so it is safe in a header. */
export function safeFileName(type, date) {
  const t = FILE_WORDS[cleanType(type)] || "document";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : "undated";
  return `Chemtec-${t}-${d}.pdf`;
}

/** The name the file had on the admin's computer, cut down to plain characters (shown to admins only). */
export function cleanOriginalName(raw) {
  const s = String(raw ?? "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9 ._()-]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return s || "file.pdf";
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A new document record. Every upload says who, when, what type, how big. */
export function newDocRecord({ id, owner, ownerSince, accountNumber, type, date, title, size, hash, originalName, uploadedBy, now = new Date() }) {
  return {
    id,
    owner,
    ownerSince: ownerSince || null,
    accountNumber: accountNumber || owner,
    type,
    date,
    title,
    size,
    sha256: hash,
    contentType: "application/pdf",
    fileName: safeFileName(type, date),
    originalName: cleanOriginalName(originalName),
    uploadedAt: now.toISOString(),
    uploadedBy,
    opens: 0,
    firstOpenedAt: null,
    lastOpenedAt: null,
  };
}

function typeLabel(type) {
  return TYPES[type] || "Document";
}

/** What the customer sees about one of their documents: no admin names, no counters. */
export function customerDoc(rec) {
  return {
    id: rec.id,
    type: rec.type,
    typeLabel: typeLabel(rec.type),
    date: rec.date,
    dateLabel: longDate(rec.date),
    title: rec.title || "",
    size: Number(rec.size) || 0,
    uploadedAt: rec.uploadedAt || null,
    href: `/api/files/${rec.id}`,
  };
}

/** What an admin sees about a document. */
export function adminDoc(rec) {
  return {
    ...customerDoc(rec),
    owner: rec.owner,
    accountNumber: rec.accountNumber || rec.owner,
    fileName: safeFileName(rec.type, rec.date), // from the type and date, so records stored before v1.2 say report too
    originalName: rec.originalName || "",
    sha256: rec.sha256 || "",
    uploadedBy: rec.uploadedBy || "",
    opens: Number(rec.opens) || 0,
    firstOpenedAt: rec.firstOpenedAt || null,
    lastOpenedAt: rec.lastOpenedAt || null,
    href: `/api/admin/files/${encodeURIComponent(rec.owner)}/${rec.id}`,
  };
}

/** Newest first: the document's own date, then when it was uploaded. */
export function newestFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const x = a.uploadedAt || "";
  const y = b.uploadedAt || "";
  return x === y ? 0 : x < y ? 1 : -1;
}

/** Every document record for one owner, newest first. `since` = the login's createdAt (documents of an earlier
 * login with the same account number are left out). */
export async function listDocs(owner, since) {
  const o = cleanOwner(owner);
  if (!o) return [];
  const s = filesStore();
  const { blobs } = await s.list({ prefix: `doc/${o}/` });
  const out = [];
  for (let i = 0; i < blobs.length; i += 8) {
    const batch = await Promise.all(blobs.slice(i, i + 8).map((b) => s.get(b.key, { type: "json" }).catch(() => null)));
    for (const r of batch) if (r && typeof r === "object" && r.owner === o && ID_RE.test(r.id || "") && (since === undefined || r.ownerSince === since)) out.push(r);
  }
  return out.sort(newestFirst);
}

/** How many documents each owner has: { owner: count }. One list call, no reads. */
export async function countDocsByOwner() {
  const { blobs } = await filesStore().list({ prefix: "doc/" });
  const counts = {};
  for (const b of blobs) {
    const parts = String(b.key).split("/");
    if (parts.length === 3 && ID_RE.test(parts[2])) counts[parts[1]] = (counts[parts[1]] || 0) + 1;
  }
  return counts;
}

/** One record, or null. `since` as in listDocs. */
export async function getDoc(owner, id, since) {
  const o = cleanOwner(owner);
  if (!o || !ID_RE.test(String(id || ""))) return null;
  const rec = await filesStore().get(docKey(o, id), { type: "json" });
  return rec && typeof rec === "object" && rec.owner === o && rec.id === id && (since === undefined || rec.ownerSince === since) ? rec : null;
}

/** The PDF bytes, or null. */
export async function getPdf(owner, id) {
  const o = cleanOwner(owner);
  if (!o || !ID_RE.test(String(id || ""))) return null;
  const buf = await filesStore().get(pdfKey(o, id), { type: "arrayBuffer" });
  return buf ? new Uint8Array(buf) : null;
}

/** Remove one document: the PDF first, then its record (so no record ever outlives a removal half done). */
export async function deleteDoc(owner, id) {
  const s = filesStore();
  await s.delete(pdfKey(owner, id));
  await s.delete(docKey(owner, id));
}

/** Remove every document of one owner (when their login is deleted). Returns how many records went. */
export async function deleteAllDocs(owner) {
  const o = cleanOwner(owner);
  if (!o) return 0;
  const s = filesStore();
  const [docs, pdfs] = await Promise.all([s.list({ prefix: `doc/${o}/` }), s.list({ prefix: `pdf/${o}/` })]);
  // 8 at a time, so years of monthly reports still fit in one function run
  const keys = [...pdfs.blobs, ...docs.blobs].map((b) => b.key);
  for (let i = 0; i < keys.length; i += 8) await Promise.all(keys.slice(i, i + 8).map((k) => s.delete(k)));
  return docs.blobs.length;
}

/**
 * Count one customer open on the record (best effort: an open is never refused because this write failed).
 * Conditional on the record's etag, so a document deleted at the same moment is not written back.
 */
export async function recordOpen(owner, id, now = new Date()) {
  const s = filesStore();
  const key = docKey(owner, id);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await s.getWithMetadata(key, { type: "json" });
      if (!cur || !cur.data) return;
      const rec = cur.data;
      rec.opens = (Number(rec.opens) || 0) + 1;
      rec.firstOpenedAt = rec.firstOpenedAt || now.toISOString();
      rec.lastOpenedAt = now.toISOString();
      const w = cur.etag ? await s.setJSON(key, rec, { onlyIfMatch: cur.etag }) : await s.setJSON(key, rec);
      if (!w || w.modified !== false) return;
    }
  } catch (err) {
    console.error(`[portal] could not count an open (${(err && err.name) || "error"})`);
  }
}

/**
 * Take one slot of a rate limit BEFORE the action: at most `limit` in any `windowMs`. The recent times live in the
 * store under rate/<what>-<username>, written conditionally on the etag (on Netlify), so two requests at the same
 * moment cannot both take the last slot. Returns { ok: true } or { ok: false, retryAfter, busy? }.
 */
export async function takeSlot(what, username, limit, windowMs, now = Date.now()) {
  const s = filesStore();
  const key = `rate/${what}-${String(username || "unknown").replace(/[^a-z0-9._-]/g, "_")}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await s.getWithMetadata(key, { type: "json" });
    const old = cur && cur.data && Array.isArray(cur.data.times) ? cur.data.times : [];
    const recent = old.filter((t) => Number.isFinite(t) && t > now - windowMs && t <= now + 60 * 1000).sort((a, b) => a - b);
    if (recent.length >= limit) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
    }
    recent.push(now);
    const next = { times: recent, updatedAt: new Date(now).toISOString() };
    let w;
    if (!cur) w = await s.setJSON(key, next, { onlyIfNew: true });
    else if (cur.etag) w = await s.setJSON(key, next, { onlyIfMatch: cur.etag });
    else w = await s.setJSON(key, next); // the netlify dev emulator gives no etag
    if (!w || w.modified !== false) return { ok: true };
  }
  return { ok: false, busy: true, retryAfter: 5 };
}

export const takeUploadSlot = (admin, now) => takeSlot("upload", admin, UPLOADS_PER_HOUR, HOUR_MS, now);
export const takeOpenSlot = (username, now) => takeSlot("open", username, OPENS_PER_WINDOW, OPEN_WINDOW_MS, now);

/**
 * The request body, read up to `max` bytes and no further. { bytes } or { tooBig: true }.
 * Netlify itself stops at 6 MB (base64 included); this keeps the same limit everywhere else too (netlify dev, tests).
 */
export async function readBodyCapped(req, max = MAX_BODY_BYTES) {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return { tooBig: true };
  if (!req.body) return { bytes: new Uint8Array(0) };
  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try {
        await reader.cancel();
      } catch {
        /* nothing to do */
      }
      return { tooBig: true };
    }
    chunks.push(value);
  }
  return { bytes: Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))) };
}

/** The headers every PDF answer carries. */
export function pdfHeaders(rec, size) {
  return {
    "content-type": "application/pdf",
    "content-disposition": `inline; filename="${safeFileName(rec.type, rec.date)}"`,
    "content-length": String(size),
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store, max-age=0",
    "x-robots-tag": "noindex",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-origin",
  };
}

/** A navigation (someone opened the link in a tab), rather than the page's own script asking for JSON. */
export function isNavigation(req) {
  const mode = req.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return /text\/html/i.test(req.headers.get("accept") || "");
}

/** The Netlify Blobs calls behind each documents action, for the admin page's "What you did this session". */
export function filesCall(op, owner, id) {
  const sdk = `getStore({ name: "${FILES_STORE}", consistency: "strong" })`;
  const base = `https://api.netlify.com/api/v1/blobs/<site-id>/site:${FILES_STORE}`;
  const auth = "Authorization: Bearer <Netlify token>";
  const d = `doc/${owner || "<account>"}/${id || "<id>"}`;
  const p = `pdf/${owner || "<account>"}/${id || "<id>"}`;
  switch (op) {
    case "list":
      return {
        sdk: `${sdk}.list({ prefix: "doc/${owner || "<account>"}/" })  then  .get(key, { type: "json" }) for each key`,
        rest: `GET ${base}?prefix=doc/${owner || "<account>"}/  (${auth})  then  GET ${base}/<key> for each key`,
      };
    case "upload":
      return {
        sdk: `${sdk}.set("${p}", <the PDF bytes>)  then  .setJSON("${d}", { type, date, title, size, sha256, uploadedBy, uploadedAt, ... }, { onlyIfNew: true })`,
        rest: `PUT ${base}/${p}  then  PUT ${base}/${d}  (${auth}, If-None-Match: *)  body: the JSON record`,
      };
    case "delete":
      return { sdk: `${sdk}.delete("${p}")  then  .delete("${d}")`, rest: `DELETE ${base}/${p}  then  DELETE ${base}/${d}  (${auth})` };
    default:
      return { sdk, rest: base };
  }
}
