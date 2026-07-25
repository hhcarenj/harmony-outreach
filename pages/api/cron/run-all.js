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
 * Auth: see lib/apiAuth.js — Vercel Cron's CRON_SECRET, or a signed-in staff
 * member's Supabase token. Fails closed; CRON_SECRET is REQUIRED for scheduled runs.
 */
import { runWeeklySend, resolveLogoUrl } from "../../../lib/weeklySend";
import { runDueSequences } from "../../../lib/sequenceRunner";
import { complianceAlerts } from "../../../lib/compliance";
import { serverSupabase, usingServiceRole } from "../../../lib/supabaseServer";
import { authorizeJob } from "../../../lib/apiAuth";

const FROM_EMAIL = process.env.FROM_EMAIL || "outreach@harmonycarenj.org";
const WEEKLY_SEND_DOW = parseInt(process.env.WEEKLY_SEND_DOW || "1", 10); // 0=Sun … 1=Mon

// Reads the DSP roster and returns the alert-worthy compliance issues. A failure
// here must not fail the whole cron — the email jobs above already ran.
async function runComplianceCheck(supabase) {
  const { data, error } = await supabase.from("dsps").select("*");
  if (error) return { error: error.message, alert_count: 0, dsps_flagged: 0, alerts: [] };
  const alerts = complianceAlerts(data || []);
  return {
    checked: (data || []).length,
    dsps_flagged: alerts.length,
    alert_count: alerts.reduce((n, e) => n + e.issues.length, 0),
    alerts: alerts.map((e) => ({ name: e.name, issues: e.issues.map((i) => i.text) })),
  };
}

export default async function handler(req, res) {
  const auth = await authorizeJob(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  const isManual = auth.via === "staff";

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

  const summary = { weekly: null, sequences: null, compliance: null };

  try {
    // ── 1. Weekly SC outreach (gated to its weekday) ──
    if (isWeeklyDay || forceWeekly) {
      summary.weekly = await runWeeklySend({ supabase, resendKey, logoUrl: resolveLogoUrl() });
    } else {
      summary.weekly = { skipped: true, sent: 0, message: `Weekly send skipped — only runs on day-of-week ${WEEKLY_SEND_DOW} (UTC).` };
    }

    // ── 2. Sequence emails (every day) ──
    summary.sequences = await runDueSequences({ supabase, resendKey, from: FROM_EMAIL });

    // ── 3. DSP compliance sweep (read-only) ──
    // No emails yet — this just reports the same alerts the Care Management tab
    // shows, so the daily cron log surfaces expiring certs and overdue onboarding
    // steps. Uses lib/compliance so the thresholds can't drift from the UI.
    summary.compliance = await runComplianceCheck(supabase);

    const weeklySent = summary.weekly?.sent || 0;
    const seqSent = summary.sequences?.sent || 0;
    const flagged = summary.compliance?.alert_count || 0;
    return res.status(200).json({
      message: `run-all complete: ${weeklySent} weekly + ${seqSent} sequence email(s) sent. ${flagged} DSP compliance item(s) flagged.`,
      // CRM tables are authenticated-only; without the service-role key this cron
      // has no DB access and every step silently reads zero rows.
      auth_mode: usingServiceRole() ? "service_role" : "anon (SUPABASE_SERVICE_ROLE_KEY not set)",
      ...summary,
    });
  } catch (err) {
    console.error("run-all error:", err);
    return res.status(500).json({ error: err.message, partial: summary });
  }
}
