import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  SEQUENCE_LABEL,
  STEP_SUBJECTS,
  TOTAL_STEPS,
  sendDateForStep,
  todayISO,
  renderStep,
} from "../lib/sequenceEmails";

// ── Shared Styles ──
const cardStyle = {
  background: "#111827",
  border: "1px solid #1e293b",
  borderRadius: 14,
  padding: 24,
};
const inputStyle = {
  width: "100%",
  background: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: 8,
  padding: "10px 14px",
  color: "#e2e8f0",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};
const btnPrimary = {
  padding: "10px 24px",
  background: "linear-gradient(135deg, #6366f1, #0ea5e9)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};
const btnSecondary = {
  padding: "10px 24px",
  background: "#1e293b",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const pillStyle = (active) => ({
  padding: "8px 18px",
  borderRadius: 99,
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: active ? "linear-gradient(135deg, #6366f1, #0ea5e9)" : "transparent",
  color: active ? "#fff" : "#94a3b8",
  transition: "all 0.25s",
});

// ── Email Sequence helpers & UI ──
// Creates an active sequence row for a contact. type = 'post_visit' (A) | 'cold_outreach' (B).
async function createSequence(supabase, contact, type) {
  const today = todayISO();
  const row = {
    contact_id: contact.id,
    sequence_type: type,
    visit_date: today,
    next_send_date: today, // Email 1 sends today
    current_step: 1,
    status: "active",
    contact_email: contact.email || null,
    contact_name: contact.contact_name || null,
    agency_name: contact.agency_name || null,
  };
  const { data, error } = await supabase.from("email_sequences").insert([row]).select();
  if (error) {
    alert("Could not start sequence: " + error.message);
    return null;
  }
  return data?.[0] || null;
}

const SEQ_PILL_COLORS = {
  active: "#3b82f6",
  paused: "#f59e0b",
  completed: "#94a3b8",
  exited_reply: "#10b981",
  stopped: "#94a3b8",
};

function sequencePillText(seq) {
  const t = SEQUENCE_LABEL[seq.sequence_type] || "?";
  switch (seq.status) {
    case "active": return `Seq ${t} — Step ${seq.current_step} of ${TOTAL_STEPS}`;
    case "paused": return `Paused — Step ${seq.current_step}`;
    case "completed": return "Sequence complete";
    case "exited_reply": return "Replied — exited";
    case "stopped":
      return seq.stopped_reason === "referred" ? "Referred — stopped"
        : seq.stopped_reason === "unsubscribed" ? "Unsubscribed — stopped"
        : "Stopped";
    default: return seq.status;
  }
}

function SequencePill({ seq, onClick }) {
  if (!seq) return null;
  const color = SEQ_PILL_COLORS[seq.status] || "#94a3b8";
  const clickable = !!onClick;
  return (
    <span
      onClick={onClick}
      title={clickable ? "View sequence details" : ""}
      style={{
        display: "inline-block", padding: "3px 10px", borderRadius: 99, fontSize: 11,
        fontWeight: 700, background: color + "22", color, whiteSpace: "nowrap",
        cursor: clickable ? "pointer" : "default",
      }}
    >
      {sequencePillText(seq)}
    </span>
  );
}

// Derive per-step status (sent / pending / skipped) from the row's current_step + status.
function stepStatus(seq, step) {
  if (seq.status === "completed") return "sent";
  if (step < seq.current_step) return "sent";
  if (step === seq.current_step) {
    return (seq.status === "active" || seq.status === "paused") ? "pending" : "skipped";
  }
  return (seq.status === "active" || seq.status === "paused") ? "pending" : "skipped";
}

function SequenceModal({ supabase, seq, onClose, onChange }) {
  const [busy, setBusy] = useState(false);
  const [overrides, setOverrides] = useState({}); // step_number -> { subject, body }
  const [previewStep, setPreviewStep] = useState(null);
  const [editStep, setEditStep] = useState(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const loadOverrides = useCallback(async () => {
    if (!seq?.contact_id) { setOverrides({}); return; }
    const { data } = await supabase
      .from("sequence_email_overrides")
      .select("step_number, custom_subject, custom_body")
      .eq("contact_id", seq.contact_id)
      .eq("sequence_type", seq.sequence_type);
    const m = {};
    (data || []).forEach((r) => { m[r.step_number] = { subject: r.custom_subject, body: r.custom_body }; });
    setOverrides(m);
  }, [supabase, seq?.contact_id, seq?.sequence_type]);

  useEffect(() => { loadOverrides(); }, [loadOverrides]);

  if (!seq) return null;
  const subjects = STEP_SUBJECTS[seq.sequence_type] || [];
  const statusColors = { sent: "#10b981", pending: "#3b82f6", skipped: "#64748b" };

  // Resolved (override-aware) rendered email for a given step — merge tags filled in.
  const resolvedStep = (step) => {
    const ov = overrides[step];
    if (ov) return { subject: ov.subject || "", body: ov.body || "" };
    return renderStep(seq, step) || { subject: "", body: "" };
  };

  const apply = async (update) => {
    setBusy(true);
    await supabase.from("email_sequences").update(update).eq("id", seq.id);
    setBusy(false);
    if (onChange) await onChange();
    onClose();
  };

  const openEdit = (step) => {
    const r = resolvedStep(step);
    setEditStep(step);
    setEditSubject(r.subject);
    setEditBody(r.body);
  };

  const saveEdit = async () => {
    setSavingEdit(true);
    await supabase.from("sequence_email_overrides").upsert(
      {
        contact_id: seq.contact_id,
        sequence_type: seq.sequence_type,
        step_number: editStep,
        custom_subject: editSubject,
        custom_body: editBody,
      },
      { onConflict: "contact_id,sequence_type,step_number" }
    );
    await loadOverrides();
    setSavingEdit(false);
    setEditStep(null);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle, maxWidth: 640, width: "100%", maxHeight: "85vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h3 style={{ color: "#f1f5f9", fontSize: 18, margin: 0 }}>
              Sequence {SEQUENCE_LABEL[seq.sequence_type]} — {seq.sequence_type === "post_visit" ? "Post in-person visit" : "Cold outreach"}
            </h3>
            <p style={{ color: "#64748b", fontSize: 13, margin: "4px 0 0" }}>
              {seq.agency_name || "—"}{seq.contact_name ? ` · ${seq.contact_name}` : ""}
            </p>
          </div>
          <button onClick={onClose} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 12 }}>✕</button>
        </div>

        <div style={{ margin: "16px 0" }}>
          <SequencePill seq={seq} />
        </div>

        <div style={{ marginBottom: 16 }}>
          {subjects.map((subj, i) => {
            const step = i + 1;
            const st = stepStatus(seq, step);
            const date = sendDateForStep(seq.sequence_type, seq.visit_date, step);
            const edited = !!overrides[step];
            const shownSubject = edited ? overrides[step].subject : subj;
            return (
              <div key={step} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid #1e293b", flexWrap: "wrap" }}>
                <div style={{ width: 22, height: 22, borderRadius: 99, background: "#0f172a", color: "#94a3b8", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{step}</div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {shownSubject}{edited && <span style={{ color: "#a78bfa", fontSize: 10, fontWeight: 700, marginLeft: 6 }}>✎ EDITED</span>}
                  </div>
                  <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>Send date: {date}</div>
                </div>
                <span style={{ padding: "2px 9px", borderRadius: 99, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, background: statusColors[st] + "22", color: statusColors[st], flexShrink: 0 }}>{st}</span>
                <button onClick={() => setPreviewStep(step)} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 11 }}>👁 Preview</button>
                <button onClick={() => openEdit(step)} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 11 }}>✎ Edit</button>
              </div>
            );
          })}
        </div>

        {seq.stopped_reason && (
          <p style={{ color: "#94a3b8", fontSize: 12, marginBottom: 12 }}>Stopped reason: <strong style={{ color: "#e2e8f0" }}>{seq.stopped_reason}</strong></p>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {seq.status === "active" && (
            <button disabled={busy} onClick={() => apply({ status: "paused" })} style={btnSecondary}>⏸ Pause</button>
          )}
          {seq.status === "paused" && (
            <button disabled={busy} onClick={() => apply({ status: "active" })} style={btnPrimary}>▶ Resume</button>
          )}
          {(seq.status === "active" || seq.status === "paused") && (
            <>
              <button disabled={busy} onClick={() => apply({ status: "stopped", stopped_reason: "manual" })} style={{ ...btnSecondary, color: "#f87171", borderColor: "#f8717133" }}>⏹ Stop</button>
              <button disabled={busy} onClick={() => apply({ status: "exited_reply" })} style={{ ...btnSecondary, color: "#4ade80", borderColor: "#4ade8033" }}>✓ Mark as replied</button>
              <button disabled={busy} onClick={() => apply({ status: "stopped", stopped_reason: "unsubscribed" })} style={btnSecondary}>Mark unsubscribed</button>
            </>
          )}
        </div>

        {/* Fix 4 — read-only email preview */}
        {previewStep !== null && (() => {
          const r = resolvedStep(previewStep);
          return (
            <div onClick={() => setPreviewStep(null)} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200, padding: 20 }}>
              <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle, maxWidth: 600, width: "100%", maxHeight: "85vh", overflow: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h3 style={{ color: "#f1f5f9", fontSize: 16, margin: 0 }}>Preview — Step {previewStep} {overrides[previewStep] ? "(custom)" : ""}</h3>
                  <button onClick={() => setPreviewStep(null)} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 12 }}>✕</button>
                </div>
                <p style={{ color: "#64748b", fontSize: 12, marginBottom: 4 }}>To: <span style={{ color: "#7dd3fc" }}>{seq.contact_email || "—"}</span></p>
                <p style={{ color: "#64748b", fontSize: 12, marginBottom: 12 }}>Subject: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{r.subject}</span></p>
                <div style={{ background: "#0f172a", borderRadius: 8, padding: 16 }}>
                  <pre style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>{r.body}</pre>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Fix 5 — per-contact email editor */}
        {editStep !== null && (
          <div onClick={() => setEditStep(null)} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200, padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle, maxWidth: 640, width: "100%", maxHeight: "88vh", overflow: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ color: "#f1f5f9", fontSize: 16, margin: 0 }}>Edit Step {editStep} — {seq.contact_name || seq.agency_name}</h3>
                <button onClick={() => setEditStep(null)} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 12 }}>✕</button>
              </div>
              <p style={{ color: "#475569", fontSize: 11, marginBottom: 12 }}>This override applies only to this contact's sequence. Leave merge tags like {"{{first_name}}"} in place to keep them dynamic.</p>
              <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>Subject</label>
              <input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
              <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>Body</label>
              <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={16} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6, marginBottom: 14 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button disabled={savingEdit} onClick={saveEdit} style={btnPrimary}>{savingEdit ? "Saving…" : "Save Override"}</button>
                <button onClick={() => setEditStep(null)} style={btnSecondary}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, background: "#111827", border: "1px solid #6366f1", borderRadius: 10, padding: "14px 20px", color: "#e2e8f0", fontSize: 14, fontWeight: 600, boxShadow: "0 10px 30px rgba(0,0,0,0.4)", zIndex: 1100, maxWidth: 360 }}>
      ✨ {message}
    </div>
  );
}

// ── Config Panel ──
// NOTE: RESEND_API_KEY is intentionally NOT in this form.
// It lives only in the server environment variable RESEND_API_KEY.
// Supabase anon key is safe for the browser (RLS protects your data).
function ConfigPanel({ config, setConfig, onSave }) {
  const [local, setLocal] = useState(config);
  const fields = [
    { key: "SUPABASE_URL", label: "Supabase URL", placeholder: "https://xxxxx.supabase.co", type: "text" },
    { key: "SUPABASE_ANON_KEY", label: "Supabase Anon Key", placeholder: "sb_publishable_... or eyJhbGciOi...", type: "password" },
    { key: "FROM_EMAIL", label: "From Email", placeholder: "outreach@harmonycarenj.org", type: "text" },
  ];
  const canSave = local.SUPABASE_URL && local.SUPABASE_ANON_KEY && local.FROM_EMAIL;
  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 16, padding: 48, maxWidth: 520, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #0ea5e9, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>⚡</div>
          <h1 style={{ color: "#f1f5f9", fontSize: 22, margin: 0, fontWeight: 700 }}>Harmony Outreach</h1>
        </div>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 32, lineHeight: 1.6 }}>
          Connect your Supabase database to launch the dashboard. The <code style={{ background: "#0f172a", padding: "1px 6px", borderRadius: 4, color: "#a5f3fc" }}>RESEND_API_KEY</code> is read from your server environment — add it in Vercel → Settings → Environment Variables.
        </p>
        {fields.map(({ key, label, placeholder, type }) => (
          <div key={key} style={{ marginBottom: 20 }}>
            <label style={{ display: "block", color: "#94a3b8", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{label}</label>
            <input
              type={type}
              value={local[key] || ""}
              onChange={e => setLocal({ ...local, [key]: e.target.value })}
              placeholder={placeholder}
              style={{ ...inputStyle, transition: "border 0.2s" }}
              onFocus={e => e.target.style.borderColor = "#6366f1"}
              onBlur={e => e.target.style.borderColor = "#1e293b"}
            />
          </div>
        ))}
        <button
          onClick={() => { setConfig(local); onSave(local); }}
          disabled={!canSave}
          style={{ ...btnPrimary, width: "100%", padding: "12px 0", borderRadius: 10, fontSize: 15, marginTop: 8, opacity: canSave ? 1 : 0.4 }}
        >
          Connect & Launch Dashboard →
        </button>
      </div>
    </div>
  );
}

// ── DB Setup Tab ──
function SetupTab() {
  const sqlScript = `-- SC Contacts table
CREATE TABLE IF NOT EXISTS sc_contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agency_name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  website TEXT,
  counties_served TEXT,
  languages TEXT,
  sca_marked TEXT,
  source TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'new',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Email Templates table
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Sent Emails log
CREATE TABLE IF NOT EXISTS sent_emails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID REFERENCES sc_contacts(id),
  template_id UUID REFERENCES email_templates(id),
  agency_name TEXT,
  to_email TEXT NOT NULL,
  subject TEXT,
  status TEXT DEFAULT 'sent',
  resend_id TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
-- Campaign table
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  template_id UUID REFERENCES email_templates(id),
  status TEXT DEFAULT 'draft',
  total_contacts INT DEFAULT 0,
  sent_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Enable RLS
ALTER TABLE sc_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sent_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
-- Allow anon read/write (tighten in production)
CREATE POLICY "anon_all_sc_contacts" ON sc_contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_email_templates" ON email_templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_sent_emails" ON sent_emails FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_campaigns" ON campaigns FOR ALL USING (true) WITH CHECK (true);`.trim();

  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(sqlScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div>
      <h2 style={{ color: "#f1f5f9", fontSize: 20, marginBottom: 8 }}>Database Setup</h2>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
        Copy the SQL below and run it in your <strong style={{ color: "#e2e8f0" }}>Supabase SQL Editor</strong>. Only needed once — skip if tables already exist.
      </p>
      <div style={{ ...cardStyle, position: "relative" }}>
        <button onClick={copy} style={{ ...btnPrimary, position: "absolute", top: 16, right: 16, padding: "6px 14px", fontSize: 12 }}>
          {copied ? "✅ Copied!" : "📋 Copy SQL"}
        </button>
        <pre style={{ color: "#a5f3fc", fontSize: 12, lineHeight: 1.5, overflow: "auto", maxHeight: 500, whiteSpace: "pre-wrap", margin: 0, paddingRight: 100 }}>
          {sqlScript}
        </pre>
      </div>
    </div>
  );
}

// ── Contact type config (shared: badge color, label, dropdown, filter) ──
const CONTACT_TYPES = [
  { value: "support_coordination", label: "Support Coordination", color: "#14b8a6" },
  { value: "rehab_center", label: "Rehab Center", color: "#f97316" },
  { value: "nursing_home", label: "Nursing Home", color: "#3b82f6" },
  { value: "assisted_living", label: "Assisted Living", color: "#f59e0b" },
  { value: "doctors_office", label: "Doctor's Office", color: "#8b5cf6" },
  { value: "pediatric_practice", label: "Pediatric Practice", color: "#ec4899" },
  { value: "adult_day_program", label: "Adult Day Program", color: "#22c55e" },
  { value: "networking_contact", label: "Networking Contact", color: "#6b7280" },
  { value: "insurance_company", label: "Insurance Company", color: "#0ea5e9" },
];
const CONTACT_TYPE_COLOR = Object.fromEntries(CONTACT_TYPES.map((t) => [t.value, t.color]));
const CONTACT_TYPE_LABEL = Object.fromEntries(CONTACT_TYPES.map((t) => [t.value, t.label]));

// ── NJ region grouping (shared: Contacts tab + Campaigns tab search/filter parity) ──
const REGIONS = {
  south: ["atlantic", "burlington", "camden", "cape may", "cumberland", "gloucester", "salem"],
  central: ["hunterdon", "mercer", "middlesex", "monmouth", "ocean", "somerset", "union"],
  north: ["bergen", "essex", "hudson", "morris", "passaic", "sussex", "warren"],
};
function matchesRegion(c, region) {
  const cs = (c.counties_served || "").toLowerCase();
  return REGIONS[region].some((county) => cs.includes(county));
}

// ── Contacts Tab ──
function ContactsTab({ supabase }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [visibleCount, setVisibleCount] = useState(150);
  const [showAdd, setShowAdd] = useState(false);
  const [newContact, setNewContact] = useState({ agency_name: "", contact_name: "", email: "", phone: "", counties_served: "" });
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [editingContact, setEditingContact] = useState(null);
  const [editForm, setEditForm] = useState({});
  // Sequence automation state
  const [justVisited, setJustVisited] = useState(false);
  const [sequences, setSequences] = useState({}); // contact_id -> latest sequence row
  const [modalSeq, setModalSeq] = useState(null);
  const [toast, setToast] = useState("");
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 4500); };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    // FIX: Use official @supabase/supabase-js client — handles auth headers,
    // URL encoding, and RLS correctly without manual fetch() calls.
    // Page through in chunks of 1000 to bypass Supabase's default row cap,
    // so the table always reflects every contact regardless of total count.
    const pageSize = 1000;
    let all = [];
    let from = 0;
    let pageError = null;
    while (true) {
      const { data, error } = await supabase
        .from("sc_contacts")
        .select("*")
        .range(from, from + pageSize - 1);
      if (error) { pageError = error; break; }
      all = all.concat(data || []);
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    if (pageError) {
      setLoadError(typeof pageError === "object" ? pageError.message || JSON.stringify(pageError) : String(pageError));
      setContacts([]);
    } else {
      setContacts(all);
    }
    setLoading(false);
  }, [supabase]);

  // Load sequences and keep only the most recent one per contact for the pill.
  const loadSequences = useCallback(async () => {
    const { data } = await supabase.from("email_sequences").select("*").order("created_at", { ascending: false });
    const map = {};
    (data || []).forEach((s) => { if (!map[s.contact_id]) map[s.contact_id] = s; });
    setSequences(map);
  }, [supabase]);

  useEffect(() => { load(); loadSequences(); }, [load, loadSequences]);

  const addContact = async () => {
    if (!newContact.agency_name) return;
    const { data: inserted, error } = await supabase.from("sc_contacts").insert([newContact]).select();
    if (error) { alert("Could not add contact: " + error.message); return; }
    const contact = inserted?.[0];
    if (contact) {
      // No linked in-person visit → Sequence B (cold). Checkbox → Sequence A (post-visit).
      const type = justVisited ? "post_visit" : "cold_outreach";
      const seq = await createSequence(supabase, contact, type);
      if (seq) {
        const who = contact.contact_name || contact.agency_name;
        showToast(`Sequence ${SEQUENCE_LABEL[type]} started for ${who} — Email 1 sends today`);
      }
    }
    setNewContact({ agency_name: "", contact_name: "", email: "", phone: "", counties_served: "" });
    setJustVisited(false);
    setShowAdd(false);
    load();
    loadSequences();
  };

  // Start a sequence for an existing contact (used from the edit panel).
  const startSequenceForContact = async (contact, type) => {
    const seq = await createSequence(supabase, contact, type);
    if (seq) {
      const who = contact.contact_name || contact.agency_name;
      showToast(`Sequence ${SEQUENCE_LABEL[type]} started for ${who} — Email 1 sends today`);
      loadSequences();
    }
  };

  const bulkImport = async () => {
    try {
      const rows = importText.trim().split("\n").map(line => {
        const [agency_name, phone, email, website, counties_served] = line.split("\t");
        return {
          agency_name: agency_name?.trim(),
          phone: phone?.trim(),
          email: email?.trim(),
          website: website?.trim(),
          counties_served: counties_served?.trim(),
          source: "bulk_import",
        };
      }).filter(r => r.agency_name);
      if (rows.length) {
        await supabase.from("sc_contacts").insert(rows);
        setImportText("");
        setShowImport(false);
        load();
      }
    } catch (e) { alert("Import error: " + e.message); }
  };

  const startEdit = (contact) => {
    setEditingContact(contact.id);
    setEditForm({
      agency_name: contact.agency_name || "",
      contact_name: contact.contact_name || "",
      email: contact.email || "",
      phone: contact.phone || "",
      website: contact.website || "",
      counties_served: contact.counties_served || "",
      languages: contact.languages || "",
      status: contact.status || "new",
      notes: contact.notes || "",
      contact_type: contact.contact_type || "support_coordination",
      contact_type_confirmed: !!contact.contact_type_confirmed,
    });
    setShowAdd(false);
    setShowImport(false);
  };

  const saveEdit = async () => {
    if (!editForm.agency_name) return;
    await supabase
      .from("sc_contacts")
      .update({ ...editForm, updated_at: new Date().toISOString() })
      .eq("id", editingContact);
    // Sequence exit conditions tied to contact status changes.
    // (This app has no `relationship_stage`; "referred" is mapped to status = 'converted'.)
    const seq = sequences[editingContact];
    if (seq && (seq.status === "active" || seq.status === "paused")) {
      if (editForm.status === "converted") {
        await supabase.from("email_sequences").update({ status: "stopped", stopped_reason: "referred" }).eq("id", seq.id);
      } else if (editForm.status === "replied") {
        await supabase.from("email_sequences").update({ status: "exited_reply" }).eq("id", seq.id);
      }
    }
    setEditingContact(null);
    setEditForm({});
    load();
    loadSequences();
  };

  const cancelEdit = () => {
    setEditingContact(null);
    setEditForm({});
  };

  const deleteContact = async (id) => {
    if (!confirm("Delete this contact permanently?")) return;
    await supabase.from("sc_contacts").delete().eq("id", id);
    if (editingContact === id) cancelEdit();
    load();
  };

  const filtered = contacts.filter(c => {
    const matchesSearch = !search || [c.agency_name, c.email, c.counties_served, c.contact_name]
      .some(f => (f || "").toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = filterStatus === "all" ? true
      : filterStatus.startsWith("type:") ? (c.contact_type || "") === filterStatus.slice(5)
      : filterStatus === "burlington" ? (c.counties_served || "").toLowerCase().includes("burlington")
      : filterStatus === "south" ? matchesRegion(c, "south")
      : filterStatus === "central" ? matchesRegion(c, "central")
      : filterStatus === "north" ? matchesRegion(c, "north")
      : filterStatus === "has_email" ? !!c.email
      : c.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const STATUS_CYCLE = ["new", "contacted", "no_response", "followed_up", "warm", "converted", "not_interested"];
  const statusColor = {
    new: "#3b82f6",
    contacted: "#f59e0b",
    no_response: "#f87171",
    followed_up: "#60a5fa",
    warm: "#fbbf24",
    converted: "#8b5cf6",
    not_interested: "#6b7280",
    replied: "#10b981",
  };

  const cycleStatus = async (contactId) => {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;
    const currentIndex = STATUS_CYCLE.indexOf(contact.status || "new");
    const nextIndex = (currentIndex + 1) % STATUS_CYCLE.length;
    const nextStatus = STATUS_CYCLE[nextIndex];
    await supabase.from("sc_contacts").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", contactId);
    load();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ color: "#f1f5f9", fontSize: 20, margin: 0 }}>SC Contacts</h2>
          <p style={{ color: "#64748b", fontSize: 13, margin: "4px 0 0" }}>{contacts.length} total · {filtered.length} shown</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Search agencies, emails, counties..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, width: 260 }}
          />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inputStyle, width: "auto", cursor: "pointer" }}>
            <option value="all">All ({contacts.length})</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="replied">Replied</option>
            <option value="converted">Converted</option>
            <option value="south">South Jersey</option>
            <option value="central">Central Jersey</option>
            <option value="north">North Jersey</option>
            <option value="burlington">Burlington County</option>
            <option value="has_email">Has Email</option>
            <optgroup label="Contact Type">
              {CONTACT_TYPES.map(t => (
                <option key={t.value} value={`type:${t.value}`}>{t.label}</option>
              ))}
            </optgroup>
          </select>
          <button onClick={() => setShowImport(!showImport)} style={btnSecondary}>📥 Bulk Import</button>
          <button onClick={() => setShowAdd(!showAdd)} style={btnPrimary}>+ Add Contact</button>
        </div>
      </div>

      {showAdd && (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            {["agency_name", "contact_name", "email", "phone", "counties_served"].map(k => (
              <input key={k} placeholder={k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                value={newContact[k]} onChange={e => setNewContact({ ...newContact, [k]: e.target.value })} style={inputStyle} />
            ))}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 13, marginBottom: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={justVisited} onChange={e => setJustVisited(e.target.checked)} style={{ accentColor: "#6366f1" }} />
            <span>I just did an in-person visit today — start <strong style={{ color: "#a78bfa" }}>Sequence A</strong> (post-visit). Otherwise <strong style={{ color: "#7dd3fc" }}>Sequence B</strong> (cold outreach) starts.</span>
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addContact} style={btnPrimary}>Save Contact</button>
            <button onClick={() => setShowAdd(false)} style={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}

      {showImport && (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>Paste tab-separated rows: Agency Name → Phone → Email → Website → Counties</p>
          <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={6}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace" }}
            placeholder={"Agency One\t555-1234\temail@test.com\twww.site.com\tBurlington"} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={bulkImport} style={btnPrimary}>Import {importText.trim().split("\n").filter(Boolean).length} Rows</button>
            <button onClick={() => setShowImport(false)} style={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}

      {editingContact && (
        <div style={{ ...cardStyle, marginBottom: 20, borderColor: "#6366f155" }}>
          <h3 style={{ color: "#a78bfa", fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Edit Contact</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            {[
              { key: "agency_name", label: "Agency Name" },
              { key: "contact_name", label: "Contact Name" },
              { key: "email", label: "Email" },
              { key: "phone", label: "Phone" },
              { key: "website", label: "Website" },
              { key: "counties_served", label: "Counties Served" },
              { key: "languages", label: "Languages" },
            ].map(({ key, label }) => (
              <div key={key}>
                <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>{label}</label>
                <input
                  value={editForm[key] || ""}
                  onChange={e => setEditForm({ ...editForm, [key]: e.target.value })}
                  placeholder={label}
                  style={inputStyle}
                />
              </div>
            ))}
            <div>
              <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>Status</label>
              <select value={editForm.status || "new"} onChange={e => setEditForm({ ...editForm, status: e.target.value })} style={{ ...inputStyle, cursor: "pointer" }}>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="replied">Replied</option>
                <option value="converted">Converted</option>
              </select>
            </div>
            <div>
              <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>Contact Type</label>
              <select
                value={editForm.contact_type || "support_coordination"}
                onChange={e => setEditForm({ ...editForm, contact_type: e.target.value, contact_type_confirmed: true })}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                {CONTACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#94a3b8", fontSize: 12, marginTop: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!editForm.contact_type_confirmed}
                  onChange={e => setEditForm({ ...editForm, contact_type_confirmed: e.target.checked })}
                  style={{ accentColor: "#ec4899" }}
                />
                <span>Type confirmed</span>
              </label>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>Notes</label>
            <textarea
              value={editForm.notes || ""}
              onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
              rows={3}
              placeholder="Add notes about this contact..."
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
          {(() => {
            const seq = sequences[editingContact];
            const editingObj = contacts.find(c => c.id === editingContact);
            const hasRunning = seq && (seq.status === "active" || seq.status === "paused");
            return (
              <div style={{ marginBottom: 14, padding: "12px 14px", background: "#0f172a", borderRadius: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>Sequence:</span>
                {seq ? <SequencePill seq={seq} onClick={() => setModalSeq(seq)} /> : <span style={{ color: "#64748b", fontSize: 12 }}>None</span>}
                {!hasRunning && editingObj && (
                  <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                    <button onClick={() => startSequenceForContact(editingObj, "post_visit")} style={{ ...btnSecondary, padding: "6px 12px", fontSize: 12 }}>▶ Start Sequence A</button>
                    <button onClick={() => startSequenceForContact(editingObj, "cold_outreach")} style={{ ...btnSecondary, padding: "6px 12px", fontSize: 12 }}>▶ Start Sequence B</button>
                  </div>
                )}
              </div>
            );
          })()}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={saveEdit} style={btnPrimary}>Save Changes</button>
            <button onClick={cancelEdit} style={btnSecondary}>Cancel</button>
            <button onClick={() => deleteContact(editingContact)} style={{ ...btnSecondary, color: "#f87171", borderColor: "#f8717133", marginLeft: "auto" }}>Delete Contact</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>Loading contacts...
        </div>
      ) : loadError ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <p style={{ fontSize: 16, color: "#f87171", marginBottom: 8 }}>Error loading contacts</p>
          <p style={{ fontSize: 12, color: "#94a3b8", wordBreak: "break-all", marginBottom: 16 }}>{loadError}</p>
          <button onClick={load} style={btnPrimary}>Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: 48, color: "#64748b" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p style={{ fontSize: 16, color: "#94a3b8", marginBottom: 8 }}>No contacts found</p>
          <p style={{ fontSize: 13 }}>Try a different filter, or add contacts above.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                {["Agency", "Contact", "Email", "Phone", "Counties", "Type", "Status", "Sequence", ""].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px", color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, borderBottom: "1px solid #1e293b", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, visibleCount).map((c, i) => (
                <tr key={c.id || i} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "12px 14px", color: "#e2e8f0", fontSize: 13, fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.agency_name}</td>
                  <td style={{ padding: "12px 14px", color: "#94a3b8", fontSize: 13 }}>{c.contact_name || "—"}</td>
                  <td style={{ padding: "12px 14px", color: "#7dd3fc", fontSize: 13, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{c.email || "—"}</td>
                  <td style={{ padding: "12px 14px", color: "#94a3b8", fontSize: 13, whiteSpace: "nowrap" }}>{c.phone || "—"}</td>
                  <td style={{ padding: "12px 14px", color: "#94a3b8", fontSize: 12, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.counties_served || "—"}</td>
                  <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                    {c.contact_type ? (
                      <span style={{
                        display: "inline-block", padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700,
                        background: (CONTACT_TYPE_COLOR[c.contact_type] || "#6b7280") + "22",
                        color: CONTACT_TYPE_COLOR[c.contact_type] || "#6b7280",
                        border: `1px solid ${(CONTACT_TYPE_COLOR[c.contact_type] || "#6b7280")}33`,
                      }}>
                        {CONTACT_TYPE_LABEL[c.contact_type] || c.contact_type}
                      </span>
                    ) : <span style={{ color: "#475569", fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    <button
                      onClick={() => cycleStatus(c.id)}
                      title="Click to advance status"
                      style={{
                        display: "inline-block",
                        padding: "3px 10px",
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 700,
                        background: (statusColor[c.status] || "#3b82f6") + "22",
                        color: statusColor[c.status] || "#3b82f6",
                        border: `1px solid ${statusColor[c.status] || "#3b82f6"}33`,
                        textTransform: "capitalize",
                        cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={e => {
                        e.target.style.background = (statusColor[c.status] || "#3b82f6") + "44";
                        e.target.style.opacity = "0.9";
                      }}
                      onMouseLeave={e => {
                        e.target.style.background = (statusColor[c.status] || "#3b82f6") + "22";
                        e.target.style.opacity = "1";
                      }}
                    >
                      {c.status || "new"}
                    </button>
                  </td>
                  <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                    {sequences[c.id]
                      ? <SequencePill seq={sequences[c.id]} onClick={() => setModalSeq(sequences[c.id])} />
                      : <span style={{ color: "#475569", fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => startEdit(c)}
                        style={{ background: "none", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", fontSize: 12, padding: "4px 12px", cursor: "pointer", transition: "all 0.2s" }}
                        onMouseEnter={e => { e.target.style.borderColor = "#6366f1"; e.target.style.color = "#a78bfa"; }}
                        onMouseLeave={e => { e.target.style.borderColor = "#334155"; e.target.style.color = "#94a3b8"; }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteContact(c.id)}
                        title="Delete contact"
                        style={{ background: "none", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", fontSize: 12, padding: "4px 12px", cursor: "pointer", transition: "all 0.2s" }}
                        onMouseEnter={e => { e.target.style.borderColor = "#f87171"; e.target.style.color = "#f87171"; }}
                        onMouseLeave={e => { e.target.style.borderColor = "#334155"; e.target.style.color = "#94a3b8"; }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > visibleCount && (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <p style={{ color: "#64748b", fontSize: 12, marginBottom: 8 }}>Showing {visibleCount} of {filtered.length}</p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button onClick={() => setVisibleCount(v => v + 150)} style={btnSecondary}>Show more</button>
                <button onClick={() => setVisibleCount(filtered.length)} style={btnSecondary}>Show all ({filtered.length})</button>
              </div>
            </div>
          )}
        </div>
      )}

      {modalSeq && <SequenceModal supabase={supabase} seq={modalSeq} onClose={() => setModalSeq(null)} onChange={loadSequences} />}
      <Toast message={toast} />
    </div>
  );
}

// ── Template grouping — sequence templates ("Seq A - Step N: ...") are grouped by
// sequence and sorted chronologically by step; everything else falls into "Other
// Templates". Grouping is purely organizational — every template is still selected
// and sent individually, nothing here couples sends together. ──
// Plain-language explainer so anyone opening the dashboard for the first time knows
// what each sequence is and when it fires, without having to dig through the Sequences tab.
const SEQUENCE_GROUP_BLURB = {
  "Sequence A": "Auto-sent after you log an in-person visit — 5 emails over 21 days, warm & personal tone.",
  "Sequence B": "Auto-sent to new contacts with no visit yet — 5 emails over 23 days, professional & credibility-first tone.",
};
const SEQ_TEMPLATE_NAME_RE = /^Seq ([A-Za-z0-9]+) - Step (\d+)/;
function templateGroupInfo(t) {
  const m = (t.name || "").match(SEQ_TEMPLATE_NAME_RE);
  if (m) return { group: `Sequence ${m[1]}`, step: parseInt(m[2], 10), isSequence: true };
  return { group: "Other Templates", step: 0, isSequence: false };
}
function groupTemplates(templates) {
  const groups = {};
  templates.forEach((t) => {
    const info = templateGroupInfo(t);
    if (!groups[info.group]) groups[info.group] = { isSequence: info.isSequence, items: [] };
    groups[info.group].items.push({ ...t, __step: info.step });
  });
  Object.values(groups).forEach((g) => g.items.sort((a, b) => a.__step - b.__step || a.name.localeCompare(b.name)));
  // Sequence groups first (alphabetically, so A before B), "Other Templates" always last.
  return Object.entries(groups).sort(([an, ag], [bn, bg]) => {
    if (ag.isSequence !== bg.isSequence) return ag.isSequence ? -1 : 1;
    return an.localeCompare(bn);
  });
}

// ── Templates Tab ──
function TemplatesTab({ supabase }) {
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", subject: "", body: "" });
  const [preview, setPreview] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("email_templates").select("*");
    setTemplates(data || []);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name || !form.subject || !form.body) return;
    if (editing) {
      // FIX: Use .eq() chaining instead of passing match as second argument
      await supabase.from("email_templates").update(form).eq("id", editing);
    } else {
      await supabase.from("email_templates").insert([form]);
    }
    setForm({ name: "", subject: "", body: "" });
    setEditing(null);
    load();
  };

  const deleteTemplate = async (id) => {
    if (!confirm("Delete this template?")) return;
    await supabase.from("email_templates").delete().eq("id", id);
    load();
  };

  const defaultTemplate = {
    name: "Initial SC Outreach",
    subject: "Introducing Harmony Homecare Agency — New DDD Community Care Provider in Burlington County",
    body: `Dear {{contact_name}},

I hope this message finds you well. My name is Nate Ojugo, Administrator of Harmony Homecare Agency, LLC — a newly approved NJ Division of Developmental Disabilities (DDD) Community Care Program provider based in Westampton, Burlington County.

We are reaching out to introduce our agency and the services we offer to individuals with intellectual and developmental disabilities (IDD):

• Individual Support Services (ISS)
• Community-Based Supports (CBS)
• Respite Care

Our team brings over 20 years of experience in the IDD field, and we are proud to be a multilingual and multicultural agency committed to person-centered, community-inclusive care.

We would love the opportunity to connect with you and discuss how Harmony can support the individuals and families you serve. If you have any current or upcoming referral needs, please don't hesitate to reach out.

We look forward to building a strong partnership with {{agency_name}}.

Warm regards,
Nate Ojugo
Administrator, Harmony Homecare Agency, LLC
Medicaid Provider #1084411 | NPI #1922869536
Phone: 609-755-5593
Email: hhcare.nj@gmail.com
Website: harmonycarenj.org

To unsubscribe from future emails, reply with "unsubscribe" in the subject line.
Harmony Homecare Agency, LLC | 1852 Burlington Mt-Holy Road, Westampton, NJ 08060`,
  };

  const samplePreview = (body, subject) => {
    const sample = { agency_name: "Sample SC Agency", contact_name: "Jane Smith", email: "jane@samplesc.org" };
    const personalize = (t) => (t || "")
      .replace(/\{\{agency_name\}\}/g, sample.agency_name)
      .replace(/\{\{contact_name\}\}/g, sample.contact_name)
      .replace(/\{\{email\}\}/g, sample.email);
    setPreview({ subject: personalize(subject), body: personalize(body) });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ color: "#f1f5f9", fontSize: 20, margin: 0 }}>Email Templates</h2>
        {templates.length === 0 && (
          <button onClick={() => setForm(defaultTemplate)} style={btnSecondary}>📝 Load Default Template</button>
        )}
      </div>

      {/* Editor */}
      <div style={{ ...cardStyle, marginBottom: 24 }}>
        <h3 style={{ color: "#94a3b8", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>
          {editing ? "Edit Template" : "New Template"}
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Template Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g., Initial SC Outreach" style={inputStyle} />
          </div>
          <div>
            <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Subject Line</label>
            <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="Email subject..." style={inputStyle} />
          </div>
        </div>
        <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>Body</label>
        <p style={{ color: "#475569", fontSize: 11, marginBottom: 8 }}>Use {"{{"+"agency_name"+"}}"}, {"{{"+"contact_name"+"}}"}, {"{{"+"email"+"}}"} for personalization</p>
        <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={14} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={save} style={btnPrimary}>{editing ? "Update" : "Save"} Template</button>
          {form.body && <button onClick={() => samplePreview(form.body, form.subject)} style={btnSecondary}>👁 Preview</button>}
          {editing && <button onClick={() => { setEditing(null); setForm({ name: "", subject: "", body: "" }); setPreview(null); }} style={btnSecondary}>Cancel</button>}
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div style={{ ...cardStyle, marginBottom: 24, borderColor: "#6366f133" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ color: "#a78bfa", fontSize: 14, fontWeight: 700 }}>Preview (sample data)</h3>
            <button onClick={() => setPreview(null)} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 12 }}>✕</button>
          </div>
          <p style={{ color: "#64748b", fontSize: 12, marginBottom: 8 }}>Subject: <span style={{ color: "#e2e8f0" }}>{preview.subject}</span></p>
          <pre style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{preview.body}</pre>
        </div>
      )}

      {/* Template list — grouped by sequence, chronological within each group. Each
          template is still edited/deleted/sent individually; grouping is just organization. */}
      {groupTemplates(templates).map(([groupName, g]) => (
        <div key={groupName} style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <h3 style={{ color: g.isSequence ? "#a78bfa" : "#64748b", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, margin: 0 }}>{groupName}</h3>
            <span style={{ color: "#475569", fontSize: 12 }}>({g.items.length})</span>
          </div>
          {SEQUENCE_GROUP_BLURB[groupName] && (
            <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 10px" }}>{SEQUENCE_GROUP_BLURB[groupName]}</p>
          )}
          {g.items.map(t => (
            <div key={t.id} style={{ ...cardStyle, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 15 }}>
                  {g.isSequence && <span style={{ color: "#6366f1", fontWeight: 700, marginRight: 6 }}>Step {t.__step}</span>}
                  {t.name}
                </div>
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>Subject: {t.subject}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setEditing(t.id); setForm({ name: t.name, subject: t.subject, body: t.body }); setPreview(null); }} style={btnSecondary}>Edit</button>
                <button onClick={() => deleteTemplate(t.id)} style={{ ...btnSecondary, color: "#f87171", borderColor: "#f8717133" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Campaigns Tab (Send Emails) ──
function CampaignsTab({ supabase, config }) {
  const [contacts, setContacts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedContacts, setSelectedContacts] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [sendLog, setSendLog] = useState([]);
  const [batchSize, setBatchSize] = useState(10);
  const [delayMs, setDelayMs] = useState(3000);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const { data: c } = await supabase.from("sc_contacts").select("*");
    const { data: t } = await supabase.from("email_templates").select("*");
    setContacts((c || []).filter(x => x.email));
    setTemplates(t || []);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // Same search + filter semantics as the Contacts tab, so you can target the exact
  // same slice of people here that you'd find there — every contact with an email
  // is reachable, not just "New."
  const filtered = contacts.filter(c => {
    const matchesSearch = !search || [c.agency_name, c.email, c.counties_served, c.contact_name]
      .some(f => (f || "").toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = filter === "all" ? true
      : filter.startsWith("type:") ? (c.contact_type || "") === filter.slice(5)
      : filter === "burlington" ? (c.counties_served || "").toLowerCase().includes("burlington")
      : filter === "south" ? matchesRegion(c, "south")
      : filter === "central" ? matchesRegion(c, "central")
      : filter === "north" ? matchesRegion(c, "north")
      : filter === "not_contacted" ? (c.status === "new" || c.status === null)
      : c.status === filter;
    return matchesSearch && matchesStatus;
  });

  const toggleAll = () => {
    if (selectedContacts.size === filtered.length) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(filtered.map(c => c.id)));
    }
  };

  // {{first_name}} falls back to the organization name (never a blank or a literal
  // tag) when there's no personal contact name on file — same fallback used by the
  // automated Sequence A/B emails, so a template reads consistently either way it's sent.
  const firstNameOf = (name) => {
    const n = (name || "").trim();
    return n ? n.split(/\s+/)[0] : "";
  };
  const personalize = (text, contact) => {
    const first = firstNameOf(contact.contact_name);
    const greetingName = first || (contact.agency_name ? `${contact.agency_name} Team` : "there");
    return (text || "")
      .replace(/\{\{first_name\}\}/g, greetingName)
      .replace(/\{\{agency_name\}\}/g, contact.agency_name || "your agency")
      .replace(/\{\{contact_name\}\}/g, contact.contact_name || "Support Coordinator")
      .replace(/\{\{visit_date\}\}/g, "recently") // no visit-date field on ad-hoc campaign contacts
      .replace(/\{\{email\}\}/g, contact.email || "");
  };

  const sendEmails = async () => {
    if (!selectedTemplate || selectedContacts.size === 0) return;
    const template = templates.find(t => t.id === selectedTemplate);
    if (!template) return;
    setSending(true);
    setSendLog([]);
    const toSend = filtered.filter(c => selectedContacts.has(c.id));
    let sent = 0;

    for (let i = 0; i < toSend.length; i++) {
      const c = toSend[i];
      const subject = personalize(template.subject, c);
      const body = personalize(template.body, c);

      try {
        // FIX: Call the server-side API route instead of Resend directly.
        // This keeps the RESEND_API_KEY secret on the server.
        const res = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: c.email,
            subject,
            text: body,
            from: config.FROM_EMAIL,
          }),
        });
        const result = await res.json();

        if (res.ok) {
          sent++;
          setSendLog(l => [...l, { agency: c.agency_name, email: c.email, status: "sent", id: result.id }]);

          // Log to sent_emails table
          await supabase.from("sent_emails").insert([{
            contact_id: c.id,
            template_id: template.id,
            agency_name: c.agency_name,
            to_email: c.email,
            subject,
            status: "sent",
            resend_id: result.id,
          }]);

          // FIX: Use .eq() chaining instead of passing match as second arg
          await supabase.from("sc_contacts").update({ status: "contacted", updated_at: new Date().toISOString() }).eq("id", c.id);
        } else {
          setSendLog(l => [...l, { agency: c.agency_name, email: c.email, status: "failed", error: result.message || result.error || "Unknown error" }]);
        }
      } catch (e) {
        setSendLog(l => [...l, { agency: c.agency_name, email: c.email, status: "error", error: e.message }]);
      }

      // Batch delay
      if (i < toSend.length - 1) {
        if ((i + 1) % batchSize === 0) {
          setSendLog(l => [...l, { agency: "⏸️ PAUSE", email: `Batch of ${batchSize} sent. Waiting ${delayMs / 1000}s...`, status: "pause" }]);
          await new Promise(r => setTimeout(r, delayMs));
        } else {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    setSendLog(l => [...l, { agency: "✅ DONE", email: `${sent} of ${toSend.length} emails sent successfully`, status: "done" }]);
    setSending(false);
    load();
  };

  return (
    <div>
      <h2 style={{ color: "#f1f5f9", fontSize: 20, marginBottom: 4 }}>Send Campaign</h2>
      <p style={{ color: "#64748b", fontSize: 13, marginBottom: 16 }}>Select a template and contacts, then send in controlled batches to protect your domain reputation.</p>

      <input
        placeholder="Search agencies, emails, counties..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ ...inputStyle, width: "100%", marginBottom: 12, boxSizing: "border-box" }}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div>
          <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Template</label>
          <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="">Select template...</option>
            {groupTemplates(templates).map(([groupName, g]) => (
              <optgroup key={groupName} label={groupName}>
                {g.items.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Filter</label>
          <select value={filter} onChange={e => { setFilter(e.target.value); setSelectedContacts(new Set()); }} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="all">All with Email ({contacts.length})</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="replied">Replied</option>
            <option value="converted">Converted</option>
            <option value="south">South Jersey</option>
            <option value="central">Central Jersey</option>
            <option value="north">North Jersey</option>
            <option value="burlington">Burlington County</option>
            <optgroup label="Contact Type">
              {CONTACT_TYPES.map(t => (
                <option key={t.value} value={`type:${t.value}`}>{t.label}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div>
          <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Batch Size</label>
          <input type="number" value={batchSize} onChange={e => setBatchSize(parseInt(e.target.value) || 10)} style={inputStyle} min={1} max={50} />
        </div>
        <div>
          <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Delay Between Batches (s)</label>
          <input type="number" value={delayMs / 1000} onChange={e => setDelayMs((parseFloat(e.target.value) || 3) * 1000)} style={inputStyle} min={1} max={60} />
        </div>
      </div>

      {selectedTemplate && (() => {
        const t = templates.find(x => x.id === selectedTemplate);
        const info = t ? templateGroupInfo(t) : null;
        const blurb = info && SEQUENCE_GROUP_BLURB[info.group];
        if (!blurb) return null;
        return (
          <p style={{ color: "#64748b", fontSize: 12, marginTop: -12, marginBottom: 20, padding: "8px 12px", background: "#0f172a", borderRadius: 6 }}>
            ℹ️ Step {info.step} of <strong style={{ color: "#94a3b8" }}>{info.group}</strong> — {blurb} Sending it here is a one-off to your selected contacts and won't affect the automated schedule for anyone currently in that sequence.
          </p>
        );
      })()}

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={toggleAll} style={btnSecondary}>
              {selectedContacts.size === filtered.length && filtered.length > 0 ? "Deselect All" : `Select All (${filtered.length})`}
            </button>
            <span style={{ color: "#64748b", fontSize: 13 }}>{selectedContacts.size} selected</span>
          </div>
          <button
            onClick={sendEmails}
            disabled={sending || !selectedTemplate || selectedContacts.size === 0}
            style={{ ...btnPrimary, opacity: (sending || !selectedTemplate || selectedContacts.size === 0) ? 0.4 : 1 }}
          >
            {sending ? "⏳ Sending..." : `🚀 Send to ${selectedContacts.size} Contacts`}
          </button>
        </div>

        <div style={{ maxHeight: 320, overflow: "auto" }}>
          {filtered.length === 0 ? (
            <p style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: 24 }}>No contacts match this filter or none have emails.</p>
          ) : (
            filtered.map(c => (
              <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #1e293b", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={selectedContacts.has(c.id)}
                  onChange={() => {
                    const next = new Set(selectedContacts);
                    next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                    setSelectedContacts(next);
                  }}
                  style={{ accentColor: "#6366f1" }}
                />
                <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, minWidth: 220 }}>{c.agency_name}</span>
                <span style={{ color: "#7dd3fc", fontSize: 12 }}>{c.email}</span>
                <span style={{ color: "#475569", fontSize: 11, marginLeft: "auto", flexShrink: 0 }}>{c.counties_served || ""}</span>
              </label>
            ))
          )}
        </div>
      </div>

      {sendLog.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ color: "#f1f5f9", fontSize: 15, marginBottom: 12 }}>Send Log</h3>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            {sendLog.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid #0f172a", fontSize: 12 }}>
                <span style={{ color: l.status === "sent" ? "#4ade80" : l.status === "pause" ? "#fbbf24" : l.status === "done" ? "#a78bfa" : "#f87171", fontWeight: 700, minWidth: 20 }}>
                  {l.status === "sent" ? "✅" : l.status === "pause" ? "⏸️" : l.status === "done" ? "🎉" : "❌"}
                </span>
                <span style={{ color: "#e2e8f0", minWidth: 220 }}>{l.agency}</span>
                <span style={{ color: "#64748b" }}>{l.email}</span>
                {l.error && <span style={{ color: "#f87171" }}>{l.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sent Log Tab ──
function SentTab({ supabase }) {
  const [sent, setSent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("sent_emails").select("*").order("sent_at", { ascending: false });
      setSent(data || []);
      setLoading(false);
    })();
  }, [supabase]);

  const filtered = sent.filter(s => {
    if (dateFilter === "today") {
      const today = new Date().toDateString();
      return new Date(s.sent_at).toDateString() === today;
    }
    if (dateFilter === "week") {
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      return new Date(s.sent_at) >= weekAgo;
    }
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ color: "#f1f5f9", fontSize: 20, margin: 0 }}>Sent Email Log</h2>
          <p style={{ color: "#64748b", fontSize: 13, margin: "4px 0 0" }}>{sent.length} total · {filtered.length} shown</p>
        </div>
        <select value={dateFilter} onChange={e => setDateFilter(e.target.value)} style={{ ...inputStyle, width: "auto", cursor: "pointer" }}>
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">Last 7 Days</option>
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>Loading sent log...</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: 48, color: "#64748b" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
          <p>No emails sent yet. Create a campaign to get started.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                {["Agency", "To", "Subject", "Status", "Sent At"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px", color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, borderBottom: "1px solid #1e293b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr key={s.id || i} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "12px 14px", color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>{s.agency_name}</td>
                  <td style={{ padding: "12px 14px", color: "#7dd3fc", fontSize: 13 }}>{s.to_email}</td>
                  <td style={{ padding: "12px 14px", color: "#94a3b8", fontSize: 12, maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.subject}</td>
                  <td style={{ padding: "12px 14px" }}>
                    <span style={{ padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, background: s.status === "sent" ? "#10b98122" : "#f8717122", color: s.status === "sent" ? "#10b981" : "#f87171" }}>
                      {s.status}
                    </span>
                  </td>
                  <td style={{ padding: "12px 14px", color: "#64748b", fontSize: 12 }}>
                    {s.sent_at ? new Date(s.sent_at).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Sequences Tab ──
function SequencesTab({ supabase }) {
  const [sequences, setSequences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [modalSeq, setModalSeq] = useState(null);
  const [filter, setFilter] = useState("all");
  const [bannerHidden, setBannerHidden] = useState(false);

  // Fix 6 — restore the banner's hidden preference from localStorage.
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage.getItem("seq_banner_hidden") === "1") {
        setBannerHidden(true);
      }
    } catch (e) { /* localStorage unavailable — show banner */ }
  }, []);

  const hideBanner = () => {
    setBannerHidden(true);
    try { window.localStorage.setItem("seq_banner_hidden", "1"); } catch (e) { /* ignore */ }
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("email_sequences").select("*").order("created_at", { ascending: false });
    setSequences(data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // Only sequences that are no longer running (exited via reply, or manually stopped) can be deleted —
  // active/paused/completed sequences stay to preserve history and the send schedule.
  const [confirmDeleteSeq, setConfirmDeleteSeq] = useState(null);
  const deleteSequence = async (id) => {
    setSequences((prev) => prev.filter((s) => s.id !== id));
    setConfirmDeleteSeq(null);
    await supabase.from("email_sequences").delete().eq("id", id);
  };

  const runCheck = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/cron/sequence-runner", {
        method: "POST",
        headers: { "x-manual-trigger": "1" },
      });
      const data = await res.json();
      setRunResult(data);
    } catch (e) {
      setRunResult({ error: e.message });
    }
    setRunning(false);
    load();
  };

  const counts = sequences.reduce((a, s) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, {});
  const filtered = sequences.filter((s) => (filter === "all" ? true : s.status === filter));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ color: "#f1f5f9", fontSize: 20, margin: 0 }}>Email Sequences</h2>
          <p style={{ color: "#64748b", fontSize: 13, margin: "4px 0 0" }}>
            {sequences.length} total · {counts.active || 0} active · {counts.paused || 0} paused · {counts.completed || 0} complete
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...inputStyle, width: "auto", cursor: "pointer" }}>
            <option value="all">All ({sequences.length})</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="exited_reply">Replied — exited</option>
            <option value="stopped">Stopped</option>
          </select>
          <button onClick={runCheck} disabled={running} style={{ ...btnPrimary, opacity: running ? 0.5 : 1 }}>
            {running ? "⏳ Running..." : "▶ Run sequence check"}
          </button>
        </div>
      </div>

      {!bannerHidden && (
        <div style={{ background: "#0f172a", borderLeft: "4px solid #6366f1", borderRadius: 8, padding: "16px 18px", marginBottom: 16, position: "relative" }}>
          <button onClick={hideBanner} title="Hide" style={{ position: "absolute", top: 10, right: 12, background: "none", border: "none", color: "#64748b", fontSize: 16, cursor: "pointer" }}>✕</button>
          <h3 style={{ color: "#f1f5f9", fontSize: 15, margin: "0 0 10px", fontWeight: 700 }}>Two sequences, one goal — referrals</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <p style={{ color: "#a78bfa", fontSize: 13, fontWeight: 700, margin: "0 0 4px" }}>Sequence A — Post In-Person Visit</p>
              <p style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6, margin: 0 }}>
                Triggered when you log an in-person visit for a contact. 5 emails over 21 days. Tone is warm and personal — references the visit, builds on the relationship you already started in person.
                <br /><span style={{ color: "#64748b" }}>Steps: Day 0, Day 3, Day 7, Day 14, Day 21.</span>
              </p>
            </div>
            <div>
              <p style={{ color: "#7dd3fc", fontSize: 13, fontWeight: 700, margin: "0 0 4px" }}>Sequence B — Cold Outreach</p>
              <p style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6, margin: 0 }}>
                Triggered automatically when a new contact is added with no in-person visit. 5 emails over 23 days. Tone is professional and credibility-first — introduces Harmony from scratch to someone who has never met you.
                <br /><span style={{ color: "#64748b" }}>Steps: Day 0, Day 4, Day 9, Day 16, Day 23.</span>
              </p>
            </div>
          </div>
          <p style={{ color: "#64748b", fontSize: 11, margin: "12px 0 0", lineHeight: 1.5 }}>
            <strong style={{ color: "#94a3b8" }}>Exit conditions for both:</strong> contact replies (mark as replied), contact is converted (status = converted auto-stops), contact unsubscribes (mark unsubscribed).
          </p>
        </div>
      )}

      <p style={{ color: "#475569", fontSize: 12, marginBottom: 16 }}>
        “Run sequence check” triggers the daily runner now — it sends every step whose send date is due today. The same job runs automatically each morning via Vercel Cron.
      </p>

      {runResult && (() => {
        const failed = (runResult.results || []).filter((r) => r.status === "failed" || r.status === "error");
        return (
        <div style={{ ...cardStyle, marginBottom: 20, borderColor: (runResult.error || failed.length > 0) ? "#f8717155" : "#6366f155" }}>
          {runResult.error ? (
            <p style={{ color: "#f87171", fontSize: 13, margin: 0 }}>⚠️ Error: {runResult.error}</p>
          ) : (
            <>
              <p style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>{runResult.message}</p>
              {failed.length > 0 && (
                <p style={{ color: "#f87171", fontSize: 13, fontWeight: 600, margin: "0 0 8px", padding: "8px 10px", background: "#f8717111", borderRadius: 6 }}>
                  ⚠️ {failed.length} send{failed.length > 1 ? "s" : ""} failed — {failed[0].error || "see details below"} (check RESEND_API_KEY and that the domain is verified in Resend)
                </p>
              )}
              {(runResult.results || []).length > 0 && (
                <div style={{ maxHeight: 200, overflow: "auto" }}>
                  {runResult.results.map((r, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, padding: "5px 0", borderBottom: "1px solid #0f172a", fontSize: 12 }}>
                      <span style={{ color: r.status === "sent" ? "#4ade80" : r.status === "skipped" ? "#94a3b8" : "#f87171", fontWeight: 700, minWidth: 18 }}>
                        {r.status === "sent" ? "✅" : r.status === "skipped" ? "⏭" : "❌"}
                      </span>
                      <span style={{ color: "#e2e8f0", minWidth: 200 }}>{r.agency || "—"}</span>
                      <span style={{ color: "#64748b" }}>{r.step ? `Step ${r.step}` : ""} {r.subject || r.error || r.reason || ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        );
      })()}

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>Loading sequences...</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: 48, color: "#64748b" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔁</div>
          <p style={{ fontSize: 15, color: "#94a3b8", marginBottom: 6 }}>No sequences yet</p>
          <p style={{ fontSize: 13 }}>Sequences start automatically when you add a contact (Sequence B) or log an in-person visit (Sequence A).</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                {["Agency", "Contact", "Type", "Status", "Next Send", "Step", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px", color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, borderBottom: "1px solid #1e293b", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "12px 14px", color: "#e2e8f0", fontSize: 13, fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.agency_name || "—"}</td>
                  <td style={{ padding: "12px 14px", color: "#94a3b8", fontSize: 13 }}>{s.contact_name || "—"}</td>
                  <td style={{ padding: "12px 14px", color: "#7dd3fc", fontSize: 13, whiteSpace: "nowrap" }}>Seq {SEQUENCE_LABEL[s.sequence_type]}</td>
                  <td style={{ padding: "12px 14px" }}><SequencePill seq={s} onClick={() => setModalSeq(s)} /></td>
                  <td style={{ padding: "12px 14px", color: "#94a3b8", fontSize: 12, whiteSpace: "nowrap" }}>{s.next_send_date || "—"}</td>
                  <td style={{ padding: "12px 14px", color: "#94a3b8", fontSize: 13 }}>{s.current_step} / {TOTAL_STEPS}</td>
                  <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
                      <button
                        onClick={() => setModalSeq(s)}
                        style={{ background: "none", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", fontSize: 12, padding: "4px 12px", cursor: "pointer" }}
                      >
                        View
                      </button>
                      {(s.status === "exited_reply" || s.status === "stopped") && (
                        confirmDeleteSeq === s.id ? (
                          <>
                            <button onClick={() => deleteSequence(s.id)} style={{ background: "none", border: "1px solid #f8717155", borderRadius: 6, color: "#f87171", fontSize: 12, padding: "4px 10px", cursor: "pointer" }}>Confirm</button>
                            <button onClick={() => setConfirmDeleteSeq(null)} style={{ background: "none", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", fontSize: 12, padding: "4px 10px", cursor: "pointer" }}>Cancel</button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteSeq(s.id)}
                            title="Delete sequence"
                            style={{ background: "none", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", fontSize: 12, padding: "4px 10px", cursor: "pointer" }}
                            onMouseEnter={e => { e.target.style.borderColor = "#f87171"; e.target.style.color = "#f87171"; }}
                            onMouseLeave={e => { e.target.style.borderColor = "#334155"; e.target.style.color = "#94a3b8"; }}
                          >
                            Delete
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalSeq && <SequenceModal supabase={supabase} seq={modalSeq} onClose={() => setModalSeq(null)} onChange={load} />}
    </div>
  );
}

// ── Tracker Tab (CRM pipeline / activity log / follow-ups) — fully self-contained ──
const TRK_ORG_TYPES = [
  { value: "support_coordination", label: "Support Coordination", color: "#14b8a6" },
  { value: "nursing_home", label: "Nursing Home", color: "#3b82f6" },
  { value: "rehab_center", label: "Rehab Center", color: "#8b5cf6" },
  { value: "assisted_living", label: "Assisted Living", color: "#f59e0b" },
  { value: "doctors_office", label: "Doctor's Office", color: "#fb7185" },
  { value: "pediatric_practice", label: "Pediatric Practice", color: "#ec4899" },
  { value: "adult_day_program", label: "Adult Day Program", color: "#22c55e" },
  { value: "networking", label: "Networking", color: "#6b7280" },
  { value: "insurance_company", label: "Insurance Company", color: "#ec4899" },
];
const TRK_ORG_TYPE_COLOR = Object.fromEntries(TRK_ORG_TYPES.map((t) => [t.value, t.color]));
const TRK_ORG_TYPE_LABEL = Object.fromEntries(TRK_ORG_TYPES.map((t) => [t.value, t.label]));

const TRK_STAGE_CYCLE = ["cold", "warm", "referred"];
const TRK_STAGE_COLOR = { cold: "#ef4444", warm: "#f59e0b", referred: "#22c55e" };

const TRK_RECEPTIVITY_CYCLE = ["unknown", "receptive", "neutral", "not_receptive"];
const TRK_RECEPTIVITY_COLOR = { unknown: "#6b7280", receptive: "#22c55e", neutral: "#f59e0b", not_receptive: "#ef4444" };

const TRK_ROLE_CYCLE = ["unknown", "gatekeeper", "decision_maker", "champion", "neutral", "blocker"];
const TRK_ROLE_COLOR = { unknown: "#6b7280", gatekeeper: "#f59e0b", decision_maker: "#8b5cf6", champion: "#fbbf24", neutral: "#94a3b8", blocker: "#ef4444" };

const TRK_ACTIVITY_TYPES = [
  { value: "call", label: "Call", points: 10, icon: "📞" },
  { value: "email", label: "Email", points: 5, icon: "✉️" },
  { value: "in_person_visit", label: "In-Person Visit", points: 25, icon: "🤝" },
  { value: "drop_off", label: "Drop-off", points: 15, icon: "📦" },
  { value: "followup_call", label: "Follow-up Call", points: 10, icon: "🔁" },
  { value: "text", label: "Text", points: 5, icon: "💬" },
  { value: "referral_received", label: "Referral Received", points: 100, icon: "⭐" },
];
const TRK_POINTS = Object.fromEntries(TRK_ACTIVITY_TYPES.map((a) => [a.value, a.points]));
const TRK_ACTIVITY_LABEL = Object.fromEntries(TRK_ACTIVITY_TYPES.map((a) => [a.value, a.label]));
const TRK_ACTIVITY_ICON = Object.fromEntries(TRK_ACTIVITY_TYPES.map((a) => [a.value, a.icon]));

const TRK_OUTCOMES = ["", "positive", "neutral", "no_answer", "left_message", "referral_received", "not_interested"];

// Priority tiers for the Activity Log, hottest lead first — referral received are connections to
// maintain, then positive, then neutral, then everything else (coldest — no clear positive signal yet).
const TRK_OUTCOME_RANK = { referral_received: 0, positive: 1, neutral: 2 };
const trkOutcomeRank = (a) => (a.outcome in TRK_OUTCOME_RANK ? TRK_OUTCOME_RANK[a.outcome] : 3);
const TRK_OUTCOME_RANK_COLOR = ["#22c55e", "#0ea5e9", "#f59e0b", "#475569"];

const TRK_TASK_TYPES = [
  { value: "call", label: "Call", activity: "call" },
  { value: "email", label: "Email", activity: "email" },
  { value: "visit", label: "Visit", activity: "in_person_visit" },
  { value: "send_materials", label: "Send Materials", activity: "drop_off" },
];
const TRK_TASK_ACTIVITY = Object.fromEntries(TRK_TASK_TYPES.map((t) => [t.value, t.activity]));

function trkToday() { return new Date().toISOString().slice(0, 10); }
function trkDaysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  const t = new Date(`${trkToday()}T00:00:00Z`);
  return Math.round((t - d) / 86400000);
}
function trkPretty(s) { return (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
function trkWeekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // back to Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}
function trkPrevWeek(weekKey) {
  const d = new Date(`${weekKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}
// Consecutive weeks (most recent) with 5+ distinct contacts in activities.
function trkComputeStreak(activities) {
  const byWeek = {};
  for (const a of activities) {
    if (!a.activity_date || !a.contact_id) continue;
    const k = trkWeekKey(a.activity_date);
    (byWeek[k] = byWeek[k] || new Set()).add(a.contact_id);
  }
  let streak = 0;
  let cursor = trkWeekKey(trkToday());
  let firstIter = true;
  while (true) {
    const set = byWeek[cursor];
    if (set && set.size >= 5) { streak++; cursor = trkPrevWeek(cursor); firstIter = false; }
    else if (firstIter) { cursor = trkPrevWeek(cursor); firstIter = false; } // skip in-progress current week once
    else break;
  }
  return streak;
}

function TrkBadge({ text, color, onClick, title, star }) {
  return (
    <span
      onClick={onClick}
      title={title || (onClick ? "Click to cycle" : "")}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 99,
        fontSize: 11, fontWeight: 700, background: color + "22", color, border: `1px solid ${color}33`,
        cursor: onClick ? "pointer" : "default", whiteSpace: "nowrap", textTransform: "capitalize",
      }}
    >
      {star && <span style={{ color: "#fbbf24" }}>★</span>}{text}
    </span>
  );
}

function TrackerTab({ supabase }) {
  const [subView, setSubView] = useState("pipeline");
  const [pipelineMode, setPipelineMode] = useState("org");
  const [pipelineSearch, setPipelineSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [activities, setActivities] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [expandedOrgs, setExpandedOrgs] = useState(new Set());
  const [confirmDelete, setConfirmDelete] = useState(null); // activity id pending delete confirm
  const [expandedNotes, setExpandedNotes] = useState(new Set());

  // Activity log filters + modal
  const [filterType, setFilterType] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [orgSearch, setOrgSearch] = useState("");
  const [showLogModal, setShowLogModal] = useState(false);
  const emptyLog = { contact_id: "", activity_type: "call", activity_date: trkToday(), location: "", person_met: "", outcome: "", notes: "" };
  const [logForm, setLogForm] = useState(emptyLog);
  const [logSearch, setLogSearch] = useState("");

  // Subtasks — a task attached to a specific logged activity, checkable inline.
  const [addingTaskFor, setAddingTaskFor] = useState(null); // activity id with the inline add-task form open
  const emptySubtask = { due_date: trkToday(), notes: "" };
  const [subtaskDraft, setSubtaskDraft] = useState(emptySubtask);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [c, o, a, t] = await Promise.all([
      supabase.from("sc_contacts").select("*"),
      supabase.from("organizations").select("*"),
      supabase.from("outreach_activities").select("*").order("activity_date", { ascending: false }),
      supabase.from("followup_tasks").select("*").order("due_date", { ascending: true }),
    ]);
    setContacts(c.data || []);
    setOrganizations(o.data || []);
    setActivities(a.data || []);
    setTasks(t.data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const contactLabel = (c) => `${c.contact_name || "(no name)"} · ${c.agency_name || ""}`;

  // ── Optimistic badge cycles ──
  const cycleOrgStage = async (org) => {
    const next = TRK_STAGE_CYCLE[(TRK_STAGE_CYCLE.indexOf(org.relationship_stage || "cold") + 1) % TRK_STAGE_CYCLE.length];
    setOrganizations((p) => p.map((o) => (o.id === org.id ? { ...o, relationship_stage: next } : o)));
    await supabase.from("organizations").update({ relationship_stage: next, updated_at: new Date().toISOString() }).eq("id", org.id);
  };
  const cycleContactStage = async (c) => {
    const next = TRK_STAGE_CYCLE[(TRK_STAGE_CYCLE.indexOf(c.relationship_stage || "cold") + 1) % TRK_STAGE_CYCLE.length];
    setContacts((p) => p.map((x) => (x.id === c.id ? { ...x, relationship_stage: next } : x)));
    await supabase.from("sc_contacts").update({ relationship_stage: next, updated_at: new Date().toISOString() }).eq("id", c.id);
  };
  const cycleReceptivity = async (c) => {
    const next = TRK_RECEPTIVITY_CYCLE[(TRK_RECEPTIVITY_CYCLE.indexOf(c.receptivity || "unknown") + 1) % TRK_RECEPTIVITY_CYCLE.length];
    setContacts((p) => p.map((x) => (x.id === c.id ? { ...x, receptivity: next } : x)));
    await supabase.from("sc_contacts").update({ receptivity: next, updated_at: new Date().toISOString() }).eq("id", c.id);
  };
  const cycleRole = async (c) => {
    const next = TRK_ROLE_CYCLE[(TRK_ROLE_CYCLE.indexOf(c.contact_role || "unknown") + 1) % TRK_ROLE_CYCLE.length];
    setContacts((p) => p.map((x) => (x.id === c.id ? { ...x, contact_role: next } : x)));
    await supabase.from("sc_contacts").update({ contact_role: next, updated_at: new Date().toISOString() }).eq("id", c.id);
  };

  // ── Shared: write an activity + award points + side effects ──
  const logActivityRow = async ({ contact, activity_type, activity_date, location, person_met, outcome, notes }) => {
    const pts = TRK_POINTS[activity_type] || 0;
    await supabase.from("outreach_activities").insert([{
      contact_id: contact.id,
      organization_id: contact.organization_id || null,
      activity_type,
      activity_date,
      location: location || null,
      person_met: person_met || null,
      outcome: outcome || null,
      notes: notes || null,
      points_awarded: pts,
    }]);
    await supabase.from("sc_contacts").update({
      lead_score: (contact.lead_score || 0) + pts,
      last_activity_date: activity_date,
      updated_at: new Date().toISOString(),
    }).eq("id", contact.id);
    if (contact.organization_id) {
      const org = organizations.find((o) => o.id === contact.organization_id);
      if (org) {
        await supabase.from("organizations").update({ lead_score: (org.lead_score || 0) + pts, updated_at: new Date().toISOString() }).eq("id", org.id);
      }
    }
    // Auto-create a post_visit sequence when an in-person visit is logged and none is active.
    if (activity_type === "in_person_visit") {
      const { data: existing } = await supabase.from("email_sequences").select("id").eq("contact_id", contact.id).eq("status", "active").limit(1);
      if (!existing || existing.length === 0) {
        await supabase.from("email_sequences").insert([{
          contact_id: contact.id,
          sequence_type: "post_visit",
          visit_date: activity_date,
          next_send_date: activity_date,
          current_step: 1,
          status: "active",
          contact_email: contact.email || null,
          contact_name: contact.contact_name || null,
          agency_name: contact.agency_name || null,
        }]);
      }
    }
  };

  const saveActivity = async () => {
    const contact = contacts.find((c) => c.id === logForm.contact_id);
    if (!contact || !logForm.activity_type) { alert("Pick a contact and activity type."); return; }
    const outcome = logForm.outcome || (logForm.activity_type === "referral_received" ? "referral_received" : "");
    await logActivityRow({ contact, ...logForm, outcome });
    setShowLogModal(false);
    setLogForm(emptyLog);
    setLogSearch("");
    loadAll();
  };

  // Add a subtask to a specific logged activity.
  const addSubtask = async (activity) => {
    if (!subtaskDraft.notes.trim()) return;
    const { data: inserted } = await supabase.from("followup_tasks").insert([{
      activity_id: activity.id,
      contact_id: activity.contact_id,
      organization_id: activity.organization_id || null,
      task_type: "follow_up",
      due_date: subtaskDraft.due_date || trkToday(),
      priority: "normal",
      notes: subtaskDraft.notes.trim(),
    }]).select();
    if (inserted?.[0]) setTasks((prev) => [...prev, inserted[0]]);
    setAddingTaskFor(null);
    setSubtaskDraft(emptySubtask);
  };

  // Check a subtask done (or reopen it) without logging a new activity — it's a checklist item, not a follow-up.
  const toggleSubtask = async (task) => {
    const nextCompleted = !task.completed;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: nextCompleted, completed_at: nextCompleted ? new Date().toISOString() : null } : t)));
    await supabase.from("followup_tasks").update({ completed: nextCompleted, completed_at: nextCompleted ? new Date().toISOString() : null }).eq("id", task.id);
  };

  // Remove a subtask outright — for fixing mistakes, no confirmation needed since it's low-stakes.
  const deleteSubtask = async (task) => {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    await supabase.from("followup_tasks").delete().eq("id", task.id);
  };

  // ── Derived stats ──
  const countStage = (st) => contacts.filter((c) => (c.relationship_stage || "cold") === st).length;
  const totalReferrals = activities.filter((a) => a.outcome === "referral_received").length;
  const totalPoints = contacts.reduce((s, c) => s + (c.lead_score || 0), 0);
  const streak = trkComputeStreak(activities);

  const toggleOrg = (id) => setExpandedOrgs((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Org milestone badges (computed, never stored) ──
  const orgMilestones = (org) => {
    const acts = activities.filter((a) => a.organization_id === org.id);
    const orgContacts = contacts.filter((c) => c.organization_id === org.id);
    const recent = acts.filter((a) => { const d = trkDaysSince(a.activity_date); return d != null && d <= 14; });
    const referrals = acts.filter((a) => a.outcome === "referral_received");
    return [
      { label: "🚪 Door Opened", on: acts.length >= 1 },
      { label: "👥 Multi-Touch", on: orgContacts.length >= 2 },
      { label: "🔑 Found the Key", on: !!org.champion_contact_id },
      { label: "🔥 On Fire", on: recent.length >= 3 },
      { label: "✅ Referred", on: referrals.length >= 1 },
      { label: "💎 VIP", on: referrals.length >= 3 },
    ].filter((m) => m.on);
  };

  const pillToggle = (active) => ({ ...pillStyle(active), padding: "6px 16px", fontSize: 12 });

  // ── Renderers ──
  const renderStatsBar = () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 20 }}>
      {[
        { label: "Cold", value: countStage("cold"), color: "#ef4444" },
        { label: "Warm", value: countStage("warm"), color: "#f59e0b" },
        { label: "Referred", value: countStage("referred"), color: "#22c55e" },
        { label: "Referrals", value: totalReferrals, color: "#a78bfa" },
        { label: "Total Points", value: totalPoints, color: "#0ea5e9" },
        { label: "🔥 Streak", value: `${streak} wk`, color: "#fb923c" },
      ].map((s) => (
        <div key={s.label} style={{ ...cardStyle, padding: 14, textAlign: "center" }}>
          <div style={{ color: s.color, fontSize: 24, fontWeight: 800 }}>{s.value}</div>
          <div style={{ color: "#64748b", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );

  const renderOrgCard = (org) => {
    const orgContacts = contacts.filter((c) => c.organization_id === org.id);
    const champion = contacts.find((c) => c.id === org.champion_contact_id);
    const expanded = expandedOrgs.has(org.id);
    const stage = org.relationship_stage || "cold";
    return (
      <div key={org.id} style={{ ...cardStyle, padding: 14, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => toggleOrg(org.id)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>{expanded ? "▾" : "▸"}</button>
          <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{org.name}</span>
          <TrkBadge text={TRK_ORG_TYPE_LABEL[org.org_type] || org.org_type} color={TRK_ORG_TYPE_COLOR[org.org_type] || "#6b7280"} />
          <TrkBadge text={stage} color={TRK_STAGE_COLOR[stage]} onClick={() => cycleOrgStage(org)} />
          <span style={{ color: "#0ea5e9", fontSize: 12, fontWeight: 700 }}>⚡ {org.lead_score || 0}</span>
          {champion && <span style={{ color: "#fbbf24", fontSize: 12, fontWeight: 600 }} title="Champion">★ {champion.contact_name || champion.agency_name}</span>}
        </div>
        {orgMilestones(org).length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, paddingLeft: 24 }}>
            {orgMilestones(org).map((m) => (
              <span key={m.label} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "#1e293b", color: "#cbd5e1" }}>{m.label}</span>
            ))}
          </div>
        )}
        {expanded && (
          <div style={{ marginTop: 10, paddingLeft: 24 }}>
            {orgContacts.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: 12 }}>No contacts linked to this organization.</p>
            ) : orgContacts.map((c) => {
              const ds = trkDaysSince(c.last_activity_date);
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid #1e293b", flexWrap: "wrap" }}>
                  <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, minWidth: 140 }}>{c.contact_name || "—"}</span>
                  <span style={{ color: "#94a3b8", fontSize: 12, minWidth: 100 }}>{c.title || "—"}</span>
                  <TrkBadge text={c.receptivity || "unknown"} color={TRK_RECEPTIVITY_COLOR[c.receptivity || "unknown"]} onClick={() => cycleReceptivity(c)} />
                  <span style={{ color: "#64748b", fontSize: 11, marginLeft: "auto" }}>{ds == null ? "no activity" : `${ds}d since last`}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderContactCard = (c) => {
    const stage = c.relationship_stage || "cold";
    const ds = trkDaysSince(c.last_activity_date);
    const overdue = c.next_followup_date && c.next_followup_date < trkToday();
    return (
      <div key={c.id} style={{ ...cardStyle, padding: 14, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{c.contact_name || "(no name)"}</span>
          <span style={{ color: "#94a3b8", fontSize: 12 }}>{c.agency_name}</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <TrkBadge text={CONTACT_TYPE_LABEL[c.contact_type] || trkPretty(c.contact_type || "support_coordination")} color={CONTACT_TYPE_COLOR[c.contact_type] || "#0ea5e9"} />
          <TrkBadge text={stage} color={TRK_STAGE_COLOR[stage]} onClick={() => cycleContactStage(c)} />
          <TrkBadge text={c.receptivity || "unknown"} color={TRK_RECEPTIVITY_COLOR[c.receptivity || "unknown"]} onClick={() => cycleReceptivity(c)} />
          <TrkBadge text={trkPretty(c.contact_role || "unknown")} color={TRK_ROLE_COLOR[c.contact_role || "unknown"]} onClick={() => cycleRole(c)} star={c.contact_role === "champion"} />
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 11, color: "#64748b" }}>
          <span style={{ color: "#0ea5e9", fontWeight: 700 }}>⚡ {c.lead_score || 0} pts</span>
          <span>{ds == null ? "no activity" : `${ds}d since last`}</span>
          <span style={{ color: overdue ? "#ef4444" : "#64748b", fontWeight: overdue ? 700 : 400 }}>
            {c.next_followup_date ? `follow-up ${c.next_followup_date}${overdue ? " (overdue)" : ""}` : "no follow-up set"}
          </span>
        </div>
      </div>
    );
  };

  const renderPipeline = () => {
    const q = pipelineSearch.trim().toLowerCase();
    const matchesSearch = (it) => !q || [it.agency_name, it.contact_name, it.name, it.email, it.counties_served]
      .some((f) => (f || "").toLowerCase().includes(q));
    return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setPipelineMode("org")} style={pillToggle(pipelineMode === "org")}>By Organization</button>
        <button onClick={() => setPipelineMode("contact")} style={pillToggle(pipelineMode === "contact")}>By Contact</button>
        <input
          placeholder="Search by name, email, county..."
          value={pipelineSearch}
          onChange={(e) => setPipelineSearch(e.target.value)}
          style={{ ...inputStyle, width: 260, marginLeft: "auto" }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {TRK_STAGE_CYCLE.map((stage) => {
          const items = (pipelineMode === "org"
            ? organizations.filter((o) => (o.relationship_stage || "cold") === stage)
            : contacts.filter((c) => (c.relationship_stage || "cold") === stage)).filter(matchesSearch);
          return (
            <div key={stage} style={{ background: "#0f172a", borderRadius: 12, padding: 12, minHeight: 120 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 99, background: TRK_STAGE_COLOR[stage] }} />
                <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700, textTransform: "capitalize" }}>{stage}</span>
                <span style={{ color: "#64748b", fontSize: 12, marginLeft: "auto" }}>{items.length}</span>
              </div>
              {items.length === 0
                ? <p style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: "20px 0" }}>Empty</p>
                : items.map((it) => (pipelineMode === "org" ? renderOrgCard(it) : renderContactCard(it)))}
            </div>
          );
        })}
      </div>
    </div>
    );
  };

  const toggleNote = (id) => setExpandedNotes((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Fix 1 + Fix 3 — delete an activity, reverse its awarded points, update totals optimistically.
  const deleteActivity = async (a) => {
    const pts = a.points_awarded || 0;
    const contact = contacts.find((c) => c.id === a.contact_id);
    const org = a.organization_id ? organizations.find((o) => o.id === a.organization_id) : null;

    // Optimistic UI — totalPoints is derived from contacts.lead_score, so this updates the stats bar instantly.
    setActivities((prev) => prev.filter((x) => x.id !== a.id));
    if (contact) setContacts((prev) => prev.map((c) => (c.id === contact.id ? { ...c, lead_score: Math.max(0, (c.lead_score || 0) - pts) } : c)));
    if (org) setOrganizations((prev) => prev.map((o) => (o.id === org.id ? { ...o, lead_score: Math.max(0, (o.lead_score || 0) - pts) } : o)));
    setConfirmDelete(null);

    // Persist
    await supabase.from("outreach_activities").delete().eq("id", a.id);
    if (contact) await supabase.from("sc_contacts").update({ lead_score: Math.max(0, (contact.lead_score || 0) - pts) }).eq("id", contact.id);
    if (org) await supabase.from("organizations").update({ lead_score: Math.max(0, (org.lead_score || 0) - pts) }).eq("id", org.id);
  };

  const renderActivityLog = () => {
    const filtered = activities.filter((a) => {
      if (filterType !== "all" && a.activity_type !== filterType) return false;
      if (filterFrom && a.activity_date < filterFrom) return false;
      if (filterTo && a.activity_date > filterTo) return false;
      if (orgSearch) {
        const org = organizations.find((o) => o.id === a.organization_id);
        const contact = contacts.find((c) => c.id === a.contact_id);
        const hay = `${org?.name || ""} ${contact?.contact_name || ""} ${contact?.agency_name || ""}`.toLowerCase();
        if (!hay.includes(orgSearch.toLowerCase())) return false;
      }
      return true;
    }).sort((a, b) => {
      const r = trkOutcomeRank(a) - trkOutcomeRank(b);
      if (r !== 0) return r;
      return (b.activity_date || "").localeCompare(a.activity_date || ""); // most recent first within a tier
    });
    return (
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ ...inputStyle, width: "auto", cursor: "pointer" }}>
            <option value="all">All types</option>
            {TRK_ACTIVITY_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
          <input placeholder="Search org/contact..." value={orgSearch} onChange={(e) => setOrgSearch(e.target.value)} style={{ ...inputStyle, width: 220 }} />
          <button onClick={() => setShowLogModal(true)} style={{ ...btnPrimary, marginLeft: "auto" }}>+ Log Activity</button>
        </div>
        <p style={{ color: "#475569", fontSize: 11, marginBottom: 12 }}>Sorted by priority — referral received first, then positive, then neutral, then everything else.</p>
        {filtered.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: "center", padding: 40, color: "#64748b" }}>No activities logged yet.</div>
        ) : filtered.map((a) => {
          const org = organizations.find((o) => o.id === a.organization_id);
          const contact = contacts.find((c) => c.id === a.contact_id);
          const noteOpen = expandedNotes.has(a.id);
          const longNote = (a.notes || "").length > 60;
          const rankColor = TRK_OUTCOME_RANK_COLOR[trkOutcomeRank(a)];
          return (
            <div key={a.id} style={{ ...cardStyle, padding: "12px 16px", marginBottom: 8, borderLeft: `3px solid ${rankColor}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ color: "#64748b", fontSize: 12, minWidth: 92 }}>{a.activity_date}</span>
                <span style={{ fontSize: 16 }}>{TRK_ACTIVITY_ICON[a.activity_type] || "•"}</span>
                <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, minWidth: 160 }}>{org?.name || contact?.agency_name || contact?.contact_name || "—"}</span>
                <span style={{ color: "#94a3b8", fontSize: 12 }}>{TRK_ACTIVITY_LABEL[a.activity_type] || a.activity_type}</span>
                {a.outcome && <TrkBadge text={trkPretty(a.outcome)} color={rankColor} />}
                <span style={{ color: "#0ea5e9", fontSize: 11, fontWeight: 700 }}>+{a.points_awarded || 0}</span>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                  {confirmDelete === a.id ? (
                    <>
                      <span style={{ color: "#f87171", fontSize: 12 }}>Delete this activity?</span>
                      <button onClick={() => deleteActivity(a)} style={{ ...btnSecondary, color: "#f87171", borderColor: "#f8717133", padding: "4px 10px", fontSize: 11 }}>Confirm</button>
                      <button onClick={() => setConfirmDelete(null)} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 11 }}>Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(a.id)} title="Delete activity" style={{ background: "none", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", fontSize: 13, padding: "4px 9px", cursor: "pointer" }}>🗑</button>
                  )}
                </div>
              </div>
              {a.notes && (
                <div style={{ color: "#64748b", fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
                  {(!longNote || noteOpen) ? a.notes : `${a.notes.slice(0, 60)}… `}
                  {longNote && (
                    <span onClick={() => toggleNote(a.id)} style={{ color: "#6366f1", cursor: "pointer", fontWeight: 600, marginLeft: 4 }}>
                      {noteOpen ? "Show less" : "Show more"}
                    </span>
                  )}
                </div>
              )}
              {(() => {
                const subtasks = tasks.filter((t) => t.activity_id === a.id);
                const isAdding = addingTaskFor === a.id;
                return (
                  <div style={{ marginTop: 10, paddingTop: subtasks.length || isAdding ? 10 : 0, borderTop: subtasks.length || isAdding ? "1px solid #1e293b" : "none" }}>
                    {subtasks.map((t) => (
                      <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flex: 1, minWidth: 0 }}>
                          <input type="checkbox" checked={!!t.completed} onChange={() => toggleSubtask(t)} style={{ accentColor: "#6366f1", cursor: "pointer", flexShrink: 0 }} />
                          <span style={{ color: t.completed ? "#475569" : "#cbd5e1", fontSize: 12, textDecoration: t.completed ? "line-through" : "none" }}>{t.notes}</span>
                        </label>
                        <span style={{ color: "#64748b", fontSize: 11, marginLeft: "auto", flexShrink: 0 }}>{t.due_date}</span>
                        <button
                          onClick={() => deleteSubtask(t)}
                          title="Delete task"
                          style={{ background: "none", border: "none", color: "#64748b", fontSize: 13, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}
                          onMouseEnter={e => { e.target.style.color = "#f87171"; }}
                          onMouseLeave={e => { e.target.style.color = "#64748b"; }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {isAdding ? (
                      <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          autoFocus
                          placeholder="Task description..."
                          value={subtaskDraft.notes}
                          onChange={(e) => setSubtaskDraft({ ...subtaskDraft, notes: e.target.value })}
                          onKeyDown={(e) => e.key === "Enter" && addSubtask(a)}
                          style={{ ...inputStyle, flex: 1, minWidth: 160, padding: "5px 10px", fontSize: 12 }}
                        />
                        <input
                          type="date"
                          value={subtaskDraft.due_date}
                          onChange={(e) => setSubtaskDraft({ ...subtaskDraft, due_date: e.target.value })}
                          style={{ ...inputStyle, width: "auto", padding: "5px 10px", fontSize: 12 }}
                        />
                        <button onClick={() => addSubtask(a)} style={{ ...btnPrimary, padding: "5px 12px", fontSize: 12 }}>Add</button>
                        <button onClick={() => { setAddingTaskFor(null); setSubtaskDraft(emptySubtask); }} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 12 }}>Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setAddingTaskFor(a.id); setSubtaskDraft(emptySubtask); }}
                        style={{ background: "none", border: "none", color: "#6366f1", fontSize: 12, cursor: "pointer", padding: "4px 0", fontWeight: 600 }}
                      >
                        + Add task
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    );
  };

  const contactOptions = (search) => contacts.filter((c) => {
    if (!search) return true;
    return `${c.contact_name || ""} ${c.agency_name || ""}`.toLowerCase().includes(search.toLowerCase());
  });

  const modalShell = (title, body, onClose) => (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle, maxWidth: 560, width: "100%", maxHeight: "88vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ color: "#f1f5f9", fontSize: 17, margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 12 }}>✕</button>
        </div>
        {body}
      </div>
    </div>
  );

  const fieldLabel = (t) => <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>{t}</label>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ color: "#f1f5f9", fontSize: 20, margin: 0 }}>Tracker</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setSubView("pipeline")} style={pillToggle(subView === "pipeline")}>Pipeline</button>
          <button onClick={() => setSubView("activity")} style={pillToggle(subView === "activity")}>Activity Log</button>
        </div>
      </div>

      {renderStatsBar()}

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>Loading tracker…</div>
      ) : (
        <>
          {subView === "pipeline" && renderPipeline()}
          {subView === "activity" && renderActivityLog()}
        </>
      )}

      {showLogModal && modalShell("Log Activity", (
        <div>
          <div style={{ marginBottom: 12 }}>
            {fieldLabel("Contact")}
            <input placeholder="Search contacts…" value={logSearch} onChange={(e) => setLogSearch(e.target.value)} style={{ ...inputStyle, marginBottom: 6 }} />
            <select value={logForm.contact_id} onChange={(e) => setLogForm({ ...logForm, contact_id: e.target.value })} style={{ ...inputStyle, cursor: "pointer" }}>
              <option value="">Select contact…</option>
              {contactOptions(logSearch).map((c) => <option key={c.id} value={c.id}>{contactLabel(c)}</option>)}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              {fieldLabel("Activity Type")}
              <select value={logForm.activity_type} onChange={(e) => setLogForm({ ...logForm, activity_type: e.target.value })} style={{ ...inputStyle, cursor: "pointer" }}>
                {TRK_ACTIVITY_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label} (+{a.points})</option>)}
              </select>
            </div>
            <div>
              {fieldLabel("Date")}
              <input type="date" value={logForm.activity_date} onChange={(e) => setLogForm({ ...logForm, activity_date: e.target.value })} style={inputStyle} />
            </div>
          </div>
          {logForm.activity_type === "in_person_visit" && (
            <div style={{ marginBottom: 12 }}>
              {fieldLabel("Location")}
              <input value={logForm.location} onChange={(e) => setLogForm({ ...logForm, location: e.target.value })} style={inputStyle} placeholder="Where did the visit happen?" />
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              {fieldLabel("Person Met")}
              <input value={logForm.person_met} onChange={(e) => setLogForm({ ...logForm, person_met: e.target.value })} style={inputStyle} />
            </div>
            <div>
              {fieldLabel("Outcome")}
              <select value={logForm.outcome} onChange={(e) => setLogForm({ ...logForm, outcome: e.target.value })} style={{ ...inputStyle, cursor: "pointer" }}>
                <option value="">—</option>
                {TRK_OUTCOMES.filter(Boolean).map((o) => <option key={o} value={o}>{trkPretty(o)}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            {fieldLabel("Notes")}
            <textarea value={logForm.notes} onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={saveActivity} style={btnPrimary}>Save Activity</button>
            <button onClick={() => { setShowLogModal(false); setLogForm(emptyLog); setLogSearch(""); }} style={btnSecondary}>Cancel</button>
          </div>
        </div>
      ), () => { setShowLogModal(false); setLogForm(emptyLog); setLogSearch(""); })}
    </div>
  );
}

// ── Main App ──
const TABS = [
  { id: "contacts", label: "Contacts", icon: "👥" },
  { id: "templates", label: "Templates", icon: "📝" },
  { id: "campaigns", label: "Campaigns", icon: "🚀" },
  { id: "sequences", label: "Sequences", icon: "🔁" },
  { id: "tracker", label: "Tracker", icon: "🎯" },
  { id: "sent", label: "Sent Log", icon: "📬" },
  { id: "setup", label: "DB Setup", icon: "⚙️" },
];

const ENV_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ENV_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ENV_FROM = "outreach@harmonycarenj.org";

export default function App() {
  const autoConfig = ENV_URL && ENV_KEY
    ? { SUPABASE_URL: ENV_URL, SUPABASE_ANON_KEY: ENV_KEY, FROM_EMAIL: ENV_FROM }
    : {};
  const [config, setConfig] = useState(autoConfig);
  const [configured, setConfigured] = useState(!!(ENV_URL && ENV_KEY));
  const [activeTab, setActiveTab] = useState("contacts");
  const [supabase, setSupabase] = useState(
    ENV_URL && ENV_KEY ? createClient(ENV_URL, ENV_KEY) : null
  );

  const handleSave = (cfg) => {
    const client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    setSupabase(client);
    setConfigured(true);
  };

  if (!configured || !supabase) {
    return <ConfigPanel config={config} setConfig={setConfig} onSave={handleSave} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#111827", borderBottom: "1px solid #1e293b", padding: "14px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(135deg, #0ea5e9, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</div>
          <div>
            <h1 style={{ color: "#f1f5f9", fontSize: 17, margin: 0, fontWeight: 700 }}>Harmony Outreach</h1>
            <p style={{ color: "#475569", fontSize: 11, margin: 0 }}>SC Lead Gen & Email Automation</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={pillStyle(activeTab === t.id)}>
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <button onClick={() => { setConfigured(false); setSupabase(null); setConfig({}); }} style={{ ...btnSecondary, padding: "6px 14px", fontSize: 12 }}>
          ⚙️ Settings
        </button>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 32px" }}>
        {activeTab === "contacts" && <ContactsTab supabase={supabase} />}
        {activeTab === "templates" && <TemplatesTab supabase={supabase} />}
        {activeTab === "campaigns" && <CampaignsTab supabase={supabase} config={config} />}
        {activeTab === "sequences" && <SequencesTab supabase={supabase} />}
        {activeTab === "tracker" && <TrackerTab supabase={supabase} />}
        {activeTab === "sent" && <SentTab supabase={supabase} />}
        {activeTab === "setup" && <SetupTab />}
      </div>

      {/* CAN-SPAM Footer */}
      <div style={{ textAlign: "center", padding: "20px 32px", borderTop: "1px solid #1e293b", color: "#334155", fontSize: 11, marginTop: 40 }}>
        All outreach emails include: Harmony Homecare Agency, LLC · 1852 Burlington Mt-Holly Road, Westampton, NJ 08060 · Recipients may reply "unsubscribe" at any time · CAN-SPAM Compliant
      </div>
    </div>
  );
}
