/**
 * DSP compliance rules — shared by the Care Management tab (client-side badges)
 * and the daily cron (/api/cron/run-all summary).
 *
 * Deliberately pure and dependency-free so the exact same thresholds drive the
 * in-app badge and the cron report — one source of truth, no drift.
 */

// Certification expirations we track. Each is optional per DSP — a null date
// means "not applicable to this employee", not "missing", so it never flags.
export const CERT_FIELDS = [
  { key: "hha_license_expiration", label: "HHA License" },
  { key: "cna_license_expiration", label: "CNA License" },
  { key: "cpr_license_expiration", label: "CPR Certification" },
  { key: "drivers_license_expiration", label: "Driver's License" },
];

// Onboarding steps that have a scheduled date and a completed date. Once the
// scheduled date passes with no completion recorded, the step is overdue.
export const CHECK_FIELDS = [
  { label: "Drug Screen", scheduled: "drug_screen_scheduled_date", completed: "drug_screen_completed_date" },
  { label: "Fingerprinting", scheduled: "fingerprint_scheduled_date", completed: "fingerprint_completed_date" },
  { label: "College of Direct Support", scheduled: "cds_scheduled_date", completed: "cds_completed_date" },
];

// A certification inside this window is "expiring soon" (yellow).
export const CERT_WARN_DAYS = 30;
// Grace period after a scheduled date before a missing completion escalates to red.
export const COMPLETION_GRACE_DAYS = 14;

/**
 * The only columns compliance actually reads. Use this for select() when you
 * just need badges/alerts — avoids pulling notes, address and the rest of the
 * DSP record across the wire.
 */
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

const SEVERITY_RANK = { green: 0, yellow: 1, red: 2 };

/**
 * Every compliance problem for one DSP.
 *
 * `severity` drives the badge color; `alert` marks the subset the spec wants
 * reported as notifications — certs expiring within 30 days (or already
 * expired), and completions more than 14 days past their scheduled date. A
 * step that is only a few days overdue shows yellow in the UI but is not yet
 * loud enough to be an alert.
 */
export function dspComplianceIssues(dsp) {
  if (!dsp) return [];
  const issues = [];

  for (const { key, label } of CERT_FIELDS) {
    const days = daysUntil(dsp[key]);
    if (days === null) continue;
    if (days < 0) {
      issues.push({ severity: "red", kind: "cert", field: key, label, alert: true,
        text: `${label} expired ${-days} day${-days === 1 ? "" : "s"} ago` });
    } else if (days <= CERT_WARN_DAYS) {
      issues.push({ severity: "yellow", kind: "cert", field: key, label, alert: true,
        text: `${label} expires in ${days} day${days === 1 ? "" : "s"}` });
    }
  }

  for (const { label, scheduled, completed } of CHECK_FIELDS) {
    if (dsp[completed]) continue;
    const overdueBy = daysSince(dsp[scheduled]);
    if (overdueBy === null || overdueBy < 0) continue; // never scheduled, or not due yet
    if (overdueBy > COMPLETION_GRACE_DAYS) {
      issues.push({ severity: "red", kind: "check", field: scheduled, label, alert: true,
        text: `${label} still not completed — ${overdueBy} days past its scheduled date` });
    } else {
      issues.push({ severity: "yellow", kind: "check", field: scheduled, label, alert: false,
        text: `${label} not completed — scheduled ${overdueBy === 0 ? "today" : `${overdueBy} day${overdueBy === 1 ? "" : "s"} ago`}` });
    }
  }

  return issues;
}

// Worst severity across a DSP's issues: "green" | "yellow" | "red".
export function complianceLevel(dsp) {
  return dspComplianceIssues(dsp).reduce(
    (worst, i) => (SEVERITY_RANK[i.severity] > SEVERITY_RANK[worst] ? i.severity : worst),
    "green"
  );
}

/**
 * Alert-worthy issues across a roster, one entry per affected DSP.
 * Inactive DSPs are skipped — an expired CPR card for someone who no longer
 * works here is not an action item.
 */
export function complianceAlerts(dsps) {
  return (dsps || [])
    .filter((d) => (d.status || "active") === "active")
    .map((d) => ({ id: d.id, name: d.name, issues: dspComplianceIssues(d).filter((i) => i.alert) }))
    .filter((entry) => entry.issues.length > 0)
    .sort((a, b) => b.issues.length - a.issues.length);
}

// Flat count of alert-worthy issues — used for the tab badge.
export function complianceAlertCount(dsps) {
  return complianceAlerts(dsps).reduce((n, e) => n + e.issues.length, 0);
}
