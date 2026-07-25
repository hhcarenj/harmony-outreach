import { useState, useEffect, useCallback, useMemo } from "react";
import {
  cardStyle, inputStyle, btnPrimary, btnSecondary, pillToggle, fieldLabel, Toast, Modal,
  formatPhone, showPhone,
} from "./ui";
import {
  CERT_FIELDS, CHECK_FIELDS, REQUIRED_CHECKS, ADVISORY_CHECKS, CERT_WARN_DAYS,
  dspComplianceIssues, advisoryIssues, complianceStatus, isCompliant,
  complianceAlerts, complianceAlertCount, nonCompliantCount,
  COMPLIANT, FLAGGED, NOT_COMPLIANT,
  daysUntil, daysSince, todayISO,
} from "../lib/compliance";

// ── Constants ──
const CLIENT_STATUSES = ["active", "inactive", "discharged"];
const DSP_STATUSES = ["active", "inactive"];
const SEX_OPTIONS = ["Male", "Female", "Other"];

const STATUS_COLOR = {
  active: "#22c55e",
  inactive: "#6b7280",
  discharged: "#ef4444",
  ended: "#6b7280",
};
// Severity colors for individual issue lines.
const LEVEL_COLOR = { green: "#22c55e", yellow: "#f59e0b", red: "#ef4444" };

// Badge appearance per compliance state. "Flagged" still reads as compliant —
// green — because drug screen and fingerprinting are done; the high-risk
// advisories ride alongside as a small red tag.
const STATUS_STYLE = {
  [COMPLIANT]: { label: "Compliant", color: "#22c55e", dot: "●" },
  [FLAGGED]: { label: "Compliant", color: "#22c55e", dot: "●" },
  [NOT_COMPLIANT]: { label: "Not compliant", color: "#ef4444", dot: "■" },
};

const emptyClient = {
  name: "", address: "", age: "", sex: "", phone_number: "", date_service_started: "",
  sc_name: "", sc_agency: "", sc_email: "", sc_phone: "", sc_contact_id: "",
  status: "active", notes: "",
};

const emptyDsp = {
  name: "", phone_number: "", email: "", sex: "", address: "", hire_date: "", status: "active",
  drug_screen_scheduled_date: "", drug_screen_completed_date: "",
  fingerprint_scheduled_date: "", fingerprint_completed_date: "",
  cds_scheduled_date: "", cds_completed_date: "",
  medication_training_completed: false,
  hha_license_expiration: "", cna_license_expiration: "", cpr_license_expiration: "",
  drivers_license_expiration: "",
  notes: "",
};

// ── Form <-> row conversion ──
// Postgres nulls become "" so inputs stay controlled; "" becomes null on save so
// we never write empty strings into date/integer columns.
function toForm(row, empty) {
  const f = { ...empty };
  Object.keys(empty).forEach((k) => {
    const v = row?.[k];
    f[k] = v === null || v === undefined ? empty[k] : v;
  });
  return f;
}

const blankToNull = (v) => (typeof v === "string" && v.trim() === "" ? null : v);

function buildPayload(form, empty) {
  const p = {};
  Object.keys(empty).forEach((k) => { p[k] = blankToNull(form[k]); });
  p.name = (form.name || "").trim();
  return p;
}

function clientPayload(form) {
  const p = buildPayload(form, emptyClient);
  const age = parseInt(form.age, 10);
  p.age = Number.isNaN(age) ? null : age;
  return p;
}

function dspPayload(form) {
  const p = buildPayload(form, emptyDsp);
  p.medication_training_completed = !!form.medication_training_completed;
  return p;
}

// ── Small presentational helpers ──
function Badge({ text, color, title, onClick }) {
  return (
    <span
      title={title}
      onClick={onClick}
      style={{
        display: "inline-block", padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700,
        background: color + "22", color, border: `1px solid ${color}33`, whiteSpace: "nowrap",
        textTransform: "capitalize", cursor: onClick ? "pointer" : "default",
      }}
    >
      {text}
    </span>
  );
}

function StatusBadge({ status, fallback = "active" }) {
  const s = status || fallback;
  return <Badge text={s} color={STATUS_COLOR[s] || "#6b7280"} />;
}

/**
 * Compliance at a glance.
 *
 * Two independent signals, deliberately not merged into one colour:
 *   · the main badge = compliant or not (drug screen + fingerprinting only)
 *   · the small red tag = high-risk advisories (CDS outstanding, cert lapsing)
 *
 * So a DSP can read "Compliant ⚑2" — cleared to work, but needs chasing.
 */
function ComplianceBadge({ dsp, onClick }) {
  const status = complianceStatus(dsp);
  const style = STATUS_STYLE[status];
  const blocking = dspComplianceIssues(dsp).filter((i) => i.blocking);
  const advisories = advisoryIssues(dsp);

  const tooltip = [
    ...blocking.map((i) => `✕ ${i.text}`),
    ...advisories.map((i) => `⚑ ${i.text}`),
  ].join("\n") || "Drug screen and fingerprinting complete — no advisories";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }} title={tooltip}>
      <Badge
        text={`${style.dot} ${style.label}${blocking.length ? ` (${blocking.length})` : ""}`}
        color={style.color}
        onClick={onClick}
      />
      {advisories.length > 0 && (
        <span
          onClick={onClick}
          style={{
            display: "inline-block", padding: "2px 7px", borderRadius: 99, fontSize: 10, fontWeight: 800,
            background: "#ef444422", color: "#ef4444", border: "1px solid #ef444455",
            cursor: onClick ? "pointer" : "default",
          }}
        >
          ⚑ {advisories.length}
        </span>
      )}
    </span>
  );
}

const dash = <span style={{ color: "#475569", fontSize: 12 }}>—</span>;
const cell = { padding: "12px 14px", color: "#94a3b8", fontSize: 13 };
const th = { textAlign: "left", padding: "10px 14px", color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, borderBottom: "1px solid #1e293b", whiteSpace: "nowrap" };
const rowBtn = { background: "none", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", fontSize: 12, padding: "4px 12px", cursor: "pointer", transition: "all 0.2s" };

function durationLabel(days) {
  if (days === null || days === undefined) return "—";
  if (days <= 0) return "today";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} months`;
  return `${Math.floor(months / 12)} yr ${months % 12} mo`;
}

// Colors a certification date by how close it is to expiring.
function certColor(dateStr) {
  const d = daysUntil(dateStr);
  if (d === null) return "#475569";
  if (d < 0) return LEVEL_COLOR.red;
  if (d <= CERT_WARN_DAYS) return LEVEL_COLOR.yellow;
  return "#94a3b8";
}

// ── Care Management Tab ──
export default function CareManagementTab({ supabase, onAlertCount }) {
  const [subView, setSubView] = useState("clients");
  const [clients, setClients] = useState([]);
  const [dsps, setDsps] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [scContacts, setScContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [toast, setToast] = useState("");
  const [alertsOpen, setAlertsOpen] = useState(false);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 4000); };

  // Clients sub-view
  const [clientSearch, setClientSearch] = useState("");
  const [clientStatusFilter, setClientStatusFilter] = useState("all");
  const [clientForm, setClientForm] = useState(null); // null = form closed
  const [editingClientId, setEditingClientId] = useState(null);
  const [scSearch, setScSearch] = useState("");
  const [assignPick, setAssignPick] = useState("");
  const [assignSearch, setAssignSearch] = useState("");
  const [detailClientId, setDetailClientId] = useState(null);

  // DSPs sub-view
  const [dspSearch, setDspSearch] = useState("");
  const [dspStatusFilter, setDspStatusFilter] = useState("all");
  const [dspForm, setDspForm] = useState(null);
  const [editingDspId, setEditingDspId] = useState(null);
  const [detailDspId, setDetailDspId] = useState(null);

  // Relationships sub-view
  const [relSearch, setRelSearch] = useState("");
  const [quickClient, setQuickClient] = useState("");
  const [quickDsp, setQuickDsp] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [c, d, a, sc] = await Promise.all([
      supabase.from("clients").select("*").order("name"),
      supabase.from("dsps").select("*").order("name"),
      supabase.from("client_dsp_assignments").select("*").order("assigned_date", { ascending: false }),
    ]);
    const err = c.error || d.error || a.error;
    if (err) {
      setLoadError(err.message || JSON.stringify(err));
    } else {
      setClients(c.data || []);
      setDsps(d.data || []);
      setAssignments(a.data || []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // The SC directory is ~750 rows and feeds one optional dropdown inside the
  // client form. Loading it up front cost a full table scan on every visit to
  // this tab, including the many that never open the form — so it's fetched on
  // first form open instead, and cached for the rest of the session.
  const loadScContacts = useCallback(async () => {
    if (scContacts.length) return;
    const { data } = await supabase
      .from("sc_contacts")
      .select("id, agency_name, contact_name, email, phone")
      .order("agency_name");
    setScContacts(data || []);
  }, [supabase, scContacts.length]);

  // Keep the tab badge in sync after any DSP edit.
  useEffect(() => {
    if (onAlertCount) onAlertCount(complianceAlertCount(dsps));
  }, [dsps, onAlertCount]);

  // ── Derived lookups ──
  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
  const dspById = useMemo(() => Object.fromEntries(dsps.map((d) => [d.id, d])), [dsps]);
  const activeAssignments = useMemo(() => assignments.filter((a) => a.status === "active"), [assignments]);

  const assignmentsByClient = useMemo(() => {
    const m = {};
    activeAssignments.forEach((a) => { (m[a.client_id] = m[a.client_id] || []).push(a); });
    return m;
  }, [activeAssignments]);

  const assignmentsByDsp = useMemo(() => {
    const m = {};
    activeAssignments.forEach((a) => { (m[a.dsp_id] = m[a.dsp_id] || []).push(a); });
    return m;
  }, [activeAssignments]);

  const alerts = useMemo(() => complianceAlerts(dsps), [dsps]);
  const notCompliant = useMemo(() => nonCompliantCount(dsps), [dsps]);
  const alertCount = alerts.reduce((n, e) => n + e.issues.length, 0);

  // ── Client mutations ──
  const openAddClient = () => {
    setClientForm({ ...emptyClient });
    setEditingClientId(null);
    setScSearch("");
    loadScContacts();
  };
  const openEditClient = (c) => {
    setClientForm(toForm(c, emptyClient));
    setEditingClientId(c.id);
    setScSearch("");
    setAssignPick("");
    setAssignSearch("");
    loadScContacts();
  };
  const closeClientForm = () => { setClientForm(null); setEditingClientId(null); };

  const saveClient = async () => {
    const payload = clientPayload(clientForm);
    if (!payload.name) return;
    const { error } = editingClientId
      ? await supabase.from("clients").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", editingClientId)
      : await supabase.from("clients").insert([payload]);
    if (error) { alert("Could not save client: " + error.message); return; }
    showToast(`${payload.name} ${editingClientId ? "updated" : "added"}`);
    closeClientForm();
    loadAll();
  };

  const deleteClient = async (id) => {
    const c = clientById[id];
    if (!confirm(`Delete ${c?.name || "this client"} permanently? Their DSP assignment history will be removed too.`)) return;
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) { alert("Could not delete client: " + error.message); return; }
    if (editingClientId === id) closeClientForm();
    if (detailClientId === id) setDetailClientId(null);
    showToast(`${c?.name || "Client"} deleted`);
    loadAll();
  };

  // Picking an existing SC from the outreach CRM copies their details across, so
  // the client record stays readable even if the link is later cleared.
  const linkScContact = (id) => {
    const sc = scContacts.find((s) => s.id === id);
    if (!sc) { setClientForm((f) => ({ ...f, sc_contact_id: "" })); return; }
    setClientForm((f) => ({
      ...f,
      sc_contact_id: sc.id,
      sc_name: sc.contact_name || f.sc_name,
      sc_agency: sc.agency_name || f.sc_agency,
      sc_email: sc.email || f.sc_email,
      sc_phone: sc.phone || f.sc_phone,
    }));
  };

  // ── DSP mutations ──
  const openAddDsp = () => { setDspForm({ ...emptyDsp }); setEditingDspId(null); };
  const openEditDsp = (d) => { setDspForm(toForm(d, emptyDsp)); setEditingDspId(d.id); };
  const closeDspForm = () => { setDspForm(null); setEditingDspId(null); };

  const saveDsp = async () => {
    const payload = dspPayload(dspForm);
    if (!payload.name) return;
    const { error } = editingDspId
      ? await supabase.from("dsps").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", editingDspId)
      : await supabase.from("dsps").insert([payload]);
    if (error) { alert("Could not save DSP: " + error.message); return; }
    showToast(`${payload.name} ${editingDspId ? "updated" : "added"}`);
    closeDspForm();
    loadAll();
  };

  const deleteDsp = async (id) => {
    const d = dspById[id];
    if (!confirm(`Delete ${d?.name || "this DSP"} permanently? Their client assignment history will be removed too.`)) return;
    const { error } = await supabase.from("dsps").delete().eq("id", id);
    if (error) { alert("Could not delete DSP: " + error.message); return; }
    if (editingDspId === id) closeDspForm();
    if (detailDspId === id) setDetailDspId(null);
    showToast(`${d?.name || "DSP"} deleted`);
    loadAll();
  };

  // ── Assignment mutations ──
  const assignDsp = async (clientId, dspId) => {
    if (!clientId || !dspId) return;
    // The DB has a partial unique index on (client_id, dsp_id) WHERE status='active';
    // this check just turns that constraint into a friendly message.
    if (activeAssignments.some((a) => a.client_id === clientId && a.dsp_id === dspId)) {
      showToast(`${dspById[dspId]?.name || "That DSP"} is already assigned to this client`);
      return;
    }
    const { error } = await supabase.from("client_dsp_assignments").insert([{
      client_id: clientId, dsp_id: dspId, assigned_date: todayISO(), status: "active",
    }]);
    if (error) { alert("Could not assign DSP: " + error.message); return; }
    showToast(`${dspById[dspId]?.name || "DSP"} assigned to ${clientById[clientId]?.name || "client"}`);
    loadAll();
  };

  const endAssignment = async (assignment) => {
    const who = `${dspById[assignment.dsp_id]?.name || "DSP"} → ${clientById[assignment.client_id]?.name || "client"}`;
    if (!confirm(`End the assignment ${who}? It stays in the history with today's end date.`)) return;
    const { error } = await supabase.from("client_dsp_assignments")
      .update({ status: "ended", end_date: todayISO() })
      .eq("id", assignment.id);
    if (error) { alert("Could not end assignment: " + error.message); return; }
    showToast(`Assignment ended — ${who}`);
    loadAll();
  };

  // ── Reusable form bits ──
  // `format` normalizes on every keystroke — used for phone fields.
  const textField = (form, setForm, key, label, type = "text", format) => (
    <div key={key}>
      {fieldLabel(label)}
      <input
        type={type}
        value={form[key] ?? ""}
        onChange={(e) => setForm({ ...form, [key]: format ? format(e.target.value) : e.target.value })}
        placeholder={type === "text" ? (format === formatPhone ? "(609)555-0143" : label) : undefined}
        style={inputStyle}
      />
    </div>
  );

  const selectField = (form, setForm, key, label, options, { includeBlank = false } = {}) => (
    <div key={key}>
      {fieldLabel(label)}
      <select
        value={form[key] ?? ""}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        style={{ ...inputStyle, cursor: "pointer", textTransform: "capitalize" }}
      >
        {includeBlank && <option value="">—</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  const grid = (children, min = 200) => (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12, marginBottom: 12 }}>
      {children}
    </div>
  );

  const formSection = (title, children) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid #1e293b" }}>
        {title}
      </div>
      {children}
    </div>
  );

  const detailRow = (label, value) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "7px 0", borderBottom: "1px solid #1e293b" }}>
      <span style={{ color: "#64748b", fontSize: 12 }}>{label}</span>
      <span style={{ color: "#e2e8f0", fontSize: 13, textAlign: "right", wordBreak: "break-word" }}>{value || "—"}</span>
    </div>
  );

  const emptyState = (icon, title, hint) => (
    <div style={{ ...cardStyle, textAlign: "center", padding: 48, color: "#64748b" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
      <p style={{ fontSize: 16, color: "#94a3b8", marginBottom: 8 }}>{title}</p>
      <p style={{ fontSize: 13, margin: 0 }}>{hint}</p>
    </div>
  );

  // ── Compliance banner ──
  const renderAlertBanner = () => {
    if (!alerts.length) return null;
    // Collapsed shows the summary line ONLY — the whole point is to get the
    // banner out of the way. Expanding reveals every DSP and every issue.
    return (
      <div style={{ ...cardStyle, padding: alertsOpen ? 16 : "10px 16px", marginBottom: 16, borderColor: "#f59e0b55", transition: "padding 0.15s" }}>
        <div
          onClick={() => setAlertsOpen((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAlertsOpen((v) => !v); } }}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", cursor: "pointer" }}
        >
          <div style={{ color: notCompliant ? "#f87171" : "#fbbf24", fontSize: 14, fontWeight: 700 }}>
            <span style={{ display: "inline-block", width: 14, color: "#64748b", transform: alertsOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
            {notCompliant > 0
              ? `■ ${notCompliant} DSP${notCompliant === 1 ? "" : "s"} not compliant`
              : `⚑ ${alertCount} item${alertCount === 1 ? "" : "s"} flagged`}
            <span style={{ color: "#64748b", fontWeight: 500 }}>
              {" · "}{alertCount} item{alertCount === 1 ? "" : "s"} across {alerts.length} DSP{alerts.length === 1 ? "" : "s"}
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setAlertsOpen((v) => !v); }}
            style={{ ...btnSecondary, padding: "4px 12px", fontSize: 12 }}
          >
            {alertsOpen ? "Collapse" : "Expand"}
          </button>
        </div>

        {alertsOpen && (
          <div style={{ marginTop: 12 }}>
            {alerts.map((entry) => (
              <div key={entry.id} style={{ padding: "8px 0", borderTop: "1px solid #1e293b" }}>
                <button
                  onClick={() => { setSubView("dsps"); setDetailDspId(entry.id); }}
                  style={{ background: "none", border: "none", padding: 0, color: "#e2e8f0", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left" }}
                >
                  {entry.name}
                  {!entry.compliant && (
                    <span style={{ color: "#f87171", fontWeight: 800, marginLeft: 8, fontSize: 11 }}>NOT COMPLIANT</span>
                  )}
                </button>
                {entry.issues.map((issue, i) => (
                  <div key={i} style={{ color: LEVEL_COLOR[issue.severity], fontSize: 12, marginTop: 3 }}>
                    {issue.blocking ? "✕" : "⚑"} {issue.text}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Sub-view A: Clients ──
  const filteredClients = clients.filter((c) => {
    const q = clientSearch.toLowerCase();
    const matchesSearch = !q || [c.name, c.phone_number, c.address, c.sc_name, c.sc_agency]
      .some((f) => (f || "").toLowerCase().includes(q));
    const matchesStatus = clientStatusFilter === "all" || (c.status || "active") === clientStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const renderClientForm = () => (
    <div style={{ ...cardStyle, marginBottom: 20, borderColor: "#6366f155" }}>
      <h3 style={{ color: "#a78bfa", fontSize: 14, fontWeight: 700, margin: "0 0 16px" }}>
        {editingClientId ? "Edit Client" : "Add Client"}
      </h3>

      {formSection("Client Details", (
        <>
          {grid([
            textField(clientForm, setClientForm, "name", "Full Name"),
            textField(clientForm, setClientForm, "phone_number", "Phone Number", "text", formatPhone),
            textField(clientForm, setClientForm, "age", "Age", "number"),
            selectField(clientForm, setClientForm, "sex", "Sex", SEX_OPTIONS, { includeBlank: true }),
            textField(clientForm, setClientForm, "date_service_started", "Date Service Started", "date"),
            selectField(clientForm, setClientForm, "status", "Status", CLIENT_STATUSES),
          ])}
          {grid([textField(clientForm, setClientForm, "address", "Address")], 400)}
        </>
      ))}

      {formSection("Support Coordinator", (
        <>
          <div style={{ marginBottom: 12 }}>
            {fieldLabel("Link to an SC already in the Outreach CRM (optional)")}
            <input
              placeholder="Search outreach contacts…"
              value={scSearch}
              onChange={(e) => setScSearch(e.target.value)}
              style={{ ...inputStyle, marginBottom: 6 }}
            />
            <select value={clientForm.sc_contact_id || ""} onChange={(e) => linkScContact(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
              <option value="">Not linked — enter SC details manually below</option>
              {scContacts
                .filter((s) => {
                  const q = scSearch.toLowerCase();
                  return !q || `${s.contact_name || ""} ${s.agency_name || ""}`.toLowerCase().includes(q);
                })
                .slice(0, 100)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.contact_name ? `${s.contact_name} — ${s.agency_name}` : s.agency_name}
                  </option>
                ))}
            </select>
          </div>
          {grid([
            textField(clientForm, setClientForm, "sc_name", "SC Name"),
            textField(clientForm, setClientForm, "sc_agency", "SC Agency"),
            textField(clientForm, setClientForm, "sc_email", "SC Email"),
            textField(clientForm, setClientForm, "sc_phone", "SC Phone", "text", formatPhone),
          ])}
        </>
      ))}

      {/* Assignments are rows in their own table, so they can only be edited on a
          client that already exists — hence this block is edit-mode only. */}
      {editingClientId && formSection("Assigned DSPs", (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {(assignmentsByClient[editingClientId] || []).length === 0
              ? <span style={{ color: "#475569", fontSize: 13 }}>No DSPs assigned yet.</span>
              : assignmentsByClient[editingClientId].map((a) => (
                <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600, background: "#0ea5e922", color: "#7dd3fc", border: "1px solid #0ea5e933" }}>
                  {dspById[a.dsp_id]?.name || "Unknown DSP"}
                  <button onClick={() => endAssignment(a)} title="End this assignment" style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
                </span>
              ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
            <div>
              {fieldLabel("Search DSPs")}
              <input placeholder="Search by name…" value={assignSearch} onChange={(e) => setAssignSearch(e.target.value)} style={inputStyle} />
            </div>
            <div>
              {fieldLabel("Assign DSP")}
              <select value={assignPick} onChange={(e) => setAssignPick(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                <option value="">Select a DSP…</option>
                {dsps
                  .filter((d) => (d.status || "active") === "active")
                  .filter((d) => !activeAssignments.some((a) => a.client_id === editingClientId && a.dsp_id === d.id))
                  .filter((d) => !assignSearch || (d.name || "").toLowerCase().includes(assignSearch.toLowerCase()))
                  .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <button
              disabled={!assignPick}
              onClick={async () => { await assignDsp(editingClientId, assignPick); setAssignPick(""); setAssignSearch(""); }}
              style={{ ...btnSecondary, opacity: assignPick ? 1 : 0.4, cursor: assignPick ? "pointer" : "not-allowed" }}
            >
              + Assign
            </button>
          </div>
        </>
      ))}

      {formSection("Notes", (
        <textarea
          value={clientForm.notes || ""}
          onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })}
          rows={3}
          placeholder="Care notes, preferences, household details…"
          style={{ ...inputStyle, resize: "vertical" }}
        />
      ))}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={saveClient}
          disabled={!clientForm.name.trim()}
          style={{ ...btnPrimary, opacity: clientForm.name.trim() ? 1 : 0.4, cursor: clientForm.name.trim() ? "pointer" : "not-allowed" }}
        >
          {editingClientId ? "Save Changes" : "Save Client"}
        </button>
        <button onClick={closeClientForm} style={btnSecondary}>Cancel</button>
        {editingClientId && (
          <button onClick={() => deleteClient(editingClientId)} style={{ ...btnSecondary, color: "#f87171", borderColor: "#f8717133", marginLeft: "auto" }}>
            Delete Client
          </button>
        )}
      </div>
    </div>
  );

  const renderClients = () => (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
          {clients.length} total · {filteredClients.length} shown · {activeAssignments.length} active assignment{activeAssignments.length === 1 ? "" : "s"}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Search clients, SCs, addresses…" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} style={{ ...inputStyle, width: 260 }} />
          <select value={clientStatusFilter} onChange={(e) => setClientStatusFilter(e.target.value)} style={{ ...inputStyle, width: "auto", cursor: "pointer", textTransform: "capitalize" }}>
            <option value="all">All statuses</option>
            {CLIENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={openAddClient} style={btnPrimary}>+ Add Client</button>
        </div>
      </div>

      {clientForm && renderClientForm()}

      {filteredClients.length === 0 ? (
        emptyState("🧑‍🦽", "No clients found", clients.length ? "Try a different search or filter." : "Add your first client to get started.")
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>{["Client", "Age / Sex", "Phone", "Address", "Started", "Assigned DSPs", "Support Coordinator", "Status", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filteredClients.map((c) => {
                const mine = assignmentsByClient[c.id] || [];
                return (
                  <tr key={c.id} style={{ borderBottom: "1px solid #1e293b" }}>
                    <td style={{ ...cell, color: "#e2e8f0", fontWeight: 600 }}>
                      <button onClick={() => setDetailClientId(c.id)} title="View full detail" style={{ background: "none", border: "none", padding: 0, color: "#e2e8f0", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                        {c.name}
                      </button>
                    </td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>{c.age || "—"}{c.sex ? ` · ${c.sex}` : ""}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>{showPhone(c.phone_number) || "—"}</td>
                    <td style={{ ...cell, fontSize: 12, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.address || "—"}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>{c.date_service_started || "—"}</td>
                    <td style={{ ...cell }}>
                      {mine.length === 0 ? dash : (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {mine.map((a) => {
                            const d = dspById[a.dsp_id];
                            return (
                              <span key={a.id} onClick={() => d && setDetailDspId(d.id)} title={d ? "View DSP" : ""}
                                style={{ display: "inline-block", padding: "3px 9px", borderRadius: 99, fontSize: 11, fontWeight: 700, background: "#0ea5e922", color: "#7dd3fc", border: "1px solid #0ea5e933", cursor: d ? "pointer" : "default", whiteSpace: "nowrap" }}>
                                {d?.name || "Unknown"}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td style={{ ...cell, fontSize: 12 }}>
                      {c.sc_name || c.sc_agency ? (
                        <>
                          <div style={{ color: "#e2e8f0" }}>{c.sc_name || "—"}</div>
                          <div style={{ color: "#64748b" }}>{c.sc_agency || ""}</div>
                        </>
                      ) : dash}
                    </td>
                    <td style={{ padding: "12px 14px" }}><StatusBadge status={c.status} /></td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => openEditClient(c)} style={rowBtn}>Edit</button>
                        <button onClick={() => deleteClient(c.id)} style={rowBtn}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ── Sub-view B: DSPs ──
  const filteredDsps = dsps.filter((d) => {
    const q = dspSearch.toLowerCase();
    const matchesSearch = !q || [d.name, d.email, d.phone_number].some((f) => (f || "").toLowerCase().includes(q));
    const matchesStatus =
      dspStatusFilter === "all" ? true
        : dspStatusFilter === "not_compliant" ? !isCompliant(d)
        : dspStatusFilter === "needs_attention" ? complianceStatus(d) !== COMPLIANT
        : (d.status || "active") === dspStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const renderDspForm = () => (
    <div style={{ ...cardStyle, marginBottom: 20, borderColor: "#6366f155" }}>
      <h3 style={{ color: "#a78bfa", fontSize: 14, fontWeight: 700, margin: "0 0 16px" }}>
        {editingDspId ? "Edit DSP" : "Add DSP"}
      </h3>

      {formSection("Basic Info", (
        <>
          {grid([
            textField(dspForm, setDspForm, "name", "Full Name"),
            textField(dspForm, setDspForm, "phone_number", "Phone Number", "text", formatPhone),
            textField(dspForm, setDspForm, "email", "Email"),
            selectField(dspForm, setDspForm, "sex", "Sex", SEX_OPTIONS, { includeBlank: true }),
            textField(dspForm, setDspForm, "hire_date", "Hire Date", "date"),
            selectField(dspForm, setDspForm, "status", "Status", DSP_STATUSES),
          ])}
          {grid([textField(dspForm, setDspForm, "address", "Address")], 400)}
        </>
      ))}

      {formSection("Background Checks — required for compliance", grid([
        textField(dspForm, setDspForm, "drug_screen_scheduled_date", "Drug Screen — Scheduled", "date"),
        textField(dspForm, setDspForm, "drug_screen_completed_date", "Drug Screen — Completed", "date"),
        textField(dspForm, setDspForm, "fingerprint_scheduled_date", "Fingerprinting — Scheduled", "date"),
        textField(dspForm, setDspForm, "fingerprint_completed_date", "Fingerprinting — Completed", "date"),
      ]))}

      {formSection("Training — advisory, does not block compliance", (
        <>
          {grid([
            textField(dspForm, setDspForm, "cds_scheduled_date", "College of Direct Support — Start", "date"),
            textField(dspForm, setDspForm, "cds_completed_date", "College of Direct Support — Completed", "date"),
          ])}
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!dspForm.medication_training_completed}
              onChange={(e) => setDspForm({ ...dspForm, medication_training_completed: e.target.checked })}
              style={{ accentColor: "#6366f1" }}
            />
            <span>Medication Training completed <span style={{ color: "#475569" }}>(optional coursework)</span></span>
          </label>
        </>
      ))}

      {formSection("Certifications — leave blank if not applicable", grid(
        CERT_FIELDS.map(({ key, label }) => textField(dspForm, setDspForm, key, `${label} Expires`, "date"))
      ))}

      {formSection("Notes", (
        <textarea
          value={dspForm.notes || ""}
          onChange={(e) => setDspForm({ ...dspForm, notes: e.target.value })}
          rows={3}
          placeholder="Availability, languages, certifications in progress…"
          style={{ ...inputStyle, resize: "vertical" }}
        />
      ))}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={saveDsp}
          disabled={!dspForm.name.trim()}
          style={{ ...btnPrimary, opacity: dspForm.name.trim() ? 1 : 0.4, cursor: dspForm.name.trim() ? "pointer" : "not-allowed" }}
        >
          {editingDspId ? "Save Changes" : "Save DSP"}
        </button>
        <button onClick={closeDspForm} style={btnSecondary}>Cancel</button>
        {editingDspId && (
          <button onClick={() => deleteDsp(editingDspId)} style={{ ...btnSecondary, color: "#f87171", borderColor: "#f8717133", marginLeft: "auto" }}>
            Delete DSP
          </button>
        )}
      </div>
    </div>
  );

  const renderDsps = () => (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
          {dsps.length} total · {filteredDsps.length} shown · {notCompliant} not compliant · {alerts.length} needing attention
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Search DSPs by name, email, phone…" value={dspSearch} onChange={(e) => setDspSearch(e.target.value)} style={{ ...inputStyle, width: 260 }} />
          <select value={dspStatusFilter} onChange={(e) => setDspStatusFilter(e.target.value)} style={{ ...inputStyle, width: "auto", cursor: "pointer" }}>
            <option value="all">All statuses</option>
            {DSP_STATUSES.map((s) => <option key={s} value={s} style={{ textTransform: "capitalize" }}>{s}</option>)}
            <option value="not_compliant">■ Not compliant</option>
            <option value="needs_attention">⚑ Not compliant or flagged</option>
          </select>
          <button onClick={openAddDsp} style={btnPrimary}>+ Add DSP</button>
        </div>
      </div>

      {dspForm && renderDspForm()}

      {filteredDsps.length === 0 ? (
        emptyState("👩‍⚕️", "No DSPs found", dsps.length ? "Try a different search or filter." : "Add your first employee to get started.")
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>{["DSP", "Phone", "Email", "Hired", "Clients", "Compliance", "Status", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filteredDsps.map((d) => {
                const mine = assignmentsByDsp[d.id] || [];
                return (
                  <tr key={d.id} style={{ borderBottom: "1px solid #1e293b" }}>
                    <td style={{ ...cell, color: "#e2e8f0", fontWeight: 600 }}>
                      <button onClick={() => setDetailDspId(d.id)} title="View full detail" style={{ background: "none", border: "none", padding: 0, color: "#e2e8f0", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                        {d.name}
                      </button>
                    </td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>{showPhone(d.phone_number) || "—"}</td>
                    <td style={{ ...cell, color: "#7dd3fc", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{d.email || "—"}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>{d.hire_date || "—"}</td>
                    <td style={{ ...cell }}>
                      {mine.length === 0 ? dash : (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {mine.map((a) => (
                            <span key={a.id} onClick={() => setDetailClientId(a.client_id)} title="View client"
                              style={{ display: "inline-block", padding: "3px 9px", borderRadius: 99, fontSize: 11, fontWeight: 700, background: "#8b5cf622", color: "#c4b5fd", border: "1px solid #8b5cf633", cursor: "pointer", whiteSpace: "nowrap" }}>
                              {clientById[a.client_id]?.name || "Unknown"}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "12px 14px" }}><ComplianceBadge dsp={d} onClick={() => setDetailDspId(d.id)} /></td>
                    <td style={{ padding: "12px 14px" }}><StatusBadge status={d.status} /></td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => openEditDsp(d)} style={rowBtn}>Edit</button>
                        <button onClick={() => deleteDsp(d.id)} style={rowBtn}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ── Sub-view C: Relationships ──
  const filteredRels = activeAssignments.filter((a) => {
    const q = relSearch.toLowerCase();
    if (!q) return true;
    return `${clientById[a.client_id]?.name || ""} ${dspById[a.dsp_id]?.name || ""}`.toLowerCase().includes(q);
  });

  const renderRelationships = () => (
    <div>
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Quick Assign</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
          <div>
            {fieldLabel("Client")}
            <select value={quickClient} onChange={(e) => setQuickClient(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
              <option value="">Select a client…</option>
              {clients.filter((c) => (c.status || "active") === "active").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            {fieldLabel("DSP")}
            <select value={quickDsp} onChange={(e) => setQuickDsp(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
              <option value="">Select a DSP…</option>
              {dsps
                .filter((d) => (d.status || "active") === "active")
                .filter((d) => !quickClient || !activeAssignments.some((a) => a.client_id === quickClient && a.dsp_id === d.id))
                .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <button
            disabled={!quickClient || !quickDsp}
            onClick={async () => { await assignDsp(quickClient, quickDsp); setQuickDsp(""); }}
            style={{ ...btnPrimary, opacity: quickClient && quickDsp ? 1 : 0.4, cursor: quickClient && quickDsp ? "pointer" : "not-allowed" }}
          >
            + Assign
          </button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
          {activeAssignments.length} active pairing{activeAssignments.length === 1 ? "" : "s"} · {filteredRels.length} shown
        </p>
        <input placeholder="Filter by client or DSP name…" value={relSearch} onChange={(e) => setRelSearch(e.target.value)} style={{ ...inputStyle, width: 300 }} />
      </div>

      {filteredRels.length === 0 ? (
        emptyState("🔗", "No active pairings", activeAssignments.length ? "Try a different filter." : "Use Quick Assign above to pair a DSP with a client.")
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>{["Client", "DSP", "DSP Compliance", "Assigned", "Active For", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filteredRels.map((a) => {
                const c = clientById[a.client_id];
                const d = dspById[a.dsp_id];
                return (
                  <tr key={a.id} style={{ borderBottom: "1px solid #1e293b" }}>
                    <td style={{ ...cell, color: "#e2e8f0", fontWeight: 600 }}>
                      <button onClick={() => setDetailClientId(a.client_id)} style={{ background: "none", border: "none", padding: 0, color: "#c4b5fd", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                        {c?.name || "Unknown client"}
                      </button>
                    </td>
                    <td style={{ ...cell, color: "#e2e8f0", fontWeight: 600 }}>
                      <button onClick={() => setDetailDspId(a.dsp_id)} style={{ background: "none", border: "none", padding: 0, color: "#7dd3fc", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                        {d?.name || "Unknown DSP"}
                      </button>
                    </td>
                    <td style={{ padding: "12px 14px" }}>{d ? <ComplianceBadge dsp={d} onClick={() => setDetailDspId(d.id)} /> : dash}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>{a.assigned_date || "—"}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>{durationLabel(daysSince(a.assigned_date))}</td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <button onClick={() => endAssignment(a)} style={rowBtn}>End Assignment</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ── Detail modals ──
  const renderClientDetail = () => {
    const c = clientById[detailClientId];
    if (!c) return null;
    const active = assignmentsByClient[c.id] || [];
    const history = assignments.filter((a) => a.client_id === c.id && a.status !== "active");
    return (
      <Modal title={c.name} subtitle={`Client · ${c.status || "active"}`} onClose={() => setDetailClientId(null)} maxWidth={620}>
        <div style={{ marginBottom: 18 }}>
          {detailRow("Age", c.age)}
          {detailRow("Sex", c.sex)}
          {detailRow("Phone", showPhone(c.phone_number))}
          {detailRow("Address", c.address)}
          {detailRow("Service started", c.date_service_started)}
          {detailRow("Time in service", durationLabel(daysSince(c.date_service_started)))}
        </div>

        <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Support Coordinator</div>
        <div style={{ marginBottom: 18 }}>
          {detailRow("Name", c.sc_name)}
          {detailRow("Agency", c.sc_agency)}
          {detailRow("Email", c.sc_email)}
          {detailRow("Phone", showPhone(c.sc_phone))}
          {detailRow("Linked in Outreach CRM", c.sc_contact_id ? "Yes" : "No")}
        </div>

        <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Assigned DSPs ({active.length})
        </div>
        <div style={{ marginBottom: 18 }}>
          {active.length === 0 ? (
            <p style={{ color: "#475569", fontSize: 13, margin: 0 }}>No DSPs currently assigned.</p>
          ) : active.map((a) => {
            const d = dspById[a.dsp_id];
            if (!d) return null;
            return (
              <div key={a.id} style={{ background: "#0f172a", borderRadius: 8, padding: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ color: "#e2e8f0", fontSize: 13 }}>{d.name}</strong>
                  <ComplianceBadge dsp={d} />
                </div>
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
                  {showPhone(d.phone_number) || "no phone"} · <span style={{ color: "#7dd3fc" }}>{d.email || "no email"}</span>
                </div>
                <div style={{ color: "#64748b", fontSize: 11, marginTop: 3 }}>
                  Assigned {a.assigned_date} · {durationLabel(daysSince(a.assigned_date))}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Service History ({history.length})
        </div>
        <div style={{ marginBottom: 18 }}>
          {history.length === 0 ? (
            <p style={{ color: "#475569", fontSize: 13, margin: 0 }}>No past assignments.</p>
          ) : history.map((a) => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid #1e293b" }}>
              <span style={{ color: "#94a3b8", fontSize: 13 }}>{dspById[a.dsp_id]?.name || "Unknown DSP"}</span>
              <span style={{ color: "#64748b", fontSize: 12 }}>{a.assigned_date} → {a.end_date || "—"}</span>
            </div>
          ))}
        </div>

        {c.notes && (
          <>
            <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Notes</div>
            <div style={{ background: "#0f172a", borderRadius: 8, padding: 14, marginBottom: 18 }}>
              <pre style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>{c.notes}</pre>
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setDetailClientId(null); setSubView("clients"); openEditClient(c); }} style={btnPrimary}>Edit Client</button>
          <button onClick={() => setDetailClientId(null)} style={btnSecondary}>Close</button>
        </div>
      </Modal>
    );
  };

  const renderDspDetail = () => {
    const d = dspById[detailDspId];
    if (!d) return null;
    const issues = dspComplianceIssues(d);
    const active = assignmentsByDsp[d.id] || [];
    return (
      <Modal title={d.name} subtitle={`DSP · ${d.status || "active"}${d.hire_date ? ` · hired ${d.hire_date}` : ""}`} onClose={() => setDetailDspId(null)} maxWidth={620}>
        <div style={{ marginBottom: 18 }}>
          <ComplianceBadge dsp={d} />
          {(() => {
            const blocking = issues.filter((i) => i.blocking);
            const advisories = issues.filter((i) => !i.blocking);
            return (
              <div style={{ marginTop: 10 }}>
                {blocking.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ color: "#f87171", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                      Blocking compliance
                    </div>
                    {blocking.map((i, n) => (
                      <div key={n} style={{ color: LEVEL_COLOR[i.severity], fontSize: 12, marginBottom: 3 }}>✕ {i.text}</div>
                    ))}
                  </div>
                )}
                {advisories.length > 0 && (
                  <div>
                    <div style={{ color: "#fbbf24", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                      High risk — does not block compliance
                    </div>
                    {advisories.map((i, n) => (
                      <div key={n} style={{ color: LEVEL_COLOR[i.severity], fontSize: 12, marginBottom: 3 }}>⚑ {i.text}</div>
                    ))}
                  </div>
                )}
                {issues.length === 0 && (
                  <div style={{ color: "#4ade80", fontSize: 12 }}>Drug screen and fingerprinting complete · no advisories</div>
                )}
              </div>
            );
          })()}
        </div>

        <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Contact</div>
        <div style={{ marginBottom: 18 }}>
          {detailRow("Phone", showPhone(d.phone_number))}
          {detailRow("Email", d.email)}
          {detailRow("Sex", d.sex)}
          {detailRow("Address", d.address)}
        </div>

        <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Background Checks & Training</div>
        <div style={{ marginBottom: 18 }}>
          {CHECK_FIELDS.map(({ label, scheduled, completed }) => {
            const required = REQUIRED_CHECKS.some((c) => c.completed === completed);
            return (
              <div key={scheduled} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "7px 0", borderBottom: "1px solid #1e293b" }}>
                <span style={{ color: "#64748b", fontSize: 12 }}>
                  {label}
                  <span style={{ color: required ? "#f87171" : "#475569", fontSize: 10, fontWeight: 700, marginLeft: 6 }}>
                    {required ? "REQUIRED" : "ADVISORY"}
                  </span>
                </span>
                <span style={{ fontSize: 12, textAlign: "right" }}>
                  <span style={{ color: "#94a3b8" }}>scheduled {d[scheduled] || "—"}</span>
                  {" · "}
                  <span style={{ color: d[completed] ? "#4ade80" : required ? "#f87171" : "#fbbf24", fontWeight: 600 }}>
                    {d[completed] ? `completed ${d[completed]}` : "not completed"}
                  </span>
                </span>
              </div>
            );
          })}
          {detailRow("Medication Training", d.medication_training_completed
            ? <span style={{ color: "#4ade80", fontWeight: 600 }}>Completed</span>
            : <span style={{ color: "#64748b" }}>Not completed</span>)}
        </div>

        <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Certifications</div>
        <div style={{ marginBottom: 18 }}>
          {CERT_FIELDS.map(({ key, label }) => {
            const days = daysUntil(d[key]);
            return (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "7px 0", borderBottom: "1px solid #1e293b" }}>
                <span style={{ color: "#64748b", fontSize: 12 }}>{label}</span>
                <span style={{ color: certColor(d[key]), fontSize: 13, fontWeight: days !== null && days <= CERT_WARN_DAYS ? 700 : 400 }}>
                  {d[key] ? `${d[key]}${days < 0 ? ` (expired ${-days}d ago)` : days <= CERT_WARN_DAYS ? ` (in ${days}d)` : ""}` : "n/a"}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Current Clients ({active.length})
        </div>
        <div style={{ marginBottom: 18 }}>
          {active.length === 0 ? (
            <p style={{ color: "#475569", fontSize: 13, margin: 0 }}>Not currently assigned to any client.</p>
          ) : active.map((a) => {
            const c = clientById[a.client_id];
            return (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid #1e293b" }}>
                <button onClick={() => { setDetailDspId(null); setDetailClientId(a.client_id); }} style={{ background: "none", border: "none", padding: 0, color: "#c4b5fd", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  {c?.name || "Unknown client"}
                </button>
                <span style={{ color: "#64748b", fontSize: 12 }}>since {a.assigned_date} · {durationLabel(daysSince(a.assigned_date))}</span>
              </div>
            );
          })}
        </div>

        {d.notes && (
          <>
            <div style={{ color: "#a78bfa", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Notes</div>
            <div style={{ background: "#0f172a", borderRadius: 8, padding: 14, marginBottom: 18 }}>
              <pre style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>{d.notes}</pre>
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setDetailDspId(null); setSubView("dsps"); openEditDsp(d); }} style={btnPrimary}>Edit DSP</button>
          <button onClick={() => setDetailDspId(null)} style={btnSecondary}>Close</button>
        </div>
      </Modal>
    );
  };

  // ── Shell ──
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ color: "#f1f5f9", fontSize: 20, margin: 0 }}>Care Management</h2>
          <p style={{ color: "#64748b", fontSize: 13, margin: "4px 0 0" }}>Clients, DSPs, and who's serving who</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setSubView("clients")} style={pillToggle(subView === "clients")}>Clients ({clients.length})</button>
          <button onClick={() => setSubView("dsps")} style={pillToggle(subView === "dsps")}>
            DSPs ({dsps.length}){alertCount > 0 ? ` ⚠️ ${alertCount}` : ""}
          </button>
          <button onClick={() => setSubView("relationships")} style={pillToggle(subView === "relationships")}>Relationships ({activeAssignments.length})</button>
        </div>
      </div>

      {!loading && !loadError && renderAlertBanner()}

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>Loading care management…
        </div>
      ) : loadError ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <p style={{ fontSize: 16, color: "#f87171", marginBottom: 8 }}>Error loading care management data</p>
          <p style={{ fontSize: 12, color: "#94a3b8", wordBreak: "break-all", marginBottom: 16 }}>{loadError}</p>
          <button onClick={loadAll} style={btnPrimary}>Retry</button>
        </div>
      ) : (
        <>
          {subView === "clients" && renderClients()}
          {subView === "dsps" && renderDsps()}
          {subView === "relationships" && renderRelationships()}
        </>
      )}

      {detailClientId && renderClientDetail()}
      {detailDspId && renderDspDetail()}
      <Toast message={toast} />
    </div>
  );
}
