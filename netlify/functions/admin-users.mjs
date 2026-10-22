// Admin only: the logins in the "portal-users" store.
//   GET    /api/admin/users                      every login (never a password hash)
//   POST   /api/admin/users                      add a login
//            a customer: { role: "customer", displayName, email, accountNumber, company?, password? }
//                        the username IS the account number, exactly as typed (stored under its lowercase form)
//            an admin:   { role: "admin", username, displayName, email, password? }
//   POST   /api/admin/users/:username/reset      new temporary password { password? }
//   POST   /api/admin/users/:username/disable    turn the login off (its sessions end at once)
//   POST   /api/admin/users/:username/enable     turn it back on (also clears a lock)
//   POST   /api/admin/users/:username/email      send the branded login email again { password, kind? }: only while
//                                                the login still has its temporary password, and only that password
//   DELETE /api/admin/users/:username            remove the record
// Rules: an admin cannot reset, turn off or delete their own login here (they use Change password), and the
// last active admin can never be turned off or deleted (checked before the change, and again after it, so two
// admins turning each other off at the same moment cannot leave none: the later change is undone). A new temporary password goes back in the response ONCE,
// for the admin to pass on; it is never stored in plain text or logged. The person chooses their own password at
// their first log in. Every answer carries `call`: the exact Netlify Blobs call behind it, for the admin page.
// Branded email (8 Oct 2026): adding a login or resetting a password also answers with `email` (the Chemtec branded
// email, rendered for this login: subject, html, pasteHtml, text) for Copy branded email and the preview, and with
// `emailSend`, the outcome of the automatic send. With { sendEmail: true } and RESEND_API_KEY set, the SAME request
// sends it through Resend (../lib/mailer.mjs); without the key nothing is sent and emailSend says so.
// Documents (9 Oct 2026): the list gives each customer's document count (`documents`), and deleting a customer's login
// also removes their documents (../lib/files.mjs), so an account number added again later never sees old files.
// Built by Apex Solved for Chemtec Products Company, 8 Oct 2026.

import {
  json,
  guarded,
  csrfProblem,
  readJson,
  requireUser,
  store,
  getUser,
  updateUser,
  listUsers,
  activeAdminCount,
  cleanUsername,
  cleanAccountNumber,
  cleanAdminUsername,
  cleanText,
  cleanEmail,
  hashPassword,
  passwordProblem,
  temporaryPassword,
  newUserRecord,
  publicUser,
  loginName,
  netlifyCall,
  verifyPassword,
  PASSWORD_MAX,
} from "../lib/portal.mjs";
import { renderLoginEmail, kindFor } from "../lib/email-templates.mjs";
import { sendLoginEmail, mailConfigured, MAIL_NOT_SET_UP } from "../lib/mailer.mjs";
import { countDocsByOwner, deleteAllDocs } from "../lib/files.mjs";

const LAST_ADMIN = { error: "This is the last active admin. Add another admin first." };

/** What the admin page needs to know about automatic email (never a value). */
function mailState() {
  return { configured: mailConfigured() };
}

/** The rendered email as the admin page gets it (once, in the same answer as the temporary password). */
function forPage(email) {
  return { kind: email.kind, subject: email.subject, html: email.html, pasteHtml: email.pasteHtml, text: email.text };
}

/** Send now if the admin ticked "Email the login now"; otherwise say why nothing was sent. */
async function sendIfAsked(body, email, rec, admin) {
  if (body.sendEmail !== true) {
    return mailConfigured()
      ? { status: "not-requested", sent: false, message: "" }
      : { status: "not-configured", sent: false, message: MAIL_NOT_SET_UP };
  }
  return sendLoginEmail({ email, user: rec, admin });
}

async function list(context) {
  const all = await listUsers();
  let counts = null;
  try {
    counts = await countDocsByOwner();
  } catch (err) {
    console.error(`[portal] could not count documents (${(err && err.name) || "error"})`); // the logins still list
  }
  const users = all
    .map((r) => publicUser(r.data))
    .filter(Boolean)
    .map((u) => (u.role === "customer" && counts ? { ...u, documents: counts[u.username] || 0 } : u))
    .sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username, "en", { numeric: true }) : a.role === "admin" ? -1 : 1));
  return json(200, { users, mail: mailState(), call: netlifyCall(context, "list") });
}

/** The password the admin typed, or a new strong one. { password } or { error: Response }. */
function choosePassword(body, username) {
  const typed = typeof body.password === "string" && body.password.length > 0;
  if (!typed) return { password: temporaryPassword(), typed: false };
  const problem = passwordProblem(body.password, username);
  if (problem) return { error: json(400, { field: "password", error: problem }) };
  return { password: body.password, typed: true };
}

async function create(req, context, admin) {
  const body = await readJson(req);
  if (!body) return json(400, { error: "Please use the form on the page." });
  const role = String(body.role || "customer");
  if (role !== "customer" && role !== "admin") return json(400, { field: "role", error: "Pick a customer or an admin." });

  const displayName = cleanText(body.displayName, 80);
  if (displayName.length < 2) return json(400, { field: "displayName", error: "Enter the person's name." });
  const email = cleanEmail(body.email);
  if (!email) return json(400, { field: "email", error: "Enter an email address, for example name@company.com." });

  let username, accountNumber, company;
  if (role === "customer") {
    const acct = cleanAccountNumber(body.accountNumber);
    if (!acct) {
      return json(400, {
        field: "accountNumber",
        error: "Account numbers are 1 to 20 characters: letters, numbers, dashes and dots, starting with a letter or number. For example 0001 or C-1024.",
      });
    }
    username = acct.key;
    accountNumber = acct.typed;
    company = cleanText(body.company, 120);
  } else {
    username = cleanAdminUsername(body.username);
    if (!username) {
      return json(400, {
        field: "username",
        error: "Admin usernames are 3 to 40 characters: lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number. A first name works.",
      });
    }
    accountNumber = "";
    company = "Chemtec Products Company";
  }

  const pw = choosePassword(body, username);
  if (pw.error) return pw.error;

  const taken = role === "customer" ? `Account number ${accountNumber} already has a login.` : `The username ${username} is already in use.`;
  if (await getUser(username)) return json(409, { field: role === "customer" ? "accountNumber" : "username", error: taken });

  const rec = newUserRecord({
    username,
    accountNumber,
    displayName,
    company,
    email,
    role,
    passwordHash: await hashPassword(pw.password),
    createdBy: admin.username,
  });
  const w = await store().setJSON(username, rec, { onlyIfNew: true });
  if (w && w.modified === false) return json(409, { field: role === "customer" ? "accountNumber" : "username", error: taken });

  console.log(`[portal] login added: ${username} (${role}) by ${admin.username}`);
  const user = publicUser(rec);
  const branded = renderLoginEmail({ kind: kindFor(rec, false), user, password: pw.password });
  const emailSend = await sendIfAsked(body, branded, rec, admin);
  return json(201, {
    ok: true,
    user,
    temporaryPassword: pw.password, // shown once to this admin; never stored in plain text
    typedPassword: pw.typed,
    email: forPage(branded), // the branded email, password inside, for this answer only
    emailSend,
    mail: mailState(),
    call: netlifyCall(context, role === "customer" ? "create-customer" : "create-admin", username),
  });
}

async function act(req, context, admin, username, action) {
  const target = await getUser(username);
  if (!target) return json(404, { error: "There is no login with that account number or username." });
  const self = username === admin.username;
  const now = new Date().toISOString();

  if (action === "reset") {
    if (self) return json(400, { error: "To change your own password, use Change password." });
    const body = (await readJson(req)) || {};
    const pw = choosePassword(body, username);
    if (pw.error) return pw.error;
    const passwordHash = await hashPassword(pw.password);
    const updated = await updateUser(username, (u) => {
      u.passwordHash = passwordHash;
      u.mustChangePassword = true;
      u.failedLogins = 0;
      u.lockedUntil = null;
      u.sessionVersion = (Number(u.sessionVersion) || 1) + 1; // old sessions end
      u.updatedAt = now;
      return u;
    });
    if (!updated) return json(404, { error: "There is no login with that account number or username." });
    console.log(`[portal] password reset: ${username} by ${admin.username}`);
    const user = publicUser(updated);
    const branded = renderLoginEmail({ kind: kindFor(updated, true), user, password: pw.password });
    const emailSend = await sendIfAsked(body, branded, updated, admin);
    return json(200, {
      ok: true,
      user,
      temporaryPassword: pw.password, // shown once to this admin; never stored in plain text
      typedPassword: pw.typed,
      email: forPage(branded),
      emailSend,
      mail: mailState(),
      call: netlifyCall(context, "update", username),
    });
  }

  if (action === "email") {
    // Send (again) from the one time panel. The browser still holds the temporary password it was shown; it is
    // checked against the stored hash, so only the real current temporary password can go out, in the fixed template.
    if (self) return json(400, { error: "To change your own password, use Change password." });
    if (!mailConfigured()) return json(409, { error: MAIL_NOT_SET_UP, emailSend: { status: "not-configured", sent: false, message: MAIL_NOT_SET_UP } });
    const body = (await readJson(req)) || {};
    if (target.active !== true) return json(400, { error: "This login is turned off. Turn it on first." });
    if (target.mustChangePassword !== true) {
      return json(400, { error: "They already chose their own password, so there is no temporary password to send. Reset the password to send a new one." });
    }
    const typed = typeof body.password === "string" ? body.password : "";
    if (!typed || typed.length > PASSWORD_MAX || !(await verifyPassword(typed, target.passwordHash))) {
      return json(400, { error: "That is not the temporary password on this login now. Reset the password to make a new one." });
    }
    const kind = body.kind === "reset" ? "password-reset" : kindFor(target, false);
    const branded = renderLoginEmail({ kind, user: publicUser(target), password: typed });
    const emailSend = await sendLoginEmail({ email: branded, user: target, admin });
    if (emailSend.sent) return json(200, { ok: true, emailSend });
    const status = emailSend.status === "rate-limited" || emailSend.status === "busy" ? 429 : emailSend.status === "failed" ? 502 : 400;
    return json(status, { error: emailSend.message, emailSend });
  }

  if (action === "disable") {
    if (self) return json(400, { error: "You cannot turn off your own login." });
    if (target.role === "admin" && target.active === true && (await activeAdminCount()) <= 1) return json(400, LAST_ADMIN);
    const updated = await updateUser(username, (u) => {
      u.active = false;
      u.sessionVersion = (Number(u.sessionVersion) || 1) + 1; // logged in browsers are logged out
      u.updatedAt = now;
      return u;
    });
    if (!updated) return json(404, { error: "There is no login with that account number or username." });
    if (updated.role === "admin" && (await activeAdminCount()) < 1) {
      // another admin was turned off at the same moment: undo this one so an admin is always on
      await updateUser(username, (u) => {
        u.active = true;
        u.updatedAt = new Date().toISOString();
        return u;
      });
      console.log(`[portal] turning off ${username} undone: it would have left no active admin`);
      return json(409, LAST_ADMIN);
    }
    console.log(`[portal] login turned off: ${username} by ${admin.username}`);
    return json(200, { ok: true, user: publicUser(updated), call: netlifyCall(context, "update", username) });
  }

  if (action === "enable") {
    const updated = await updateUser(username, (u) => {
      u.active = true;
      u.failedLogins = 0;
      u.lockedUntil = null;
      u.updatedAt = now;
      return u;
    });
    if (!updated) return json(404, { error: "There is no login with that account number or username." });
    console.log(`[portal] login turned on: ${username} by ${admin.username}`);
    return json(200, { ok: true, user: publicUser(updated), call: netlifyCall(context, "update", username) });
  }

  return json(404, { error: "Not found" });
}

async function remove(context, admin, username) {
  const target = await getUser(username);
  if (!target) return json(404, { error: "There is no login with that account number or username." });
  if (username === admin.username) return json(400, { error: "You cannot delete your own login." });
  if (target.role === "admin" && target.active === true && (await activeAdminCount()) <= 1) return json(400, LAST_ADMIN);
  // a customer's invoices and reports go FIRST: if that fails, the login is still there and the admin can try again
  let documentsDeleted = 0;
  if (target.role === "customer") {
    documentsDeleted = await deleteAllDocs(username);
    if (documentsDeleted) console.log(`[portal] ${documentsDeleted} document(s) deleted with the login ${username} by ${admin.username}`);
  }
  await store().delete(username);
  if (target.role === "admin" && target.active === true && (await activeAdminCount()) < 1) {
    // another admin was removed or turned off at the same moment: put this one back so an admin is always on
    await store().setJSON(username, target, { onlyIfNew: true });
    console.log(`[portal] deleting ${username} undone: it would have left no active admin`);
    return json(409, LAST_ADMIN);
  }
  console.log(`[portal] login deleted: ${username} by ${admin.username}`);
  return json(200, { ok: true, deleted: username, loginName: loginName(target), documentsDeleted, call: netlifyCall(context, "delete", username) });
}

export default guarded(async (req, context) => {
  const params = (context && context.params) || {};
  const method = req.method;

  if (method !== "GET" && csrfProblem(req)) return json(403, { error: "Please use the admin page on the site." });
  const r = await requireUser(req, { admin: true });
  if (r.error) return r.error;
  const admin = r.user;

  if (params.username === undefined) {
    if (method === "GET") return list(context);
    if (method === "POST") return create(req, context, admin);
    return json(405, { error: "Method not allowed" }, { allow: "GET, POST" });
  }

  const username = cleanUsername(params.username);
  if (!username) return json(404, { error: "There is no login with that account number or username." });

  if (params.action === undefined) {
    if (method === "DELETE") return remove(context, admin, username);
    return json(405, { error: "Method not allowed" }, { allow: "DELETE" });
  }
  if (method !== "POST") return json(405, { error: "Method not allowed" }, { allow: "POST" });
  if (!["reset", "disable", "enable", "email"].includes(params.action)) return json(404, { error: "Not found" });
  return act(req, context, admin, username, params.action);
});

export const config = {
  path: ["/api/admin/users", "/api/admin/users/:username", "/api/admin/users/:username/:action"],
};
