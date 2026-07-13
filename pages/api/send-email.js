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

import { renderEmailHtml, renderEmailText, resolveAppBaseUrl } from "../../lib/emailHtml";

// Plain-text fallback footer (mirrors the HTML signature for non-HTML mail clients).
const PLAIN_FOOTER = `Nate Ojugo (Admin Manager)
(609) 755-5593 | hhcare.nj@gmail.com | https://harmonycarenj.org/
Empowering Lives, Embracing Potential

To unsubscribe from future emails, reply with "unsubscribe" in the subject line.
Harmony Homecare Agency, LLC · 1852 Burlington Mt-Holly Road, Westampton, NJ 08060`;

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

  // Build the logo URL — explicit env var first, else the stable production domain's
  // /logo.png (NOT process.env.VERCEL_URL, which is deployment-specific and gated
  // behind Vercel SSO for every URL except the production alias).
  const logoUrl = process.env.LOGO_URL || `${resolveAppBaseUrl()}/logo.png`;

  // Render body → email-safe HTML (preserves embedded <img>/HTML), plus a plain-text
  // fallback. Signature + CAN-SPAM footer are appended inside the HTML container.
  const html = renderEmailHtml(text, { footerHtml: SIGNATURE_HTML(logoUrl) });
  const plainText = renderEmailText(text, PLAIN_FOOTER);

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
        html,
        text: plainText,
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
