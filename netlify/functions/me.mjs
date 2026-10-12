// GET /api/me  who is logged in on this browser. Always 200, so a logged out visitor is not an error.
// Only what the person may see about their own login (selfUser): never who added them or their counters.
// Built by Apex Solved for Chemtec Products Company, 8 Oct 2026.

import { json, guarded, requireUser, selfUser, sessionSecret, secretProblem } from "../lib/portal.mjs";

export default guarded(async (req) => {
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, { allow: "GET" });
  if (secretProblem(sessionSecret())) return json(200, { loggedIn: false, setup: false });
  const r = await requireUser(req, { allowMustChange: true });
  if (r.error) {
    const headers = {};
    const sc = r.error.headers.get("set-cookie");
    if (sc) headers["set-cookie"] = sc;
    return json(200, { loggedIn: false, setup: true }, headers);
  }
  return json(200, { loggedIn: true, setup: true, user: selfUser(r.user) });
});

export const config = { path: "/api/me" };
