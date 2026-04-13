/**
 * Weekly SC Outreach Cron Job
 *
 * Runs automatically on a schedule defined in vercel.json.
 * Every week it:
 *   1. Pulls a batch of uncontacted SC contacts (with emails) from Supabase
 *   2. Sends personalized HTML emails via Resend with branded signature
 *   3. Logs each send to sent_emails
 *   4. Updates each contact's status to "contacted"
 *
 * Required environment variables (set in Vercel → Settings → Environment Variables):
 *   RESEND_API_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, CRON_SECRET,
 *   FROM_EMAIL, WEEKLY_BATCH_SIZE (optional, default 20)
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

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  if (!supabaseUrl || !supabaseKey || !resendKey) {
    return res.status(500).json({
      error: "Missing environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, or RESEND_API_KEY",
    });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Logo URL
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  const logoUrl = process.env.LOGO_URL
    || (appUrl ? `https://${appUrl.replace(/^https?:\/\//, "")}/logo.png` : "");

  // ── 1. Get the first email template ──
  const { data: templates, error: templateError } = await supabase
    .from("email_templates")
    .select("*")
    .limit(1);

  if (templateError || !templates || templates.length === 0) {
    return res.status(500).json({ error: "No email templates found. Create one in the dashboard first." });
  }

  const template = templates[0];

  // ── 2. Get uncontacted contacts with emails ──
  const { data: contacts, error: contactError } = await supabase
    .from("sc_contacts")
    .select("*")
    .eq("status", "new")
    .not("email", "is", null)
    .not("source", "eq", "test")
    .limit(BATCH_SIZE);

  if (contactError) {
    return res.status(500).json({ error: "Failed to fetch contacts: " + contactError.message });
  }

  if (!contacts || contacts.length === 0) {
    return res.status(200).json({
      message: "No uncontacted contacts found with emails. All done or no new contacts loaded.",
      sent: 0,
    });
  }

  // ── 3. Send emails ──
  const results = [];
  let successCount = 0;

  for (const contact of contacts) {
    const subject = personalize(template.subject, contact);
    const text = personalize(template.body, contact);
    const html = buildHtmlEmail(text, logoUrl);

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [contact.email],
          subject,
          html,
        }),
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

  return res.status(200).json({
    message: `Weekly send complete: ${successCount} of ${contacts.length} emails sent.`,
    sent: successCount,
    total: contacts.length,
    batchSize: BATCH_SIZE,
    results,
  });
}
