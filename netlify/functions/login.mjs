// POST /api/login  { username, password }   (username = the account number, or an admin's username)
// Checks the password against the scrypt hash in the "portal-users" store and sets the signed session cookie.
// Each try is counted BEFORE the password is checked (takeTry in ../lib/portal.mjs), so 10 tries in a row,
// even sent all at once, lock that login for 15 minutes. The first admin is created here, from the Netlify
// environment variables ADMIN_USERNAME and ADMIN_PASSWORD, only while the store holds no active admin.
// Built by Apex Solved for Chemtec Products Company, 8 Oct 2026.

import {
  OFFICE,
  LOCK_MINUTES,
  PASSWORD_MAX,
  PASSWORD_MIN,
  json,
  guarded,
  csrfProblem,
  readJson,
  sessionSecret,
  secretProblem,
  NOT_SET_UP,
  cleanUsername,
  cleanAdminUsername,
  getUser,
  updateUser,
  activeAdminCount,
  store,
  hashPassword,
  verifyPassword,
  sameString,
  newUserRecord,
  takeTry,
  selfUser,
  issueSession,
} from "../lib/portal.mjs";

const NO_MATCH = { error: "That account number and password do not match. Check both and try again." };
const LOCKED = {
  error: `This login is locked for ${LOCK_MINUTES} minutes after too many tries. Try again later, or call the office at ${OFFICE}.`,
  locked: true,
};
const BUSY = { error: "Too many tries at the same moment. Wait a minute and try again.", locked: true };

function retryAfter(until, now) {
  const secs = Math.max(1, Math.ceil(((Date.parse(until) || now) - now) / 1000));
  return { "retry-after": String(Math.min(secs, LOCK_MINUTES * 60)) };
}

// The very first admin, from the environment, only while no admin is turned on (also the way back in if
// that ever goes wrong: set ADMIN_USERNAME to a new name and ADMIN_PASSWORD in Netlify, then log in).
async function bootstrapAdmin(username, password) {
  const envUser = cleanAdminUsername(process.env.ADMIN_USERNAME);
  const envPass = String(process.env.ADMIN_PASSWORD || "");
  if (!envUser || envUser !== username || envPass.length < PASSWORD_MIN) return null;
  if (!sameString(password, envPass)) return null;
  if ((await activeAdminCount()) > 0) return null;
  const rec = newUserRecord({
    username,
    displayName: "Chemtec admin",
    company: "Chemtec Products Company",
    email: "",
    role: "admin",
    passwordHash: await hashPassword(password),
    createdBy: "first admin, from ADMIN_USERNAME",
  });
  await store().setJSON(username, rec, { onlyIfNew: true });
  console.log(`[portal] first admin created: ${username}`);
  return getUser(username);
}

export default guarded(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, { allow: "POST" });
  if (csrfProblem(req)) return json(403, { error: "Please use the log in form on the site." });
  if (secretProblem(sessionSecret())) return json(503, NOT_SET_UP);

  const body = await readJson(req);
  if (!body) return json(400, { error: "Please use the log in form on the site." });
  const username = cleanUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password || password.length > PASSWORD_MAX) {
    await verifyPassword(password.slice(0, PASSWORD_MAX), null); // same time as a real check
    return json(401, NO_MATCH);
  }

  let user = await getUser(username);
  if (!user) user = await bootstrapAdmin(username, password);
  if (!user) {
    await verifyPassword(password, null);
    return json(401, NO_MATCH);
  }

  const now = Date.now();
  const t = await takeTry(username, now);
  if (t.locked) return json(429, LOCKED, retryAfter(t.until, now));
  if (t.busy) return json(429, BUSY, { "retry-after": "60" });
  if (t.missing) {
    await verifyPassword(password, null);
    return json(401, NO_MATCH);
  }

  if (!(await verifyPassword(password, t.user.passwordHash))) {
    if (t.last) {
      console.log(`[portal] login locked for ${LOCK_MINUTES} minutes: ${username}`);
      return json(429, LOCKED, retryAfter(t.user.lockedUntil, now));
    }
    return json(401, NO_MATCH);
  }

  if (t.user.active !== true) {
    return json(403, { error: `This login is turned off. Please call the office at ${OFFICE}.`, disabled: true });
  }

  const updated = await updateUser(username, (u) => {
    u.failedLogins = 0;
    u.lockedUntil = null;
    u.lastLoginAt = new Date(now).toISOString();
    if (!Number.isInteger(u.sessionVersion)) u.sessionVersion = 1;
    return u;
  });
  if (!updated || updated.active !== true) return json(401, NO_MATCH);

  return json(
    200,
    { ok: true, user: selfUser(updated), mustChangePassword: updated.mustChangePassword === true },
    { "set-cookie": await issueSession(updated) }
  );
});

export const config = { path: "/api/login" };
