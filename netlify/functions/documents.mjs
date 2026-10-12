// GET /api/documents  the SDS, manuals and bulletins list, for logged in customers only.
// The PDFs themselves are guarded by the edge function netlify/edge-functions/portal-gate.mjs.
// Built by Apex Solved for Chemtec Products Company, 8 Oct 2026.

import { json, guarded, requireUser } from "../lib/portal.mjs";
import { DOCUMENT_GROUPS } from "../lib/documents.mjs";

export default guarded(async (req) => {
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, { allow: "GET" });
  const r = await requireUser(req);
  if (r.error) return r.error;
  return json(200, { groups: DOCUMENT_GROUPS });
});

export const config = { path: "/api/documents" };
