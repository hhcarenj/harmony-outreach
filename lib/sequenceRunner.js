/**
 * Server-side sequence processing: send the due step, log it, and advance the row.
 * Used by both /api/send-sequence-email and /api/cron/sequence-runner.
 *
 * Pass an already-constructed @supabase/supabase-js client (anon key is fine — RLS is open).
 */
import { sendSequenceStep, sendDateForStep, todayISO, TOTAL_STEPS } from "./sequenceEmails";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Process a single sequence row: send its current step, log to sent_emails, advance.
 * Only sends when status === 'active'. Returns a result summary.
 */
export async function processOne({ supabase, resendKey, from, seq }) {
  if (seq.status !== "active") {
    return { id: seq.id, agency: seq.agency_name, status: "skipped", reason: `status=${seq.status}` };
  }

  const step = seq.current_step;

  // Fix 5: per-contact email override takes precedence over the default template.
  let override = null;
  const { data: overrideRows } = await supabase
    .from("sequence_email_overrides")
    .select("custom_subject, custom_body")
    .eq("contact_id", seq.contact_id)
    .eq("sequence_type", seq.sequence_type)
    .eq("step_number", step)
    .limit(1);
  if (overrideRows && overrideRows.length > 0) {
    override = { subject: overrideRows[0].custom_subject, body: overrideRows[0].custom_body };
  }

  const sent = await sendSequenceStep({ resendKey, from, seq, step, override });

  if (!sent.ok) {
    console.error(`[sequence-runner] failed to send step ${step} for sequence ${seq.id} (${seq.contact_email}): ${sent.error}`);
    return { id: seq.id, agency: seq.agency_name, email: seq.contact_email, status: "failed", step, error: sent.error };
  }

  // Log to the shared sent_emails audit table.
  await supabase.from("sent_emails").insert([
    {
      contact_id: seq.contact_id,
      agency_name: seq.agency_name,
      to_email: seq.contact_email,
      subject: sent.subject,
      status: "sent",
      resend_id: sent.resendId,
    },
  ]);

  // Advance the sequence.
  let update;
  if (step >= TOTAL_STEPS) {
    update = { status: "completed", completed_at: new Date().toISOString(), next_send_date: null };
  } else {
    const nextStep = step + 1;
    update = { current_step: nextStep, next_send_date: sendDateForStep(seq.sequence_type, seq.visit_date, nextStep) };
  }
  await supabase.from("email_sequences").update(update).eq("id", seq.id);

  return {
    id: seq.id,
    agency: seq.agency_name,
    email: seq.contact_email,
    status: "sent",
    step,
    subject: sent.subject,
    completed: step >= TOTAL_STEPS,
  };
}

/**
 * Find every active sequence whose next_send_date is due (<= today) and process each.
 */
export async function runDueSequences({ supabase, resendKey, from }) {
  const today = todayISO();
  const { data: due, error } = await supabase
    .from("email_sequences")
    .select("*")
    .eq("status", "active")
    .not("next_send_date", "is", null)
    .lte("next_send_date", today);

  if (error) throw new Error(error.message);

  const results = [];
  for (const seq of due || []) {
    results.push(await processOne({ supabase, resendKey, from, seq }));
    await sleep(500); // gentle pacing between sends
  }

  const sentCount = results.filter((r) => r.status === "sent").length;
  return { date: today, due: (due || []).length, sent: sentCount, results };
}
