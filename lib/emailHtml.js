/**
 * Shared email HTML/text rendering.
 *
 * renderEmailHtml(body, { footerHtml }) turns a template body — which may be plain
 * text with \n line breaks, full HTML, or a mix (plain text with embedded <img> tags
 * inserted from the Templates tab) — into an email-client-safe HTML document.
 *
 *   - If the body already contains HTML tags, its tags are preserved as-is.
 *   - Plain-text portions are escaped and bare URLs are linkified.
 *   - Text-level \n become <br> so line breaks survive (the wrapper has no
 *     white-space:pre-line). Newlines sitting purely between block tags (…>\n<…)
 *     are left as whitespace so hand-written HTML doesn't get double spacing.
 *
 * footerHtml (optional) is appended inside the 600px container — callers pass their
 * branded signature + CAN-SPAM block so compliance/branding is preserved.
 *
 * renderEmailText(body, footerText) is the plain-text fallback (HTML stripped) for
 * clients that don't render HTML.
 */

// Does the body contain HTML tags? (spec regex)
export function bodyIsHtml(body) {
  return /<[a-z][\s\S]*>/i.test(body || "");
}

/**
 * Stable base URL for assets embedded in outbound emails (logo, brochure, etc).
 *
 * process.env.VERCEL_URL is DEPLOYMENT-SPECIFIC — it changes on every deploy and,
 * critically, non-production deployment URLs are gated behind Vercel's SSO/deployment
 * protection, so any asset link built from it 404s/redirects-to-login for every real
 * recipient outside the Vercel team. Use VERCEL_PROJECT_PRODUCTION_URL instead — the
 * stable, unauthenticated production alias Vercel also injects automatically.
 */
export function resolveAppBaseUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = explicit ? `https://${explicit.replace(/^https?:\/\//, "")}` : "https://harmony-outreach.vercel.app";
  return base;
}

function escapeAndLinkify(text) {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1155cc;">$1</a>');
}

// Convert text-level newlines to <br>, but leave newlines that merely separate
// block tags (…>\n<…) as whitespace so full HTML bodies don't gain extra gaps.
function newlinesToBr(s) {
  return (s || "").replace(/\n/g, (_m, offset, str) => {
    const before = str.slice(Math.max(0, offset - 40), offset);
    const after = str.slice(offset + 1, offset + 41);
    return />\s*$/.test(before) && /^\s*</.test(after) ? "\n" : "<br>\n";
  });
}

// Body → HTML fragment (not the full document).
function processBody(body) {
  const b = body || "";
  // HTML (or mixed plain+<img>) — keep tags verbatim; only <br> the text newlines.
  if (bodyIsHtml(b)) return newlinesToBr(b);
  // Pure plain text — escape, linkify, then <br> every newline.
  return newlinesToBr(escapeAndLinkify(b));
}

export function renderEmailHtml(body, { footerHtml = "" } = {}) {
  const processedBody = processBody(body);
  const footer = footerHtml ? `\n    ${footerHtml}` : "";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 20px; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a; background-color: #ffffff;">
  <div style="max-width: 600px; margin: 0 auto;">
    ${processedBody}${footer}
  </div>
</body>
</html>`;
}

// Strip HTML → readable plain text for the Resend `text` fallback field.
export function htmlToPlainText(body) {
  return (body || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, "\n")
    .replace(/<img\b[^>]*>/gi, "") // images have no plain-text form
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderEmailText(body, footerText = "") {
  const stripped = htmlToPlainText(body);
  return footerText ? `${stripped}\n\n${footerText}` : stripped;
}
