// POST /api/change-password  { currentPassword, newPassword }
// Needed on the first log in (a temporary password) and any time after. Ends every other session of this
// login (the session version moves on) and gives this browser a fresh cookie. A wrong current password
// counts toward the same 10 try lock as the log in form, counted before the check (takeTry).
// Built by Apex Solved for Chemtec Products Company, 8 Oct 2026.

import {
  OFFICE,
  LOCK_MINUTES,
  PASSWORD_MAX,
  json,
  guarded,
  csrfProblem,
  readJson,
  requireUser,
  updateUser,
  hashPassword,
  verifyPassword,
  passwordProblem,
  takeTry,
  selfUser,
  issueSession,
} from "../lib/portal.mjs";

const LOCKED = { error: `Too many tries. Wait ${LOCK_MINUTES} minutes, or call the office at ${OFFICE}.`, locked: true };

export default guarded(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, { allow: "POST" });
  if (csrfProblem(req)) return json(403, { error: "Please use the form on the site." });
  const r = await requireUser(req, { allowMustChange: true });
  if (r.error) return r.error;
  const user = r.user;

  const body = await readJson(req);
  if (!body) return json(400, { error: "Please use the form on the site." });
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!current || current.length > PASSWORD_MAX) return json(400, { field: "currentPassword", error: "Your current password is not right." });

  const now = Date.now();
  const t = await takeTry(user.username, now);
  if (t.locked || t.busy) return json(429, LOCKED);
  if (t.missing) return json(401, { error: "Your session has ended. Please log in again.", loggedIn: false });
  if (!(await verifyPassword(current, t.user.passwordHash))) {
    if (t.last) return json(429, LOCKED);
    return json(400, { field: "currentPassword", error: "Your current password is not right." });
  }

  const problem = passwordProblem(next, user.username);
  const same = !problem && next === current;
  if (problem || same) {
    // the current password was right: give the try back
    await updateUser(user.username, (u) => {
      u.failedLogins = 0;
      u.lockedUntil = null;
      return u;
    });
    if (problem) return json(400, { field: "newPassword", error: problem });
    return json(400, { field: "newPassword", error: "Choose a password different from the current one." });
  }

  const passwordHash = await hashPassword(next);
  const updated = await updateUser(user.username, (u) => {
    if (u.sessionVersion !== r.session.sv || u.active !== true) return null; // logged out or turned off meanwhile
    u.passwordHash = passwordHash;
    u.mustChangePassword = false;
    u.failedLogins = 0;
    u.lockedUntil = null;
    u.sessionVersion = (Number(u.sessionVersion) || 1) + 1;
    u.updatedAt = new Date(now).toISOString();
    return u;
  });
  if (!updated || updated.passwordHash !== passwordHash) {
    return json(401, { error: "Your session has ended. Please log in again.", loggedIn: false });
  }

  return json(200, { ok: true, user: selfUser(updated) }, { "set-cookie": await issueSession(updated) });
});

export const config = { path: "/api/change-password" };
