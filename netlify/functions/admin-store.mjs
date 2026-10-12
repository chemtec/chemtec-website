// GET /api/admin/store  admin only: what is in the Netlify Blobs store "portal-users", for the admin page.
// Each key with its size and the fields that are safe to show. Never a password hash, never an environment value:
// for the environment it says only whether each variable is set.
// Built by Apex Solved for Chemtec Products Company, 8 Oct 2026.

import { json, guarded, requireUser, listUsers, isLocked, loginName, netlifyCall, STORE_NAME, ENV_NAMES } from "../lib/portal.mjs";

export default guarded(async (req, context) => {
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, { allow: "GET" });
  const r = await requireUser(req, { admin: true });
  if (r.error) return r.error;

  const all = await listUsers();
  const keys = all.map((x) => {
    const d = x.data || {};
    return {
      key: x.key,
      login: loginName(d),
      size: x.size,
      etag: x.etag ? String(x.etag).replace(/"/g, "").slice(0, 12) : "",
      role: d.role || "",
      active: d.active === true,
      mustChangePassword: d.mustChangePassword === true,
      locked: isLocked(d),
      updatedAt: d.updatedAt || null,
      lastLoginAt: d.lastLoginAt || null,
      fields: Object.keys(d).filter((k) => k !== "passwordHash"),
      hasPasswordHash: typeof d.passwordHash === "string" && d.passwordHash.length > 0,
    };
  });

  const env = {};
  for (const name of ENV_NAMES) env[name] = Boolean(process.env[name] && String(process.env[name]).trim());

  const site = (context && context.site) || {};
  return json(200, {
    store: STORE_NAME,
    consistency: "strong",
    site: { name: site.name || null, id: site.id || null, url: site.url || null },
    count: keys.length,
    totalBytes: keys.reduce((n, k) => n + k.size, 0),
    keys,
    env,
    call: netlifyCall(context, "inspect"),
  });
});

export const config = { path: "/api/admin/store" };
