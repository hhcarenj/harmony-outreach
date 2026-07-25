/**
 * Server-side Supabase client.
 *
 * The dashboard is gated behind Supabase Auth and the CRM tables only grant
 * access to the `authenticated` role. Cron jobs and API routes have no logged-in
 * user, so they must use the SERVICE ROLE key, which bypasses RLS entirely.
 *
 * NEVER import this from browser code — the service role key is a full-access
 * secret. Browser code uses the anon key + the user's session instead.
 *
 * Falls back to the anon key when the service key isn't configured, so the app
 * keeps working before the key is added; `usingServiceRole()` lets routes report
 * which mode they're in.
 */
import { createClient } from "@supabase/supabase-js";

export function usingServiceRole() {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function serverSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    // No user session on the server — don't try to persist or refresh one.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
