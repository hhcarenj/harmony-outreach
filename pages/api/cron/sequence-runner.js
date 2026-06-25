/**
 * Daily Sequence Runner Cron Job
 *
 * Scheduled in vercel.json. Each run:
 *   1. Finds active email_sequences where next_send_date <= today
 *   2. Sends the current step via Resend (CAN-SPAM footer included)
 *   3. Logs each send to sent_emails
 *   4. Advances current_step / next_send_date (or marks the sequence completed)
 *
 * Auth:
 *   - Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
 *   - The dashboard "Run sequence check" button sends `x-manual-trigger: 1`
 *     (RLS is already fully open on this project, so this matches its trust model).
 *
 * Env: RESEND_API_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *      CRON_SECRET (optional), FROM_EMAIL (optional)
 */
import { createClient } from "@supabase/supabase-js";
import { runDueSequences } from "../../../lib/sequenceRunner";

const FROM_EMAIL = process.env.FROM_EMAIL || "outreach@harmonycarenj.org";

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers["authorization"];
  const isManual = req.headers["x-manual-trigger"] === "1";

  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !isManual) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  if (!supabaseUrl || !supabaseKey || !resendKey) {
    return res.status(500).json({
      error: "Missing env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, or RESEND_API_KEY",
    });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const summary = await runDueSequences({ supabase, resendKey, from: FROM_EMAIL });
    return res.status(200).json({
      message: `Sequence check complete: ${summary.sent} of ${summary.due} due email(s) sent.`,
      ...summary,
    });
  } catch (err) {
    console.error("sequence-runner error:", err);
    return res.status(500).json({ error: err.message });
  }
}
