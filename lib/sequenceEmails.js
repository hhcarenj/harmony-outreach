/**
 * Email Sequence content + scheduling logic.
 *
 * Shared by:
 *   - pages/api/send-sequence-email.js   (single-step send, dashboard / manual)
 *   - pages/api/cron/sequence-runner.js  (daily automated runner)
 *   - pages/index.js                     (UI uses SCHEDULE_OFFSETS + step metadata)
 *
 * Two sequences:
 *   A = 'post_visit'    — sent after an in-person visit
 *   B = 'cold_outreach' — sent to a newly added contact with no visit
 *
 * Merge tags supported in every subject/body: {{first_name}}, {{agency_name}}, {{visit_date}}
 */

// ── Day offsets from the anchor date (visit_date) for each step (1-indexed) ──
export const SCHEDULE_OFFSETS = {
  post_visit: [0, 3, 7, 14, 21], // Sequence A
  cold_outreach: [0, 4, 9, 16, 23], // Sequence B
};

export const SEQUENCE_LABEL = { post_visit: "A", cold_outreach: "B" };
export const TOTAL_STEPS = 5;

// ── Sequence A — post in-person visit ──
// V2 copy — transportation-as-pain-point through-line, CTA in steps 1 + 4, graceful close.
const SEQUENCE_A = [
  {
    subject: "Great connecting today",
    body: `Hi {{first_name}},

Really appreciate you taking the time to meet with me today. I know your schedule is packed, so it meant a lot.

I wanted to leave you with one thing: if you ever have a client where transportation is the blocker to getting ISS or CBS started, that's our sweet spot. We include transportation with every service — no separate authorization needed, no extra cost to the family.

If anyone on your caseload needs placement and you want a provider who can move quickly, I'd love the chance to help.

Talk soon,
Nate`,
  },
  {
    subject: "One thing I keep hearing from SCs",
    body: `Hi {{first_name}},

Since we met on {{visit_date}}, I've been thinking about something I hear from coordinators constantly — the hardest placements aren't the ones with complex needs. They're the ones where the family can't get the person to the program, or the provider keeps canceling because of logistics.

That's exactly why we built transportation into every service from day one. No separate van company, no missed pickups. We handle it.

If that ever matches a situation on your caseload, just send me a name. Even if you're not sure we're the right fit, I'm happy to talk it through.

Nate`,
  },
  {
    subject: "Something to pass along to families",
    body: `Hi {{first_name}},

I put together a plain-language guide for families navigating DDD services for the first time — what ISS, CBS, and Respite actually look like day-to-day, how funding works, and what to ask when choosing a provider.

It's not a Harmony sales pitch. It's genuinely useful whether they choose us or someone else. If you'd like a copy to share, just reply and I'll send it over.

And if any family wants to talk through their options directly, I'm happy to get on the phone with them. Sometimes a 10-minute conversation saves weeks of confusion.

Nate`,
  },
  {
    subject: "We have ISS and CBS availability right now",
    body: `Hi {{first_name}},

Quick note — we currently have availability for both ISS and CBS placements and can get started within days of receiving a referral, not weeks.

Here's what a referral to Harmony looks like in practice:

You send me the client's name and a good time to connect. I coordinate directly with the family, handle intake paperwork, and get services scheduled. Transportation is covered from day one. You get a responsive provider who keeps you updated without you having to chase us down.

If you have anyone who needs placement, reply here or call me at 609-755-5593. Even a "maybe" is worth a conversation.

Nate`,
  },
  {
    subject: "Whenever you need us",
    body: `Hi {{first_name}},

I don't want to crowd your inbox, so this will be my last note for now.

Harmony is here whenever you have a client who needs ISS, CBS, or Respite with a provider who includes transportation and actually picks up the phone. We serve all of New Jersey and accept private pay alongside DDD.

Thank you for the time you gave me at {{agency_name}} on {{visit_date}}. It meant a lot, and I hope we get the chance to work together.

Whenever a placement comes up that fits, you know where to find me.

With care,
Nate`,
  },
];

// ── Sequence B — cold outreach ──
// V2 copy — leads with value not credentials, transportation-as-pain-point through-line.
const SEQUENCE_B = [
  {
    subject: "Quick question about your caseload",
    body: `Hi {{first_name}},

If you have a client in New Jersey who needs ISS or CBS placement with transportation included, I can have services started within days.

My name is Nate Ojugo. I run Harmony Homecare Agency — we're a DDD-approved provider in Burlington County offering Individual Support Services, Community-Based Supports, and Respite Care. Every service includes transportation at no extra cost.

I'm reaching out because I'd love to build a relationship with {{agency_name}}. We're actively accepting new clients and want to be a resource for SCs who need a responsive placement option.

Would a 10-minute call make sense? I'm at 609-755-5593 or you can reply here.

Nate`,
  },
  {
    subject: "The placement problem no one talks about",
    body: `Hi {{first_name}},

I wanted to follow up with something I keep running into: families who qualify for DDD services but can't find a provider who handles transportation. The authorization is there, the funding is there, but the client can't physically get to their program. So nothing happens.

That's the gap Harmony was built to close. We include transportation with every ISS, CBS, and Respite placement. It's not an add-on. It's how we operate.

If that ever matches a situation on your caseload — even if you're not sure about the details — just send me a name and I'll take it from there.

Nate`,
  },
  {
    subject: "Something useful for your families",
    body: `Hi {{first_name}},

I put together a plain-language guide for families navigating DDD services — what ISS, CBS, and Respite actually look like, how funding works, and what to ask when evaluating a provider.

It's designed to be useful regardless of which provider the family chooses. If you'd like a copy to share with families who are new to the system, reply and I'll send it over.

And if a family wants to talk through their options, I'm happy to get on a call with them directly. Sometimes hearing it from someone other than their coordinator takes the pressure off.

Nate`,
  },
  {
    subject: "Do you have a client who needs placement?",
    body: `Hi {{first_name}},

I've sent a couple of notes, so I'll be direct: do you currently have any clients who need ISS, CBS, or Respite placement?

We have availability right now and can move quickly. Here's what working with Harmony looks like:

You send me the client's name and contact. I handle outreach to the family, intake paperwork, and scheduling. Transportation is built in from day one. I keep you in the loop without you having to follow up with me.

If you have someone in mind, reply here or call 609-755-5593. If the timing isn't right, no pressure at all. I just wanted to ask directly.

Nate`,
  },
  {
    subject: "Last note for now",
    body: `Hi {{first_name}},

I respect your time and your inbox, so this will be my last email for now.

Harmony Homecare is a DDD-approved provider in Burlington County offering ISS, CBS, and Respite Care — all with transportation included. We serve clients throughout New Jersey and accept private pay alongside DDD.

Whenever a placement comes up and you need a provider who responds fast and follows through, I hope you'll think of us. You can always reach me at 609-755-5593 or outreach@harmonycarenj.org.

Thank you for what you do for your clients. It doesn't go unnoticed.

With care,
Nate`,
  },
];

export const SEQUENCES = {
  post_visit: SEQUENCE_A,
  cold_outreach: SEQUENCE_B,
};

// Lightweight subject list for the UI (no need to ship full bodies to the client).
export const STEP_SUBJECTS = {
  post_visit: SEQUENCE_A.map((s) => s.subject),
  cold_outreach: SEQUENCE_B.map((s) => s.subject),
};

// ── Date helpers ──
// Work in plain YYYY-MM-DD strings to avoid timezone drift on `date` columns.
export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// next_send_date for a given 1-indexed step, anchored on visit_date.
export function sendDateForStep(sequenceType, visitDate, step) {
  const offsets = SCHEDULE_OFFSETS[sequenceType] || SCHEDULE_OFFSETS.post_visit;
  const offset = offsets[step - 1];
  if (offset == null) return null;
  return addDays(visitDate, offset);
}

function formatVisitDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Falls back to the organization name when there's no personal contact name on file,
// so the greeting never shows a blank or a literal merge tag.
function firstNameOf(contactName, agencyName) {
  const n = (contactName || "").trim();
  if (n) return n.split(/\s+/)[0];
  const a = (agencyName || "").trim();
  if (a) return `${a} Team`;
  return "there";
}

export function personalize(text, seq) {
  return (text || "")
    .replace(/\{\{first_name\}\}/g, firstNameOf(seq.contact_name, seq.agency_name))
    .replace(/\{\{agency_name\}\}/g, seq.agency_name || "your agency")
    .replace(/\{\{visit_date\}\}/g, formatVisitDate(seq.visit_date));
}

// Returns { subject, body } for a sequence row at its current step (1-indexed).
export function renderStep(seq, step) {
  const steps = SEQUENCES[seq.sequence_type] || SEQUENCES.post_visit;
  const tpl = steps[step - 1];
  if (!tpl) return null;
  return {
    subject: personalize(tpl.subject, seq),
    body: personalize(tpl.body, seq),
  };
}

// ── HTML rendering (auto-appended signature + CAN-SPAM compliant footer) ──
// V2 bodies sign off minimally ("Nate"), so the full identity block — name, agency,
// phone, email, website, tagline — is appended automatically here, followed by the
// legally required physical address + unsubscribe notice (CLAUDE.md requirement).
// NOTE: the wrapping <div> uses white-space:pre-line, which already renders \n as a
// line break and \n\n as a blank line — do NOT also inject <br/> tags here, that
// double-counts every line break and inflates paragraph spacing.
function textToHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1155cc;">$1</a>');
}

const SIGNATURE_FOOTER = `
<div style="margin-top:24px; padding-top:16px; border-top:1px solid #ddd; font-family:Arial,Helvetica,sans-serif; font-size:14px; color:#333; line-height:1.5;">
  <p style="margin:0 0 2px 0;"><strong>Nate Ojugo</strong></p>
  <p style="margin:0 0 2px 0;">Harmony Homecare Agency, LLC</p>
  <p style="margin:0 0 2px 0;">609-755-5593 | <a href="mailto:outreach@harmonycarenj.org" style="color:#1155cc; text-decoration:none;">outreach@harmonycarenj.org</a></p>
  <p style="margin:0 0 10px 0;"><a href="https://harmonycarenj.org" style="color:#1155cc; text-decoration:none;">harmonycarenj.org</a></p>
  <p style="margin:0; font-style:italic; color:#555;">&ldquo;Care That Keeps People Moving.&rdquo;</p>
</div>`;

const CANSPAM_FOOTER = `
<div style="margin-top:12px; padding-top:12px; border-top:1px solid #eee; font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#999; line-height:1.5;">
  To unsubscribe from future emails, reply with &ldquo;unsubscribe&rdquo; in the subject line.<br/>
  Harmony Homecare Agency, LLC &middot; 1852 Burlington Mt-Holly Road, Westampton, NJ 08060
</div>`;

export function buildHtml(bodyText) {
  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,Helvetica,sans-serif; font-size:14px; color:#333; line-height:1.6; max-width:600px;">
  <div style="white-space:pre-line;">
${textToHtml(bodyText)}
  </div>
  ${SIGNATURE_FOOTER}
  ${CANSPAM_FOOTER}
</body>
</html>`;
}

/**
 * Server-side: render + send a single sequence step via Resend.
 * MUST only be called from API routes (keeps RESEND_API_KEY server-side).
 *
 * @param override Optional { subject, body } to use instead of the default
 *   template (already merge-filled) — used for per-contact email overrides.
 * @returns {Promise<{ok:boolean, subject:string, resendId?:string, error?:string}>}
 */
export async function sendSequenceStep({ resendKey, from, seq, step, override }) {
  // Use the per-contact override if supplied, otherwise the default template.
  const rendered = override
    ? { subject: personalize(override.subject, seq), body: personalize(override.body, seq) }
    : renderStep(seq, step);
  if (!rendered) return { ok: false, subject: "", error: `No step ${step} for ${seq.sequence_type}` };
  if (!resendKey) {
    console.error("[sequence-send] RESEND_API_KEY is missing from the server environment");
    return { ok: false, subject: rendered.subject, error: "RESEND_API_KEY is not configured on the server." };
  }
  if (!seq.contact_email) {
    console.error(`[sequence-send] sequence ${seq.id} has no contact_email`);
    return { ok: false, subject: rendered.subject, error: "Missing contact_email" };
  }

  const html = buildHtml(rendered.body);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from, // expected: outreach@harmonycarenj.org
        to: [seq.contact_email],
        subject: rendered.subject,
        html,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error(`[sequence-send] Resend API error for ${seq.contact_email} (step ${step}):`, data);
      return { ok: false, subject: rendered.subject, error: data.message || data.error || "Resend API error" };
    }
    return { ok: true, subject: rendered.subject, resendId: data.id };
  } catch (err) {
    console.error(`[sequence-send] network/exception sending to ${seq.contact_email}:`, err);
    return { ok: false, subject: rendered.subject, error: err.message };
  }
}
