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
const SEQUENCE_A = [
  {
    subject: "Great meeting you today",
    body: `Hi {{first_name}},

It was great stopping by today and introducing myself.

I'm Nate with Harmony Home Care Agency — a DDD approved provider based right here in Westampton, Burlington County. We offer Individual Support Services, Community Based Supports, and Respite Care for adults with IDD, with transportation included as part of our service delivery.

If you have any clients who are looking for a responsive, experienced agency in Burlington County — we'd love to be a resource for you and your team.

I'll follow up in a few days with something I think your clients' families will find genuinely helpful.

With care,
Harmony Home Care Agency
609-755-5593 | outreach@harmonycarenj.org | harmonycarenj.org
Care That Keeps People Moving.`,
  },
  {
    subject: "A free resource for families navigating DDD services",
    body: `Hi {{first_name}},

I wanted to share something that might be useful for the families you work with.

We put together a plain-language guide to navigating DDD services in New Jersey — what families need to know about ISS, CBS, and Respite Care, how funding works, and what to look for when choosing a provider.

Feel free to share it with any families who are still figuring out the system. No catch.

We're always happy to answer questions for families directly too — just pass along our number if it's easier.

With care,
Harmony Home Care Agency
609-755-5593 | outreach@harmonycarenj.org`,
  },
  {
    subject: "What Harmony covers — quick overview",
    body: `Hi {{first_name}},

I wanted to make sure you have a clear picture of everything Harmony covers — so when the right client comes along, you know exactly what we can offer.

Individual Support Services (ISS) — One on one in-home support for daily living, skill development, and personal care. Transportation to appointments and errands included.

Community Based Supports (CBS) — Community integration, social connection, and skill building out in the community. Transportation included.

Respite Care — Temporary relief for family caregivers who need a break.

We serve Burlington County and all of New Jersey. We also welcome private pay clients.

If you have a client who might be a fit — even if you're not sure — feel free to reach out and we'll figure it out together.

With care,
Harmony Home Care Agency
609-755-5593 | outreach@harmonycarenj.org`,
  },
  {
    subject: "Checking in — any clients who could use support?",
    body: `Hi {{first_name}},

I've reached out a couple of times and wanted to check in one more time.

We currently have availability in Burlington County and are actively accepting new clients for ISS, CBS, and Respite Care.

If you have any clients whose needs align with what we offer — or families who've been asking about options — we're ready to move quickly and make the process as smooth as possible for everyone involved.

Just reply to this email or call us directly at 609-755-5593.

With care,
Harmony Home Care Agency
609-755-5593 | outreach@harmonycarenj.org`,
  },
  {
    subject: "Still here when you need us",
    body: `Hi {{first_name}},

This will be my last note for a while — I don't want to crowd your inbox.

I just wanted to say that Harmony Home Care is here whenever you need us. Whether it's a client who needs ISS, a family exhausted from caregiving who needs respite, or just a question about what we cover — we're always a call or email away.

Thank you for your time.

With care,
Harmony Home Care Agency
609-755-5593 | outreach@harmonycarenj.org | harmonycarenj.org
Care That Keeps People Moving.`,
  },
];

// ── Sequence B — cold outreach ──
const SEQUENCE_B = [
  {
    subject: "DDD approved home care provider — Burlington County",
    body: `Hi {{first_name}},

My name is Nate Ojugo and I'm reaching out from Harmony Home Care Agency — a DDD approved home and community based services provider based in Westampton, Burlington County, NJ.

We provide three DDD funded services for adults with intellectual and developmental disabilities:

Individual Support Services (ISS) — in-home one on one support with transportation included
Community Based Supports (CBS) — community integration and skill building with transportation included
Respite Care — temporary relief for family caregivers

We're actively accepting new clients in Burlington County and all of New Jersey, and we're looking to build relationships with support coordinators who serve the IDD population in our area.

If you have clients who need placement — or families asking about options — we'd love to be a resource for you.

With care,
Harmony Home Care Agency
609-755-5593 | outreach@harmonycarenj.org | harmonycarenj.org
Care That Keeps People Moving.`,
  },
  {
    subject: "A free resource for families navigating DDD in NJ",
    body: `Hi {{first_name}},

I wanted to follow up with something that might be useful for the families on your caseload.

We put together a plain-language guide to navigating DDD services in New Jersey — covering ISS, CBS, and Respite Care, how funding works, and what families should look for when choosing a provider.

Feel free to share it with anyone who could use it. No catch.

If a family has questions about what Harmony specifically offers — we're always happy to speak with them directly.

With care,
Harmony Home Care Agency
609-755-5593 | outreach@harmonycarenj.org`,
  },
  {
    subject: "Exactly what Harmony covers — quick reference",
    body: `Hi {{first_name}},

I wanted to make this as easy as possible for you — so here's exactly what Harmony Home Care offers and who we serve.

Individual Support Services (ISS): One on one in-home support for daily living, skill development, and personal care. Transportation included.

Community Based Supports (CBS): Community integration, social connection, and independence building. Transportation included throughout Burlington County and surrounding areas.

Respite Care: Temporary, professional caregiver relief for families who need a break.

Who we serve: Adults with intellectual and developmental disabilities enrolled with NJ DDD. We also accept private pay clients.

Where we serve: Burlington County and all of New Jersey.

If you have a client who might be a fit — just reach out. We'll figure it out together.

With care,
Harmony Home Care Agency
609-755-5593 | outreach@harmonycarenj.org`,
  },
  {
    subject: "Do you have clients who need placement right now?",
    body: `Hi {{first_name}},

I've sent a couple of notes and wanted to ask directly —

Do you currently have any clients who need placement for ISS, CBS, or Respite Care in Burlington County or surrounding areas?

We have availability right now and can move quickly to make the process smooth for both the family and your team.

A quick reply or a call to 609-755-5593 is all it takes to get the conversation started.

With care,
Harmony Home Care Agency
609-755-5593 | outreach@harmonycarenj.org`,
  },
  {
    subject: "Last note for now — Harmony Home Care",
    body: `Hi {{first_name}},

This is my last note for a while — I respect your time and your inbox.

Harmony Home Care is here whenever you need us — a DDD approved agency built right here in Burlington County, committed to being the kind of partner that support coordinators can count on.

Thank you for your time. We hope to work together soon.

With care,
Harmony Home Care Agency
609-755-5593 | outreach@harmonycarenj.org | harmonycarenj.org
Care That Keeps People Moving.`,
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

function firstNameOf(contactName) {
  const n = (contactName || "").trim();
  if (!n) return "there";
  return n.split(/\s+/)[0];
}

export function personalize(text, seq) {
  return (text || "")
    .replace(/\{\{first_name\}\}/g, firstNameOf(seq.contact_name))
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

// ── HTML rendering (CAN-SPAM compliant footer) ──
// The sequence bodies already sign off as "Harmony Home Care Agency", so we do NOT
// append the full Nate signature block — only the legally required address +
// unsubscribe notice (CLAUDE.md: every email must include physical address + unsubscribe).
function textToHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>\n")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1155cc;">$1</a>');
}

const CANSPAM_FOOTER = `
<div style="margin-top:24px; padding-top:12px; border-top:1px solid #eee; font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#999; line-height:1.5;">
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
  ${CANSPAM_FOOTER}
</body>
</html>`;
}

/**
 * Server-side: render + send a single sequence step via Resend.
 * MUST only be called from API routes (keeps RESEND_API_KEY server-side).
 *
 * @returns {Promise<{ok:boolean, subject:string, resendId?:string, error?:string}>}
 */
export async function sendSequenceStep({ resendKey, from, seq, step }) {
  const rendered = renderStep(seq, step);
  if (!rendered) return { ok: false, subject: "", error: `No step ${step} for ${seq.sequence_type}` };
  if (!seq.contact_email) return { ok: false, subject: rendered.subject, error: "Missing contact_email" };

  const html = buildHtml(rendered.body);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [seq.contact_email],
        subject: rendered.subject,
        html,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { ok: false, subject: rendered.subject, error: data.message || "Resend API error" };
    }
    return { ok: true, subject: rendered.subject, resendId: data.id };
  } catch (err) {
    return { ok: false, subject: rendered.subject, error: err.message };
  }
}
