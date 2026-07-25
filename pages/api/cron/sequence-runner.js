/**
 * Daily Sequence Runner Cron Job
 *
 * Scheduled in vercel.json. Each run:
 *   1. Finds active email_sequences where next_send_date <= today
 *   2. Sends the current step via Resend (CAN-SPAM footer included)
 *   3. Logs each send to sent_emails
 *   4. Advances current_step / next_send_date (or marks the sequence completed)
 *
 * Auth: see lib/apiAuth.js — Vercel Cron's CRON_SECRET, or a signed-in staff
 * member's Supabase token. Fails closed.
 *
 * Env: RESEND_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      CRON_SECRET (REQUIRED — scheduled runs 401 without it), FROM_EMAIL (optional)
 */
import { runDueSequences } from "../../../lib/sequenceRunner";
import { serverSupabase } from "../../../lib/supabaseServer";
import { authorizeJob } from "../../../lib/apiAuth";

const FROM_EMAIL = process.env.FROM_EMAIL || "outreach@harmonycarenj.org";

export default async function handler(req, res) {
  const auth = await authorizeJob(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  if (!supabaseUrl || !supabaseKey || !resendKey) {
    return res.status(500).json({
      error: "Missing env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, or RESEND_API_KEY",
    });
  }

  const supabase = serverSupabase();

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
