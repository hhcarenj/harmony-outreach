/**
 * Authorization for the email-sending job routes.
 *
 * These endpoints send real outreach mail to hundreds of contacts, so an
 * unauthenticated caller can burn the Resend quota and the domain's sending
 * reputation. They previously accepted a plain `x-manual-trigger: 1` header,
 * which any stranger could send — effectively making them public.
 *
 * Two legitimate callers, both proving identity with a real secret:
 *   1. Vercel Cron  → `Authorization: Bearer <CRON_SECRET>` (Vercel injects this
 *      automatically when CRON_SECRET is set on the project).
 *   2. A signed-in staff member clicking "Run now" in the dashboard →
 *      `Authorization: Bearer <supabase access token>`, which is then verified
 *      against Supabase AND checked against the app_staff allowlist.
 *
 * Fails CLOSED: if CRON_SECRET is unset, cron requests are rejected rather than
 * waved through. That matches Vercel's documented pattern
 * (https://vercel.com/docs/cron-jobs/manage-cron-jobs) and means a
 * misconfiguration stops the job loudly instead of leaving it open to everyone.
 */
import { serverSupabase } from "./supabaseServer";

export async function authorizeJob(req) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const cronSecret = process.env.CRON_SECRET;

  if (!token) {
    return { ok: false, status: 401, error: "Missing Authorization header." };
  }

  // 1. Vercel Cron.
  if (cronSecret && token === cronSecret) {
    return { ok: true, via: "cron" };
  }

  // 2. Staff member's Supabase session. Verified server-side — a forged or
  //    expired token fails here, and a valid login still needs an app_staff row.
  const supabase = serverSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (!error && data?.user) {
    const { data: staff } = await supabase
      .from("app_staff")
      .select("user_id")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (staff) return { ok: true, via: "staff", email: data.user.email };
    return { ok: false, status: 403, error: "Signed in, but not an authorized staff account." };
  }

  if (!cronSecret) {
    // Most likely cause of a failed scheduled run — say so plainly so it shows
    // up in the cron log instead of looking like a silent no-op.
    console.error("authorizeJob: CRON_SECRET is not set on this deployment; Vercel Cron cannot authenticate.");
    return { ok: false, status: 401, error: "Unauthorized. CRON_SECRET is not configured on this deployment." };
  }

  return { ok: false, status: 401, error: "Unauthorized." };
}
