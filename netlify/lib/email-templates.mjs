// Chemtec customer portal: the branded login emails (8 Oct 2026).
//   customer-welcome   a new customer login         subject "Your Chemtec customer portal login"
//   admin-welcome      a new admin login            subject "Your Chemtec portal admin login"
//   password-reset     a new temporary password     subject "Your Chemtec portal password was reset"
//
// renderLoginEmail() gives back, for one login and one temporary password:
//   html        the email: a 600px table layout with inline CSS (Gmail, Outlook desktop and web, Apple Mail,
//               Proton Mail, iOS and Android mail), a hidden preheader, a bulletproof button with a VML fallback
//   pasteHtml   the same card without the page wrapper, the preheader or the Outlook comments, for pasting into a
//               new email (Copy branded email on the admin page)
//   text        the plain text alternative, word for word the admin page's login message
// Every value from a login (name, username, password) is escaped for HTML. Only the constants below go into links.
// The temporary password is never put in the subject or the preheader, so it does not show in an inbox list or
// on a lock screen.
// No secrets in this file. Pure functions, no imports: the functions and the preview script can both load it.
// Built by Apex Solved for Chemtec Products Company, 8 Oct 2026.

// The logo is loaded from ASSET_BASE: Chemtec's own site, chemtecpro.com (since the go live, 9 Oct 2026).
export const ASSET_BASE = "https://chemtecpro.com";
export const LOGO_PATH = "/assets/apple-touch-icon-180.png"; // the CPC drop on its own white square, 180 px
export const PORTAL_URL = "https://chemtecpro.com/portal/";
export const ADMIN_URL = "https://chemtecpro.com/portal/admin/";
export const OFFICE = "(215) 721-1636";
export const OFFICE_TEL = "+12157211636";
export const SERVICE_EMAIL = "service@chemtecproductscompany.com";
export const COMPANY = "Chemtec Products Company";
export const ADDRESS = "675 Forman Road, Souderton, PA 18964"; // as on the site's Contact page and footer
export const SINCE = "Veteran owned since 1982"; // the site footer: "Since 1982 · Veteran owned"

export const KINDS = ["customer-welcome", "admin-welcome", "password-reset"];
export const SUBJECTS = {
  "customer-welcome": "Your Chemtec customer portal login",
  "admin-welcome": "Your Chemtec portal admin login",
  "password-reset": "Your Chemtec portal password was reset",
};
const PREHEADERS = {
  "customer-welcome": "Your username and temporary password for the Chemtec customer portal.",
  "admin-welcome": "Your username and temporary password for the Chemtec portal admin page.",
  "password-reset": "Your new temporary password for the Chemtec customer portal.",
};

// the brand sheet: white and black do the work, the CPC drop's aqua and deep are accents only
const C = {
  ink: "#0A0A0A",
  text: "#1B1B1B",
  muted: "#565656",
  line: "#E4E4E4",
  soft: "#F6F6F5",
  aqua: "#50C0D0",
  deep: "#103040",
  white: "#FFFFFF",
};
const SANS = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono','Courier New',monospace";

/** Text made safe for HTML (element content and quoted attributes). */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Which template fits: a reset, or a new login for a customer or an admin. */
export function kindFor(user, reset) {
  if (reset) return "password-reset";
  return user && user.role === "admin" ? "admin-welcome" : "customer-welcome";
}

function firstName(user) {
  return String((user && user.displayName) || "").split(" ")[0] || "there";
}

/** The plain text: the admin page's login message, word for word (a reset says so). */
export function loginText(kind, user, password) {
  const admin = user && user.role === "admin";
  const lines = ["Hello " + firstName(user) + ",", ""];
  lines.push(introLine(kind, user), "");
  lines.push("Portal: " + PORTAL_URL);
  if (admin) lines.push("Admin page: " + ADMIN_URL);
  lines.push("Username: " + ((user && user.loginName) || ""), "Temporary password: " + password, "");
  lines.push(kind === "password-reset" ? "You'll choose your own password the next time you sign in." : "You'll choose your own password the first time you sign in.", "");
  lines.push("Questions? Call us at " + OFFICE + " or email " + SERVICE_EMAIL + ".", "");
  lines.push(COMPANY);
  return lines.join("\n");
}

/** The one line that says what this is. A reset adds "Your password was reset." in front. */
function introLine(kind, user) {
  const admin = user && user.role === "admin";
  if (kind === "password-reset") {
    return "Your password was reset. Here is your new " + (admin ? "admin login" : "login") + " for the Chemtec customer portal.";
  }
  return admin ? "Here is your admin login for the Chemtec customer portal." : "Here is your login for the Chemtec customer portal.";
}

// ---------- the pieces ----------

function label(text) {
  return `<div style="margin:0 0 4px 0;font-family:${SANS};font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${C.muted};">${esc(text)}</div>`;
}

function linkValue(url) {
  return `<a href="${esc(url)}" style="font-family:${SANS};font-size:16px;line-height:24px;font-weight:600;color:${C.deep};text-decoration:underline;word-break:break-all;">${esc(url)}</a>`;
}

// A long word (a 40 character username, the service address) wraps inside its box instead of pushing the email
// wider than a phone. It breaks only when it cannot fit on a line of its own.
const WRAP = "word-break:break-word;overflow-wrap:anywhere;";

function monoValue(text) {
  return `<span class="mono" style="font-family:${MONO};font-size:17px;line-height:24px;font-weight:700;letter-spacing:0.02em;color:${C.ink};${WRAP}">${esc(text)}</span>`;
}

// The pasted copy has no <style>, so no phone sizes: a slightly smaller password keeps it on one line on a phone.
// When it must wrap, it wraps after a dash where it can (never break-all, which split a group in two).
function passwordField(password, paste) {
  const size = paste ? "font-size:18px;line-height:26px;letter-spacing:0.02em;" : "font-size:19px;line-height:26px;letter-spacing:0.04em;";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
<tr><td bgcolor="${C.white}" style="background-color:${C.white};border:1px solid #CFCFCF;border-radius:4px;padding:10px 14px;">
<span class="mono pw" style="font-family:${MONO};${size}font-weight:700;color:${C.ink};-webkit-user-select:all;user-select:all;${WRAP}">${esc(password)}</span>
</td></tr>
</table>`;
}

function detailsBox(kind, user, password, paste) {
  const admin = user && user.role === "admin";
  const b = paste ? 16 : 20; // the box's side padding
  const rows = [];
  rows.push(`<tr><td class="box" style="padding:18px ${b}px 0 ${b}px;">${label("Portal")}${linkValue(PORTAL_URL)}</td></tr>`);
  if (admin) rows.push(`<tr><td class="box" style="padding:14px ${b}px 0 ${b}px;">${label("Admin page")}${linkValue(ADMIN_URL)}</td></tr>`);
  rows.push(`<tr><td class="box" style="padding:14px ${b}px 0 ${b}px;">${label("Username")}${monoValue((user && user.loginName) || "")}</td></tr>`);
  rows.push(`<tr><td class="box" style="padding:14px ${b}px 20px ${b}px;">${label("Temporary password")}${passwordField(password, paste)}</td></tr>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr><td bgcolor="${C.soft}" style="background-color:${C.soft};border:1px solid ${C.line};border-left:4px solid ${C.deep};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
${rows.join("\n")}
</table>
</td></tr>
</table>`;
}

const BUTTON_TEXT = "Open the customer portal";

/** The bulletproof button: VML for Outlook on Windows, a styled link everywhere else. */
function buttonVml() {
  return `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(PORTAL_URL)}" style="height:50px;v-text-anchor:middle;width:290px;" arcsize="8%" stroke="f" fillcolor="${C.deep}">
<w:anchorlock/>
<center style="color:${C.white};font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;">${BUTTON_TEXT}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a class="btn-a" href="${esc(PORTAL_URL)}" style="background-color:${C.deep};border-radius:4px;color:${C.white};display:inline-block;font-family:${SANS};font-size:16px;font-weight:700;line-height:50px;text-align:center;text-decoration:none;width:290px;-webkit-text-size-adjust:none;mso-hide:all;">${BUTTON_TEXT}</a>
<!--<![endif]-->`;
}

/** For pasting: no comments survive a paste, so a filled cell carries the colour (Outlook shows it too). */
function buttonCell() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
<tr><td align="center" bgcolor="${C.deep}" style="background-color:${C.deep};border-radius:4px;">
<a href="${esc(PORTAL_URL)}" style="display:inline-block;padding:15px 24px;font-family:${SANS};font-size:16px;line-height:20px;font-weight:700;color:${C.white};text-decoration:none;border-radius:4px;">${BUTTON_TEXT}</a>
</td></tr>
</table>`;
}

function header(assetBase, paste) {
  const logo = esc(String(assetBase || ASSET_BASE).replace(/\/+$/, "") + LOGO_PATH);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr>
<td width="60" valign="middle" style="width:60px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr>
<td bgcolor="${C.white}" style="background-color:${C.white};border-radius:8px;padding:2px;"><img src="${logo}" width="56" height="56" alt="${esc(COMPANY)}" style="display:block;width:56px;height:56px;border:0;outline:none;text-decoration:none;"></td>
</tr></table>
</td>
<td valign="middle" style="padding-left:12px;">
<div style="font-family:${SANS};font-size:23px;line-height:24px;font-weight:800;letter-spacing:-0.02em;color:${C.ink};">Chemtec</div>
<div style="margin-top:4px;font-family:${SANS};font-size:10px;line-height:14px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:${C.muted};">Products Company</div>
</td>
${paste ? "" : `<td align="right" valign="middle" class="hide-sm" style="font-family:${SANS};font-size:10px;line-height:14px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${C.deep};white-space:nowrap;">Customer portal</td>`}
</tr>
</table>`;
}

function aquaRule() {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr><td height="2" bgcolor="${C.aqua}" style="height:2px;line-height:2px;font-size:2px;background-color:${C.aqua};">&nbsp;</td></tr>
</table>`;
}

/** The white card: everything from the header to the sign off. */
function card(kind, user, password, { assetBase, paste }) {
  const p = `font-family:${SANS};font-size:16px;line-height:26px;color:${C.text};`;
  const x = paste ? 24 : 40; // side padding: the pasted copy has no phone sizes, so it starts narrower
  const pad = (top, bottom) => `padding:${top}px ${x}px ${bottom}px ${x}px;`;
  const tel = `<a href="tel:${OFFICE_TEL}" style="color:${C.deep};text-decoration:underline;white-space:nowrap;">${esc(OFFICE)}</a>`;
  const mail = `<a href="mailto:${esc(SERVICE_EMAIL)}" style="color:${C.deep};text-decoration:underline;${WRAP}">${esc(SERVICE_EMAIL)}</a>`;
  const choose = kind === "password-reset" ? "You&#8217;ll choose your own password the next time you sign in." : "You&#8217;ll choose your own password the first time you sign in.";
  return `<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.white}" style="width:100%;max-width:600px;background-color:${C.white};border:1px solid ${C.line};border-radius:6px;border-collapse:separate;">
<tr><td class="px" style="${pad(28, 0)}">
${header(assetBase, paste)}
</td></tr>
<tr><td class="px" style="${pad(20, 0)}">
${aquaRule()}
</td></tr>
<tr><td class="px" style="${pad(28, 0)}${p}">
<p style="margin:0 0 14px 0;${p}">Hello ${esc(firstName(user))},</p>
<p style="margin:0;${p}">${esc(introLine(kind, user))}</p>
</td></tr>
<tr><td class="px" style="${pad(22, 0)}">
${detailsBox(kind, user, password, paste)}
</td></tr>
<tr><td class="px" align="left" style="${pad(26, 0)}">
${paste ? buttonCell() : buttonVml()}
</td></tr>
<tr><td class="px" style="${pad(24, 0)}${p}">
<p style="margin:0;${p}">${choose}</p>
</td></tr>
<tr><td class="px" style="${pad(14, 0)}font-family:${SANS};font-size:15px;line-height:24px;color:${C.muted};">
<p class="help" style="margin:0;font-family:${SANS};font-size:15px;line-height:24px;color:${C.muted};">Questions? Call us at ${tel} or email ${mail}.</p>
</td></tr>
<tr><td class="px" style="${pad(24, 32)}">
<p style="margin:0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:700;color:${C.ink};">${esc(COMPANY)}</p>
</td></tr>
</table>`;
}

function footer(paste) {
  const x = paste ? 24 : 40;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td class="px" align="center" style="padding:20px ${x}px 0 ${x}px;font-family:${SANS};font-size:12px;line-height:19px;color:${C.muted};text-align:center;">
<span style="font-weight:700;color:${C.ink};">${esc(COMPANY)}</span><br>
${esc(ADDRESS)}<br>
${esc(SINCE)}
</td></tr>
</table>`;
}

const SPACERS = "&#847;&zwnj;&nbsp;".repeat(80);

/**
 * The branded email for one login.
 *   kind       "customer-welcome" | "admin-welcome" | "password-reset"
 *   user       { displayName, loginName, role } (as the admin API returns it)
 *   password   the temporary password (plain, from the request that made it; never stored)
 *   assetBase  optional, for previews only; defaults to ASSET_BASE
 * Returns { kind, subject, preheader, html, pasteHtml, text }.
 */
export function renderLoginEmail({ kind, user, password, assetBase } = {}) {
  if (!KINDS.includes(kind)) throw new Error("unknown email kind");
  const pw = String(password ?? "");
  const subject = SUBJECTS[kind];
  const preheader = PREHEADERS[kind];
  const html = pageHtml(subject, preheader, `${card(kind, user, pw, { assetBase, paste: false })}
${footer(false)}`);
  const pasteHtml = `<div style="margin:0;padding:0;">
${card(kind, user, pw, { assetBase, paste: true })}
${footer(true)}
</div>`;
  return { kind, subject, preheader, html, pasteHtml, text: loginText(kind, user, pw) };
}

/** The email page around a card: the head, the phone sizes, the hidden preheader and the soft grey page. */
function pageHtml(subject, preheader, inner) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(subject)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>table,td,div,p,a,span{font-family:Arial,Helvetica,sans-serif !important;} .mono{font-family:Consolas,'Courier New',monospace !important;}</style>
<![endif]-->
<style>
:root{color-scheme:light only;supported-color-schemes:light only;}
body{margin:0;padding:0;width:100% !important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;}
@media only screen and (max-width:620px){
  .outer{padding:16px 10px !important;}
  .px{padding-left:28px !important;padding-right:28px !important;}
}
@media only screen and (max-width:480px){
  .px{padding-left:20px !important;padding-right:20px !important;}
  .box{padding-left:16px !important;padding-right:16px !important;}
  .pw{font-size:17px !important;letter-spacing:0.02em !important;}
  .btn-a{display:block !important;width:auto !important;}
  .hide-sm{display:none !important;}
}
@media only screen and (max-width:360px){
  .outer{padding:12px 6px 24px 6px !important;}
  .px{padding-left:16px !important;padding-right:16px !important;}
  .box{padding-left:14px !important;padding-right:14px !important;}
  .pw{font-size:15px !important;letter-spacing:0 !important;}
  .help{font-size:14px !important;line-height:22px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.soft};" bgcolor="${C.soft}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${C.soft};">${esc(preheader)}${SPACERS}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.soft}" style="width:100%;background-color:${C.soft};">
<tr><td class="outer" align="center" style="padding:32px 12px 36px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
${inner}
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}

// ---------- the new document notice (9 Oct 2026) ----------
// After an admin uploads a report or an invoice, the admin page offers Copy notice email: this email, to paste
// into a new email in Proton Mail. The portal itself never sends it. It says a document is waiting and links to the
// portal; it never carries the document, a password or anything about money.

// v1.2 (22 Oct 2026): the stored key "test-sheet" is unchanged; the customer reads it as a Report (a Field Service
// Report, a boiler report, a test sheet), in the Reports column of the portal. Invoices sit in the Invoices column.
export const NOTICE_TYPES = ["test-sheet", "invoice"];
const NOTICE = {
  "test-sheet": {
    subject: "A new report is in your Chemtec portal",
    preheader: "A new report for your account is in the Chemtec customer portal.",
    intro: "A new report for your account is in your Chemtec customer portal.",
    label: "Report",
    where: "Log in with your account number and password, then look under Reports.",
  },
  invoice: {
    subject: "A new invoice is in your Chemtec portal",
    preheader: "A new invoice for your account is in the Chemtec customer portal.",
    intro: "A new invoice for your account is in your Chemtec customer portal.",
    label: "Invoice",
    where: "Log in with your account number and password, then look under Invoices.",
  },
};

function noticeRows(type, user, doc) {
  const rows = [["Document", NOTICE[type].label]];
  if (doc && doc.dateLabel) rows.push(["Date", doc.dateLabel]);
  if (doc && doc.title) rows.push(["Title", doc.title]);
  rows.push(["Account number", (user && user.loginName) || (doc && doc.accountNumber) || ""]);
  return rows;
}

/** The plain text notice. */
export function noticeText(type, user, doc) {
  const lines = ["Hello " + firstName(user) + ",", "", NOTICE[type].intro, ""];
  for (const [k, v] of noticeRows(type, user, doc)) lines.push(k + ": " + v);
  lines.push("", "Portal: " + PORTAL_URL, "", NOTICE[type].where, "");
  lines.push("Questions? Call us at " + OFFICE + " or email " + SERVICE_EMAIL + ".", "");
  lines.push(COMPANY);
  return lines.join("\n");
}

function noticeBox(rows, paste) {
  const b = paste ? 16 : 20;
  const out = rows.map(([k, v], i) => {
    const top = i === 0 ? 18 : 14;
    const bottom = i === rows.length - 1 ? 20 : 0;
    const value = `<span style="font-family:${SANS};font-size:16px;line-height:24px;font-weight:700;color:${C.ink};${WRAP}">${esc(v)}</span>`;
    return `<tr><td class="box" style="padding:${top}px ${b}px ${bottom}px ${b}px;">${label(k)}${value}</td></tr>`;
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr><td bgcolor="${C.soft}" style="background-color:${C.soft};border:1px solid ${C.line};border-left:4px solid ${C.deep};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
${out.join("\n")}
</table>
</td></tr>
</table>`;
}

function noticeCard(type, user, doc, { assetBase, paste }) {
  const p = `font-family:${SANS};font-size:16px;line-height:26px;color:${C.text};`;
  const x = paste ? 24 : 40;
  const pad = (top, bottom) => `padding:${top}px ${x}px ${bottom}px ${x}px;`;
  const tel = `<a href="tel:${OFFICE_TEL}" style="color:${C.deep};text-decoration:underline;white-space:nowrap;">${esc(OFFICE)}</a>`;
  const mail = `<a href="mailto:${esc(SERVICE_EMAIL)}" style="color:${C.deep};text-decoration:underline;${WRAP}">${esc(SERVICE_EMAIL)}</a>`;
  return `<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.white}" style="width:100%;max-width:600px;background-color:${C.white};border:1px solid ${C.line};border-radius:6px;border-collapse:separate;">
<tr><td class="px" style="${pad(28, 0)}">
${header(assetBase, paste)}
</td></tr>
<tr><td class="px" style="${pad(20, 0)}">
${aquaRule()}
</td></tr>
<tr><td class="px" style="${pad(28, 0)}${p}">
<p style="margin:0 0 14px 0;${p}">Hello ${esc(firstName(user))},</p>
<p style="margin:0;${p}">${esc(NOTICE[type].intro)}</p>
</td></tr>
<tr><td class="px" style="${pad(22, 0)}">
${noticeBox(noticeRows(type, user, doc), paste)}
</td></tr>
<tr><td class="px" align="left" style="${pad(26, 0)}">
${paste ? buttonCell() : buttonVml()}
</td></tr>
<tr><td class="px" style="${pad(24, 0)}${p}">
<p style="margin:0;${p}">${esc(NOTICE[type].where)}</p>
</td></tr>
<tr><td class="px" style="${pad(14, 0)}font-family:${SANS};font-size:15px;line-height:24px;color:${C.muted};">
<p class="help" style="margin:0;font-family:${SANS};font-size:15px;line-height:24px;color:${C.muted};">Questions? Call us at ${tel} or email ${mail}.</p>
</td></tr>
<tr><td class="px" style="${pad(24, 32)}">
<p style="margin:0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:700;color:${C.ink};">${esc(COMPANY)}</p>
</td></tr>
</table>`;
}

/**
 * The new document notice for one customer.
 *   type       "test-sheet" (a report) | "invoice"
 *   user       { displayName, loginName } (the customer, as the admin API returns it)
 *   doc        { dateLabel, title, accountNumber } (the document, as the admin API returns it)
 *   assetBase  optional, for previews only; defaults to ASSET_BASE
 * Returns { kind, subject, preheader, html, pasteHtml, text }. No password, no money, no attachment.
 */
export function renderNoticeEmail({ type, user, doc, assetBase } = {}) {
  if (!NOTICE_TYPES.includes(type)) throw new Error("unknown notice type");
  const n = NOTICE[type];
  const html = pageHtml(n.subject, n.preheader, `${noticeCard(type, user, doc, { assetBase, paste: false })}
${footer(false)}`);
  const pasteHtml = `<div style="margin:0;padding:0;">
${noticeCard(type, user, doc, { assetBase, paste: true })}
${footer(true)}
</div>`;
  return { kind: "notice-" + type, subject: n.subject, preheader: n.preheader, html, pasteHtml, text: noticeText(type, user, doc) };
}
