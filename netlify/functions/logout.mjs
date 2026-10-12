// POST /api/logout  ends the session: clears the cookie in this browser and moves the login's session version on,
// so a copy of the old cookie (another tab, another device) stops working too.
// Built by Apex Solved for Chemtec Products Company, 8 Oct 2026.

import { json, guarded, csrfProblem, clearedCookie, readSession, updateUser } from "../lib/portal.mjs";

export default guarded(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, { allow: "POST" });
  if (csrfProblem(req)) return json(403, { error: "Please use the Log out button on the site." });
  const session = await readSession(req);
  if (session) {
    try {
      await updateUser(session.username, (u) => {
        if (u.sessionVersion !== session.sv) return null; // already ended
        u.sessionVersion = (Number(u.sessionVersion) || 1) + 1;
        return u;
      });
    } catch (err) {
      console.error(`[portal] logout: could not end the session in the store (${err && err.name})`);
    }
  }
  return json(200, { ok: true, loggedIn: false }, { "set-cookie": clearedCookie() });
});

export const config = { path: "/api/logout" };
