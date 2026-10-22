// Chemtec customer portal: the gate in front of the documents and the admin page (Netlify Edge Function).
//
//   any PDF, anything under /assets/docs/   logged in only; otherwise to /portal/login/?next=<that file>
//   /documents/ (the old public page)       logged in: /portal/#documents   logged out: the log in page
//   /portal/admin/                          admins only; a customer is sent back to /portal/
//   the code, package files, netlify.toml,  never served (404), whatever the case of the address
//   notes, backups and dotfiles
//
// It runs on every page and file except the site's own styles, scripts, images and video in /assets/ and
// /assets/people/ (never in /assets/docs/), the /api/ functions (which check the session themselves) and the
// pay function. It decides on a normalised copy of the path (lowercased, percent decoding undone,
// backslashes, double slashes and dot segments resolved), so a changed case or an encoded path cannot slip a
// PDF past it. The cookie is checked with Web Crypto (HMAC SHA-256, the same SESSION_SECRET as the
// functions), then the user record is re-read from the "portal-users" store: a login that was turned off,
// reset or deleted is refused at once. Anything that goes wrong refuses (fails closed). Protected answers
// are never cached.
//
// Built by Apex Solved for Chemtec Products Company, 8 Oct 2026.

import { getStore } from "@netlify/blobs";
import { COOKIE_NAME, readCookie, verifySession, normalizePath, classifyPath, safeNext } from "../lib/session.mjs";

const NO_STORE = "private, no-store, max-age=0";

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: { location, "cache-control": NO_STORE, "x-robots-tag": "noindex" },
  });
}

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": NO_STORE, "x-robots-tag": "noindex" },
  });
}

function loginTo(next) {
  return "/portal/login/?next=" + encodeURIComponent(safeNext(next, "/portal/"));
}

async function currentUser(request) {
  const secret = Netlify.env.get("SESSION_SECRET") || "";
  const token = readCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (!token) return null;
  const session = await verifySession(secret, token);
  if (!session) return null;
  try {
    const user = await getStore({ name: "portal-users", consistency: "strong" }).get(session.username, { type: "json" });
    if (!user || user.active !== true || user.sessionVersion !== session.sv) return null;
    return user;
  } catch (err) {
    console.error(`[portal-gate] could not read the user store (${err && err.name}); refusing`);
    return null;
  }
}

export default async (request, context) => {
  const url = new URL(request.url);
  try {
    decodeURIComponent(url.pathname);
  } catch {
    // a broken % escape is never a real address: answer plainly here rather than let a router error show
    return new Response("Bad request", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": NO_STORE, "x-robots-tag": "noindex" },
    });
  }
  const path = normalizePath(url.pathname);
  let kind = classifyPath(path);
  // Netlify's image service fetches a file of this site by its url parameter: a protected file stays protected
  if (!kind && (path === "/.netlify/images" || path.startsWith("/.netlify/images/"))) {
    const src = normalizePath(url.searchParams.get("url") || "");
    if (classifyPath(src) === "doc" || src.includes("/assets/docs")) kind = "doc";
  }
  if (!kind) return; // everything else goes straight through
  if (kind === "hidden") return notFound();

  const user = await currentUser(request);

  if (kind === "documents") {
    if (!user) return redirect(loginTo("/portal/#documents"));
    return redirect(user.mustChangePassword ? "/portal/change-password/" : "/portal/#documents");
  }

  if (kind === "admin") {
    if (!user) return redirect(loginTo("/portal/admin/"));
    if (user.mustChangePassword) return redirect("/portal/change-password/?next=" + encodeURIComponent("/portal/admin/"));
    if (user.role !== "admin") return redirect("/portal/?notice=staff-only");
  }

  if (kind === "doc") {
    if (!user) return redirect(loginTo(url.pathname));
    if (user.mustChangePassword) return redirect("/portal/change-password/?next=" + encodeURIComponent(safeNext(url.pathname, "/portal/")));
  }

  const res = await context.next();
  const out = new Response(res.body, res);
  out.headers.set("cache-control", NO_STORE);
  out.headers.set("x-robots-tag", "noindex");
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.append("vary", "cookie");
  return out;
};

export const config = {
  // Every request, except three exact kinds, matched as regular expressions so nothing encoded or traversed can
  // ride along (no "%", no ";", no "#", no "/" inside a file name, no segment that starts with a dot):
  //   the site's own assets   a file directly in /assets/ or /assets/people/ that ends in .css, .js, an image,
  //                           video or a font (so nothing in /assets/docs/, not even an image, skips the gate)
  //   the portal API          each /api/ function checks the session itself (customer documents too, 9 Oct 2026:
//                           /api/files and /api/admin/files read the private store "portal-files" only after the
//                           session check; a customer's own documents only, upload and delete admins only)
  //   the pay function        /.netlify/functions/pay (public by design: pay by bank)
  pattern: "^/.*$",
  excludedPattern: [
    "^/assets/(people/)?[A-Za-z0-9_-][A-Za-z0-9_.-]*\\.(css|js|png|jpg|jpeg|webp|gif|svg|ico|mp4|woff|woff2)$",
    "^/api/(login|logout|me|change-password|documents|files(/[a-f0-9]{32})?|admin/store|admin/files(/[a-z0-9][a-z0-9._-]{0,39}/[a-f0-9]{32})?|admin/users(/[A-Za-z0-9_-][A-Za-z0-9._-]{0,39}(/(reset|disable|enable|email))?)?)$",
    "^/\\.netlify/functions/pay$",
  ],
};
