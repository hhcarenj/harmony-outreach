/**
 * Weekly SC Outreach core logic (extracted so it can be reused by both
 * /api/cron/weekly-send and the merged /api/cron/run-all route).
 *
 * Pulls a batch of uncontacted SC contacts, sends the first email template via
 * Resend (branded signature), logs to sent_emails, and marks each contacted.
 */
import { createClient } from "@supabase/supabase-js";

const FROM_EMAIL = process.env.FROM_EMAIL || "outreach@harmonycarenj.org";
const BATCH_SIZE = parseInt(process.env.WEEKLY_BATCH_SIZE || "20", 10);
const DELAY_MS = 600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const personalize = (text, contact) =>
  (text || "")
    .replace(/\{\{agency_name\}\}/g, contact.agency_name || "your agency")
    .replace(/\{\{contact_name\}\}/g, contact.contact_name || "Support Coordinator")
    .replace(/\{\{email\}\}/g, contact.email || "");

function textToHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>\n")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1155cc;">$1</a>');
}

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

function buildHtmlEmail(text, logoUrl) {
  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,Helvetica,sans-serif; font-size:14px; color:#333; line-height:1.6; max-width:600px;">
  <div style="white-space:pre-line;">
${textToHtml(text)}
  </div>
  ${SIGNATURE_HTML(logoUrl)}
</body>
</html>`;
}

// Builds the logo URL from env (mirrors the original route behaviour).
export function resolveLogoUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  return (
    process.env.LOGO_URL ||
    (appUrl ? `https://${appUrl.replace(/^https?:\/\//, "")}/logo.png` : "")
  );
}

// Convenience: create a Supabase client from server env.
export function serverSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

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
    const text = personalize(template.body, contact);
    const html = buildHtmlEmail(text, logoUrl);

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [contact.email], subject, html }),
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
