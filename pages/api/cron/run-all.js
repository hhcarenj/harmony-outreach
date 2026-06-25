/**
 * Unified daily cron — runs both outreach jobs in sequence.
 *
 *   1. Weekly SC outreach batch  (lib/weeklySend.js)
 *   2. Sequence email sender     (lib/sequenceRunner.js — sends every due step)
 *
 * Scheduled daily in vercel.json (replaces the separate weekly-send +
 * sequence-runner cron entries).
 *
 * Cadence note: the sequence sender is meant to run daily. The weekly SC
 * outreach is NOT — to preserve its original weekly cadence it only runs on
 * WEEKLY_SEND_DOW (default Monday, UTC). Set WEEKLY_SEND_DOW=-1 to run it every
 * day, or pass ?force_weekly=1 (manual) to force it for testing.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. The dashboard
 * sends `x-manual-trigger: 1` (RLS is fully open on this project).
 */
import { runWeeklySend, serverSupabase, resolveLogoUrl } from "../../../lib/weeklySend";
import { runDueSequences } from "../../../lib/sequenceRunner";

const FROM_EMAIL = process.env.FROM_EMAIL || "outreach@harmonycarenj.org";
const WEEKLY_SEND_DOW = parseInt(process.env.WEEKLY_SEND_DOW || "1", 10); // 0=Sun … 1=Mon

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

  const supabase = serverSupabase();
  const forceWeekly = isManual && req.query.force_weekly === "1";
  const isWeeklyDay = WEEKLY_SEND_DOW < 0 || new Date().getUTCDay() === WEEKLY_SEND_DOW;

  const summary = { weekly: null, sequences: null };

  try {
    // ── 1. Weekly SC outreach (gated to its weekday) ──
    if (isWeeklyDay || forceWeekly) {
      summary.weekly = await runWeeklySend({ supabase, resendKey, logoUrl: resolveLogoUrl() });
    } else {
      summary.weekly = { skipped: true, sent: 0, message: `Weekly send skipped — only runs on day-of-week ${WEEKLY_SEND_DOW} (UTC).` };
    }

    // ── 2. Sequence emails (every day) ──
    summary.sequences = await runDueSequences({ supabase, resendKey, from: FROM_EMAIL });

    const weeklySent = summary.weekly?.sent || 0;
    const seqSent = summary.sequences?.sent || 0;
    return res.status(200).json({
      message: `run-all complete: ${weeklySent} weekly + ${seqSent} sequence email(s) sent.`,
      ...summary,
    });
  } catch (err) {
    console.error("run-all error:", err);
    return res.status(500).json({ error: err.message, partial: summary });
  }
}
