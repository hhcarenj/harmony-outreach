/**
 * Server-side email sending route via Resend.
 *
 * - Converts plain-text email body → HTML
 * - Auto-appends the Harmony Homecare branded signature
 * - RESEND_API_KEY is read from server environment only
 *
 * The LOGO_URL env var is optional. If set, the signature includes the logo image.
 * Default: uses the deployed app's /logo.png (place your logo in the public/ folder).
 */

const SIGNATURE_HTML = (logoUrl) => `
<div style="margin-top:28px; padding-top:16px; border-top:1px solid #ddd; font-family:Arial,Helvetica,sans-serif;">
  <p style="margin:0 0 2px 0; font-size:15px; line-height:1.4;">
    <strong style="color:#000;">Nate Ojugo</strong>
    <em style="color:#555; font-weight:normal;">(Admin Manager)</em>
  </p>
  <p style="margin:2px 0; font-size:14px; color:#333;">(609) 755-5593</p>
  <p style="margin:2px 0; font-size:14px;">
    <a href="https://harmonycarenj.org/" style="color:#1155cc; text-decoration:none;">https://harmonycarenj.org/</a>
  </p>
  <p style="margin:4px 0; font-size:14px; color:#333;">Empowering Lives, Embracing Potential</p>
  <p style="margin:2px 0; font-size:14px;">
    <a href="mailto:hhcare.nj@gmail.com" style="color:#cc0000; font-weight:bold; text-decoration:none;">hhcare.nj@gmail.com</a>
  </p>
  ${logoUrl ? `<img src="${logoUrl}" alt="Harmony Homecare Agency LLC" style="margin-top:10px; max-width:180px; height:auto;" />` : ""}
</div>
<div style="margin-top:20px; padding-top:12px; border-top:1px solid #eee; font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#999; line-height:1.5;">
  To unsubscribe from future emails, reply with &ldquo;unsubscribe&rdquo; in the subject line.<br/>
  Harmony Homecare Agency, LLC &middot; 1852 Burlington Mt-Holly Road, Westampton, NJ 08060
</div>`;

// Escape HTML entities, linkify URLs. Line breaks are handled by the wrapping
// <div style="white-space:pre-line"> below — do NOT also inject <br/> tags here,
// that double-counts every line break and inflates paragraph spacing.
function textToHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1155cc;">$1</a>');
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { to, subject, text, from } = req.body;

  if (!to || !subject || !text || !from) {
    return res.status(400).json({ error: "Missing required fields: to, subject, text, from" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY is not configured on the server. Add it in Vercel → Settings → Environment Variables." });
  }

  // Build the logo URL — checks env var first, then falls back to the app's /logo.png
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  const logoUrl = process.env.LOGO_URL
    || (appUrl ? `https://${appUrl.replace(/^https?:\/\//, "")}/logo.png` : "");

  // Convert plain text body to styled HTML with signature
  const htmlBody = `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,Helvetica,sans-serif; font-size:14px; color:#333; line-height:1.6; max-width:600px;">
  <div style="white-space:pre-line;">
${textToHtml(text)}
  </div>
  ${SIGNATURE_HTML(logoUrl)}
</body>
</html>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html: htmlBody,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Resend error:", data);
      return res.status(response.status).json({ error: data.message || "Resend API error", details: data });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("send-email route error:", error);
    return res.status(500).json({ error: error.message });
  }
}
