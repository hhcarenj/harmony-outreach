/**
 * Weekly SC Outreach core logic (extracted so it can be reused by both
 * /api/cron/weekly-send and the merged /api/cron/run-all route).
 *
 * Pulls a batch of uncontacted SC contacts, sends the first email template via
 * Resend (branded signature), logs to sent_emails, and marks each contacted.
 */
import { createClient } from "@supabase/supabase-js";
import { renderEmailHtml, renderEmailText, resolveAppBaseUrl } from "./emailHtml";

// Plain-text fallback footer (mirrors the HTML signature for non-HTML mail clients).
const PLAIN_FOOTER = `Nate Ojugo (Admin Manager)
(609) 755-5593 | hhcare.nj@gmail.com | https://harmonycarenj.org/
Empowering Lives, Embracing Potential

To unsubscribe from future emails, reply with "unsubscribe" in the subject line.
Harmony Homecare Agency, LLC · 1852 Burlington Mt-Holly Road, Westampton, NJ 08060`;

const FROM_EMAIL = process.env.FROM_EMAIL || "outreach@harmonycarenj.org";
const BATCH_SIZE = parseInt(process.env.WEEKLY_BATCH_SIZE || "20", 10);
const DELAY_MS = 600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const personalize = (text, contact) =>
  (text || "")
    .replace(/\{\{agency_name\}\}/g, contact.agency_name || "your agency")
    .replace(/\{\{contact_name\}\}/g, contact.contact_name || "Support Coordinator")
    .replace(/\{\{email\}\}/g, contact.email || "");

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

// Re-exported for existing importers (run-all, weekly-send); defined in
// lib/emailHtml.js so every sender resolves the logo identically.
export { resolveLogoUrl } from "./emailHtml";

// Re-exported so existing importers keep working; the implementation now lives in
// lib/supabaseServer.js and prefers the service-role key (RLS requires auth).
export { serverSupabase } from "./supabaseServer";

/**
 * Send the weekly SC outreach batch.
 * @returns {Promise<{message:string, sent:number, total?:number, batchSize?:number, results?:Array}>}
 */
export async function runWeeklySend({ supabase, resendKey, logoUrl, from = FROM_EMAIL }) {
  // ── 1. First email template ──
  const { data: templates, error: templateError } = await supabase
    .from("email_templates")
    .select("*")
    .limit(1);

  if (templateError || !templates || templates.length === 0) {
    return { skipped: true, sent: 0, message: "No email templates found. Create one in the dashboard first." };
  }
  const template = templates[0];

  // ── 2. Uncontacted contacts with emails ──
  const { data: contacts, error: contactError } = await supabase
    .from("sc_contacts")
    .select("*")
    .eq("status", "new")
    .not("email", "is", null)
    .not("source", "eq", "test")
    .limit(BATCH_SIZE);

  if (contactError) {
    throw new Error("Failed to fetch contacts: " + contactError.message);
  }
  if (!contacts || contacts.length === 0) {
    return { sent: 0, total: 0, message: "No uncontacted contacts found with emails." };
  }

  // ── 3. Send ──
  const results = [];
  let successCount = 0;

  for (const contact of contacts) {
    const subject = personalize(template.subject, contact);
    const body = personalize(template.body, contact);
    const html = renderEmailHtml(body, { footerHtml: SIGNATURE_HTML(logoUrl) });
    const text = renderEmailText(body, PLAIN_FOOTER);

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [contact.email], subject, html, text }),
      });
      const data = await response.json();

      if (response.ok) {
        successCount++;
        await supabase.from("sent_emails").insert([{
          contact_id: contact.id,
          template_id: template.id,
          agency_name: contact.agency_name,
          to_email: contact.email,
          subject,
          status: "sent",
          resend_id: data.id,
        }]);
        await supabase
          .from("sc_contacts")
          .update({ status: "contacted", updated_at: new Date().toISOString() })
          .eq("id", contact.id);
        results.push({ agency: contact.agency_name, email: contact.email, status: "sent" });
      } else {
        results.push({ agency: contact.agency_name, email: contact.email, status: "failed", error: data.message });
      }
    } catch (err) {
      results.push({ agency: contact.agency_name, email: contact.email, status: "error", error: err.message });
    }

    await sleep(DELAY_MS);
  }

  return {
    message: `Weekly send complete: ${successCount} of ${contacts.length} emails sent.`,
    sent: successCount,
    total: contacts.length,
    batchSize: BATCH_SIZE,
    results,
  };
}
