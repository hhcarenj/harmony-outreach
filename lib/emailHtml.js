/**
 * Shared email-body → HTML conversion.
 *
 * Email bodies are authored as plain text (with {{merge}} tags and \n line breaks)
 * but may now also contain admin-embedded <img> tags inserted from the Templates tab.
 *
 * We must:
 *   - Escape stray <, >, & in the PLAIN-TEXT portions so they don't corrupt layout.
 *   - Linkify bare http(s) URLs.
 *   - PRESERVE <img …> tags verbatim so embedded images actually render. (Previously
 *     the whole body was escaped, turning <img> into &lt;img&gt; — images never showed.)
 *
 * Line breaks are rendered by the caller's wrapping <div style="white-space:pre-line">,
 * so do NOT inject <br/> here (that would double-count every newline).
 */

// Private-use-area sentinels wrapping the stash index — cannot occur in a real email body.
const STASH_OPEN = "";
const STASH_CLOSE = "";
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const RESTORE_RE = new RegExp(`${STASH_OPEN}(\\d+)${STASH_CLOSE}`, "g");

export function textToHtml(text) {
  const imgs = [];
  // 1. Stash <img> tags behind placeholders so escaping/linkifying skips them.
  const stashed = (text || "").replace(IMG_TAG_RE, (tag) => {
    imgs.push(tag);
    return `${STASH_OPEN}${imgs.length - 1}${STASH_CLOSE}`;
  });
  // 2. Escape the plain-text body and linkify bare URLs.
  const escaped = stashed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1155cc;">$1</a>');
  // 3. Restore the original <img> tags.
  return escaped.replace(RESTORE_RE, (_, n) => imgs[Number(n)]);
}
