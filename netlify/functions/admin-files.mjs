// Admin only: customer documents (9 Oct 2026). Kyle and Fay upload a report (a Field Service Report, a boiler report, a
// test sheet) or an invoice (a PDF, a courtesy copy only) to ONE customer login, from the admin page they already have.
// No new role, no new login.
//   GET    /api/admin/files?account=0001     that customer's documents, newest first (with who uploaded each and when)
//   POST   /api/admin/files                  upload one, multipart/form-data:
//            account   the customer's account number (their login)
//            type      "test-sheet" (shown as Report; the stored key is unchanged since 9 Oct) or "invoice"
//            date      YYYY-MM-DD (the document's own date)
//            title     optional, up to 120 characters
//            file      the PDF: sent as application/pdf, starts with %PDF-, at most 4 MB
//          answers with the document, the customer, and `notice`: the Chemtec branded "new document" email for Copy
//          notice email on the admin page (the portal never sends email)
//   GET    /api/admin/files/:owner/:id       open one as a PDF (any customer's)
//   DELETE /api/admin/files/:owner/:id       remove it: the PDF and its record
// Every POST and DELETE needs the site's own header (X-Requested-With: chemtec-portal) and an admin session. Uploads are
// limited to 60 an hour per admin and opens to 120 every 10 minutes per login. Each record keeps who uploaded it, when,
// the type, the size and the SHA-256 of the file; the function log has one line per upload and delete (never a file).
// Built by Apex Solved for Chemtec Products Company, 9 Oct 2026.

import { json, guarded, csrfProblem, requireUser, getUser, cleanAccountNumber, cleanText, publicUser } from "../lib/portal.mjs";
import {
  MAX_FILE_BYTES,
  MAX_FILE_LABEL,
  MAX_BODY_BYTES,
  TITLE_MAX,
  ID_RE,
  filesStore,
  newId,
  docKey,
  pdfKey,
  isPdf,
  cleanOwner,
  cleanType,
  cleanDate,
  sha256,
  newDocRecord,
  adminDoc,
  listDocs,
  getDoc,
  getPdf,
  deleteDoc,
  takeUploadSlot,
  takeOpenSlot,
  readBodyCapped,
  pdfHeaders,
  isNavigation,
  filesCall,
} from "../lib/files.mjs";
import { renderNoticeEmail } from "../lib/email-templates.mjs";

const NO_CUSTOMER = "There is no customer login with that account number.";
const TOO_BIG = `That file is over ${MAX_FILE_LABEL}, the most the website takes in one upload. Scan it again in black and white at 200 dpi, or save it as a smaller PDF, then upload it.`;

async function customerFor(raw) {
  const acct = cleanAccountNumber(raw);
  if (!acct) return null;
  const u = await getUser(acct.key);
  return u && u.role === "customer" ? u : null;
}

async function list(req) {
  const account = new URL(req.url).searchParams.get("account");
  const customer = await customerFor(account);
  if (!customer) return json(404, { field: "account", error: NO_CUSTOMER });
  const docs = await listDocs(customer.username, customer.createdAt);
  return json(200, {
    customer: publicUser(customer),
    documents: docs.map(adminDoc),
    maxFile: MAX_FILE_LABEL,
    call: filesCall("list", customer.username),
  });
}

async function upload(req, admin) {
  const type = (req.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("multipart/form-data")) return json(400, { error: "Please use the upload form on the admin page." });
  const body = await readBodyCapped(req, MAX_BODY_BYTES);
  if (body.tooBig) return json(413, { field: "file", error: TOO_BIG });

  let form;
  try {
    form = await new Response(body.bytes, { headers: { "content-type": req.headers.get("content-type") } }).formData();
  } catch {
    return json(400, { error: "Please use the upload form on the admin page." });
  }

  const customer = await customerFor(form.get("account"));
  if (!customer) return json(400, { field: "account", error: "Pick the customer this document is for." });
  const docType = cleanType(form.get("type"));
  if (!docType) return json(400, { field: "type", error: "Pick Invoice or Report." });
  const date = cleanDate(form.get("date"));
  if (!date) return json(400, { field: "date", error: "Check the date. Use the date on the document (1982 to next year)." });
  const title = cleanText(form.get("title"), TITLE_MAX);

  const file = form.get("file");
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") return json(400, { field: "file", error: "Choose the PDF to upload." });
  if (file.size > MAX_FILE_BYTES) return json(413, { field: "file", error: TOO_BIG });
  if (String(file.type || "").toLowerCase() !== "application/pdf") return json(415, { field: "file", error: "Only PDF files can be uploaded." });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) return json(413, { field: "file", error: TOO_BIG });
  if (!isPdf(bytes)) return json(415, { field: "file", error: "That file is not a PDF. Only PDF files can be uploaded." });

  const slot = await takeUploadSlot(admin.username);
  if (!slot.ok) {
    return json(429, { error: "That is the most uploads for one hour. Try again a little later." }, { "retry-after": String(slot.retryAfter || 60) });
  }

  const s = filesStore();
  const owner = customer.username;
  const id = newId();
  const rec = newDocRecord({
    id,
    owner,
    ownerSince: customer.createdAt,
    accountNumber: customer.accountNumber || owner,
    type: docType,
    date,
    title,
    size: bytes.byteLength,
    hash: sha256(bytes),
    originalName: file.name,
    uploadedBy: admin.username,
  });
  await s.set(pdfKey(owner, id), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
    metadata: { contentType: "application/pdf", size: bytes.byteLength },
  });
  try {
    const w = await s.setJSON(docKey(owner, id), rec, { onlyIfNew: true });
    if (w && w.modified === false) throw new Error("id taken");
  } catch (err) {
    await s.delete(pdfKey(owner, id)).catch(() => {});
    throw err;
  }
  console.log(`[portal] document uploaded: ${id} (${docType}, ${bytes.byteLength} bytes) for ${owner} by ${admin.username}`);

  const doc = adminDoc(rec);
  const cust = publicUser(customer);
  const notice = renderNoticeEmail({ type: docType, user: cust, doc });
  return json(201, {
    ok: true,
    document: doc,
    customer: { username: cust.username, loginName: cust.loginName, displayName: cust.displayName, company: cust.company, email: cust.email, active: cust.active },
    notice: { kind: notice.kind, subject: notice.subject, html: notice.html, pasteHtml: notice.pasteHtml, text: notice.text },
    call: filesCall("upload", owner, id),
  });
}

async function open(req, admin, owner, id) {
  const slot = await takeOpenSlot(admin.username);
  if (!slot.ok) return json(429, { error: "Too many documents opened in a short time. Wait a few minutes." }, { "retry-after": String(slot.retryAfter || 60) });
  const rec = await getDoc(owner, id);
  const bytes = rec ? await getPdf(owner, id) : null;
  if (!rec || !bytes || !isPdf(bytes)) {
    if (isNavigation(req)) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store, max-age=0" } });
    return json(404, { error: "That document is not there any more. Refresh the list." });
  }
  return new Response(bytes, { status: 200, headers: pdfHeaders(rec, bytes.byteLength) });
}

async function remove(admin, owner, id) {
  const rec = await getDoc(owner, id);
  if (!rec) return json(404, { error: "That document is not there any more. Refresh the list." });
  await deleteDoc(owner, id);
  console.log(`[portal] document deleted: ${id} (${rec.type}, ${rec.size} bytes, uploaded ${rec.uploadedAt} by ${rec.uploadedBy}) for ${owner} by ${admin.username}`);
  return json(200, { ok: true, deleted: id, owner, call: filesCall("delete", owner, id) });
}

export default guarded(async (req, context) => {
  const params = (context && context.params) || {};
  const method = req.method;

  if (method !== "GET" && csrfProblem(req)) return json(403, { error: "Please use the admin page on the site." });
  const r = await requireUser(req, { admin: true });
  if (r.error) {
    if (r.error.status === 401 && method === "GET" && isNavigation(req)) {
      return new Response(null, { status: 302, headers: { location: "/portal/login/?next=" + encodeURIComponent("/portal/admin/") + "&expired=1", "cache-control": "private, no-store, max-age=0" } });
    }
    return r.error;
  }
  const admin = r.user;

  if (params.id === undefined && params.owner === undefined) {
    if (method === "GET") return list(req);
    if (method === "POST") return upload(req, admin);
    return json(405, { error: "Method not allowed" }, { allow: "GET, POST" });
  }

  const owner = cleanOwner(params.owner);
  const id = ID_RE.test(String(params.id || "")) ? params.id : null;
  if (!owner || !id) return json(404, { error: "That document is not there any more. Refresh the list." });
  if (method === "GET") return open(req, admin, owner, id);
  if (method === "DELETE") return remove(admin, owner, id);
  return json(405, { error: "Method not allowed" }, { allow: "GET, DELETE" });
});

export const config = { path: ["/api/admin/files", "/api/admin/files/:owner/:id"] };

