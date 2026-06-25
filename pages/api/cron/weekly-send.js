/**
 * Weekly SC Outreach endpoint.
 *
 * NOTE: As of the cron merge, the scheduled job lives at /api/cron/run-all.
 * This route is kept callable for manual/standalone use. Core logic lives in
 * ../../../lib/weeklySend.js so it can be shared with run-all.
 *
 * Env: RESEND_API_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *      CRON_SECRET (optional), FROM_EMAIL, WEEKLY_BATCH_SIZE (optional)
 */
import { runWeeklySend, serverSupabase, resolveLogoUrl } from "../../../lib/weeklySend";

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  const cronSecret = process.env.CRON_SECRET;
  const isManual = req.headers["x-manual-trigger"] === "1";

  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !isManual) {
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

  try {
    const result = await runWeeklySend({
      supabase: serverSupabase(),
      resendKey,
      logoUrl: resolveLogoUrl(),
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("weekly-send error:", err);
    return res.status(500).json({ error: err.message });
  }
}
