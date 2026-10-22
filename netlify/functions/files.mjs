// The logged in customer's own documents (9 Oct 2026): invoices and reports an admin uploaded for their login.
//   GET /api/files        their documents, newest first (type, date, title, size, the open link)
//   GET /api/files/:id    open one as a PDF, inline in the browser
// The owner is ALWAYS the logged in login itself: nothing in the request can name another customer, so another
// customer's document id answers 404 here. Opens are limited (120 every 10 minutes per login) and counted on the
// document's record for the admins. The PDF answer: Content-Type application/pdf, Content-Disposition inline with a
// safe file name, X-Content-Type-Options nosniff, Cache-Control private, no-store.
// Admins open documents through /api/admin/files/:owner/:id (../functions/admin-files.mjs).
// Built by Apex Solved for Chemtec Products Company, 9 Oct 2026.

import { json, guarded, requireUser, OFFICE } from "../lib/portal.mjs";
import { ID_RE, listDocs, getDoc, getPdf, isPdf, customerDoc, pdfHeaders, takeOpenSlot, recordOpen, isNavigation, MAX_FILE_LABEL } from "../lib/files.mjs";

const NOT_HERE = `This document is not in your portal. Go back to the portal, or call the office at ${OFFICE}.`;

/** A plain answer for someone who opened a link in a tab; JSON for the page's own script. */
function answer(req, status, message, extra = {}) {
  if (isNavigation(req)) {
    return new Response(message, {
      status,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex", "x-content-type-options": "nosniff", ...extra },
    });
  }
  return json(status, { error: message }, extra);
}

export default guarded(async (req, context) => {
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, { allow: "GET" });
  const r = await requireUser(req);
  if (r.error) {
    // a tab opened from the portal after the session ended (or before the first password change): to the right page,
    // then back to the portal's Your documents
    if ((r.error.status === 401 || r.error.status === 403) && isNavigation(req)) {
      const back = encodeURIComponent("/portal/#your-documents");
      const location = r.error.status === 401 ? `/portal/login/?next=${back}&expired=1` : `/portal/change-password/?next=${back}`;
      const headers = new Headers({ location, "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex" });
      const sc = r.error.headers.get("set-cookie");
      if (sc) headers.set("set-cookie", sc);
      return new Response(null, { status: 302, headers });
    }
    return r.error;
  }
  const user = r.user;
  const id = context && context.params ? context.params.id : undefined;

  if (id === undefined) {
    if (user.role !== "customer") return json(200, { documents: [], admin: true, maxFile: MAX_FILE_LABEL });
    const docs = await listDocs(user.username, user.createdAt);
    return json(200, { documents: docs.map(customerDoc) });
  }

  if (!ID_RE.test(String(id))) return answer(req, 404, NOT_HERE);
  const slot = await takeOpenSlot(user.username);
  if (!slot.ok) {
    return answer(req, 429, "Too many documents opened in a short time. Wait a few minutes and try again.", { "retry-after": String(slot.retryAfter || 60) });
  }
  const rec = await getDoc(user.username, id, user.createdAt); // only ever this login's own documents
  if (!rec) return answer(req, 404, NOT_HERE);
  const bytes = await getPdf(user.username, id);
  if (!bytes || !isPdf(bytes)) {
    console.error(`[portal] document ${id} for ${user.username}: the PDF is missing or not a PDF`);
    return answer(req, 404, NOT_HERE);
  }
  if (user.role === "customer") await recordOpen(user.username, id);
  return new Response(bytes, { status: 200, headers: pdfHeaders(rec, bytes.byteLength) });
});

export const config = { path: ["/api/files", "/api/files/:id"] };
