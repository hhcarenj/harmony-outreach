/**
 * Send a single sequence step for one email_sequences row, then advance it.
 *
 * POST body: { sequenceId: "<uuid>" }
 *
 * Keeps the Resend API key server-side. The sequence's current_step is sent,
 * logged to sent_emails, and the row is advanced (or completed).
 */
import { createClient } from "@supabase/supabase-js";
import { processOne } from "../../lib/sequenceRunner";

const FROM_EMAIL = process.env.FROM_EMAIL || "outreach@harmonycarenj.org";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { sequenceId } = req.body || {};
  if (!sequenceId) {
    return res.status(400).json({ error: "Missing required field: sequenceId" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Supabase env vars are not configured on the server." });
  }
  if (!resendKey) {
    return res.status(500).json({ error: "RESEND_API_KEY is not configured on the server." });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: seq, error } = await supabase
    .from("email_sequences")
    .select("*")
    .eq("id", sequenceId)
    .single();

  if (error || !seq) {
    return res.status(404).json({ error: "Sequence not found: " + (error?.message || sequenceId) });
  }

  const result = await processOne({ supabase, resendKey, from: FROM_EMAIL, seq });

  if (result.status === "failed") {
    return res.status(502).json({ error: result.error, result });
  }
  return res.status(200).json({ result });
}
