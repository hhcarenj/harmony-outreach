/**
 * DSP compliance rules — shared by the Care Management tab (client-side badges)
 * and the daily cron (/api/cron/run-all summary).
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * A DSP is COMPLIANT if and only if they have COMPLETED both:
 *   1. their drug screen, and
 *   2. their fingerprinting.
 *
 * Everything else is ADVISORY: it flags the DSP as higher-risk (a small red
 * tag) but does NOT make them non-compliant. That covers College of Direct
 * Support and any lapsed/expiring certification.
 *
 * Note this is about COMPLETION, not scheduling. A brand-new DSP with nothing
 * booked yet is NOT compliant — "no drug screen on file" is exactly the state
 * this is meant to surface. Scheduled dates only sharpen the wording ("12 days
 * past its scheduled date" vs "not scheduled yet").
 *
 * Deliberately pure and dependency-free so the same rules drive the in-app
 * badge and the cron report — one source of truth, no drift.
 */

// ── Hard requirements: these two decide compliant vs not compliant ──
export const REQUIRED_CHECKS = [
  { label: "Drug Screen", scheduled: "drug_screen_scheduled_date", completed: "drug_screen_completed_date" },
  { label: "Fingerprinting", scheduled: "fingerprint_scheduled_date", completed: "fingerprint_completed_date" },
];

// ── Advisory: incomplete flags the DSP as high-risk but keeps them compliant ──
export const ADVISORY_CHECKS = [
  { label: "College of Direct Support", scheduled: "cds_scheduled_date", completed: "cds_completed_date" },
];

// Combined, for anything that just displays every onboarding step in order.
export const CHECK_FIELDS = [...REQUIRED_CHECKS, ...ADVISORY_CHECKS];

// Certification expirations — advisory. Each is optional per DSP; a null date
// means "not applicable to this employee", not "missing", so it never flags.
export const CERT_FIELDS = [
  { key: "hha_license_expiration", label: "HHA License" },
  { key: "cna_license_expiration", label: "CNA License" },
  { key: "cpr_license_expiration", label: "CPR Certification" },
  { key: "drivers_license_expiration", label: "Driver's License" },
];

// A certification inside this window is "expiring soon" (amber).
export const CERT_WARN_DAYS = 30;

// Compliance states, worst first.
export const NOT_COMPLIANT = "not_compliant"; // missing a hard requirement
export const FLAGGED = "flagged";             // compliant, but high-risk advisories
export const COMPLIANT = "compliant";         // clean

// Columns the rules actually read — use for select() when you only need
// badges/alerts, instead of pulling the whole DSP record.
export const COMPLIANCE_COLUMNS = [
  "id", "name", "status",
  ...CERT_FIELDS.map((f) => f.key),
  ...CHECK_FIELDS.flatMap((f) => [f.scheduled, f.completed]),
].join(", ");

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Whole days from today until `dateStr` (negative = in the past). Null if unset
// or unparseable, which callers treat as "not tracked".
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const now = Date.parse(`${todayISO()}T00:00:00Z`);
  return Math.round((target - now) / 86400000);
}

// Days elapsed since `dateStr` (negative = still in the future).
export function daysSince(dateStr) {
  const n = daysUntil(dateStr);
  return n === null ? null : -n;
}

const plural = (n) => (n === 1 ? "" : "s");

// Wording for an incomplete step, sharpened by its scheduled date if there is one.
function describeIncomplete(dsp, check) {
  const past = daysSince(dsp[check.scheduled]);
  if (past === null) return `${check.label} not completed — nothing scheduled yet`;
  if (past < 0) return `${check.label} not completed — scheduled for ${dsp[check.scheduled]}`;
  if (past === 0) return `${check.label} not completed — scheduled today`;
  return `${check.label} not completed — ${past} day${plural(past)} past its scheduled date`;
}

/** True only when every hard requirement is completed. */
export function isCompliant(dsp) {
  return REQUIRED_CHECKS.every((c) => !!dsp?.[c.completed]);
}

/**
 * Every compliance problem for one DSP.
 *
 * `blocking: true` means it breaks compliance (a missing hard requirement).
 * `blocking: false` is advisory — the small red/amber tag. `alert` marks what
 * the cron and banner report; a certification that is merely approaching
 * expiry still alerts, since renewals need lead time.
 */
export function dspComplianceIssues(dsp) {
  if (!dsp) return [];
  const issues = [];

  // 1. Hard requirements — not completed means not compliant, full stop.
  for (const check of REQUIRED_CHECKS) {
    if (dsp[check.completed]) continue;
    issues.push({
      severity: "red", blocking: true, alert: true, kind: "required",
      label: check.label, field: check.completed,
      text: describeIncomplete(dsp, check),
    });
  }

  // 2. Advisory training — high-risk flag, still compliant.
  for (const check of ADVISORY_CHECKS) {
    if (dsp[check.completed]) continue;
    issues.push({
      severity: "red", blocking: false, alert: true, kind: "training",
      label: check.label, field: check.completed,
      text: `${describeIncomplete(dsp, check)} (high risk)`,
    });
  }

  // 3. Advisory certifications.
  for (const { key, label } of CERT_FIELDS) {
    const days = daysUntil(dsp[key]);
    if (days === null) continue;
    if (days < 0) {
      issues.push({
        severity: "red", blocking: false, alert: true, kind: "cert",
        label, field: key,
        text: `${label} expired ${-days} day${plural(-days)} ago`,
      });
    } else if (days <= CERT_WARN_DAYS) {
      issues.push({
        severity: "yellow", blocking: false, alert: true, kind: "cert",
        label, field: key,
        text: `${label} expires in ${days} day${plural(days)}`,
      });
    }
  }

  return issues;
}

/** NOT_COMPLIANT | FLAGGED | COMPLIANT */
export function complianceStatus(dsp) {
  if (!isCompliant(dsp)) return NOT_COMPLIANT;
  return dspComplianceIssues(dsp).some((i) => !i.blocking) ? FLAGGED : COMPLIANT;
}

/** Advisory-only issues — what the small red tag counts. */
export function advisoryIssues(dsp) {
  return dspComplianceIssues(dsp).filter((i) => !i.blocking);
}

/**
 * Alert-worthy issues across a roster, one entry per affected DSP, with the
 * non-compliant ones first. Inactive DSPs are skipped — an expired CPR card for
 * someone who no longer works here is not an action item.
 */
export function complianceAlerts(dsps) {
  return (dsps || [])
    .filter((d) => (d.status || "active") === "active")
    .map((d) => ({
      id: d.id,
      name: d.name,
      compliant: isCompliant(d),
      issues: dspComplianceIssues(d).filter((i) => i.alert),
    }))
    .filter((entry) => entry.issues.length > 0)
    .sort((a, b) => (a.compliant === b.compliant ? b.issues.length - a.issues.length : a.compliant ? 1 : -1));
}

// Flat count of alert-worthy issues — used for the tab badge.
export function complianceAlertCount(dsps) {
  return complianceAlerts(dsps).reduce((n, e) => n + e.issues.length, 0);
}

// Count of active DSPs who are outright non-compliant.
export function nonCompliantCount(dsps) {
  return (dsps || []).filter((d) => (d.status || "active") === "active" && !isCompliant(d)).length;
}
