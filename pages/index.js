import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  SEQUENCE_LABEL,
  STEP_SUBJECTS,
  TOTAL_STEPS,
  sendDateForStep,
  todayISO,
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
  if (!seq) return null;
  const subjects = STEP_SUBJECTS[seq.sequence_type] || [];
  const statusColors = { sent: "#10b981", pending: "#3b82f6", skipped: "#64748b" };

  const apply = async (update) => {
    setBusy(true);
    await supabase.from("email_sequences").update(update).eq("id", seq.id);
    setBusy(false);
    if (onChange) await onChange();
    onClose();
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle, maxWidth: 620, width: "100%", maxHeight: "85vh", overflow: "auto" }}>
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
            return (
              <div key={step} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: "1px solid #1e293b" }}>
                <div style={{ width: 22, height: 22, borderRadius: 99, background: "#0f172a", color: "#94a3b8", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{step}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subj}</div>
                  <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>Send date: {date}</div>
                </div>
                <span style={{ padding: "2px 9px", borderRadius: 99, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, background: statusColors[st] + "22", color: statusColors[st], flexShrink: 0 }}>{st}</span>
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

// ── Contacts Tab ──
function ContactsTab({ supabase }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
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
    const { data, error } = await supabase.from("sc_contacts").select("*");
    if (error) {
      setLoadError(typeof error === "object" ? error.message || JSON.stringify(error) : String(error));
      setContacts([]);
    } else {
      setContacts(data || []);
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
      : filterStatus === "burlington" ? (c.counties_served || "").toLowerCase().includes("burlington")
      : filterStatus === "has_email" ? !!c.email
      : c.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const statusColor = { new: "#3b82f6", contacted: "#f59e0b", replied: "#10b981", converted: "#8b5cf6" };

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
            <option value="burlington">Burlington County</option>
            <option value="has_email">Has Email</option>
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
                {["Agency", "Contact", "Email", "Phone", "Counties", "Status", "Sequence", ""].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px", color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, borderBottom: "1px solid #1e293b", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 150).map((c, i) => (
                <tr key={c.id || i} style={{ borderBottom: "1px solid #1e293b" }}>
                  <td style={{ padding: "12px 14px", color: "#e2e8f0", fontSize: 13, fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.agency_name}</td>
                  <td style={{ padding: "12px 14px", color: "#94a3b8", fontSize: 13 }}>{c.contact_name || "—"}</td>
                  <td style={{ padding: "12px 14px", color: "#7dd3fc", fontSize: 13, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{c.email || "—"}</td>
                  <td style={{ padding: "12px 14px", color: "#94a3b8", fontSize: 13, whiteSpace: "nowrap" }}>{c.phone || "—"}</td>
                  <td style={{ padding: "12px 14px", color: "#94a3b8", fontSize: 12, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.counties_served || "—"}</td>
                  <td style={{ padding: "12px 14px" }}>
                    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, background: (statusColor[c.status] || "#3b82f6") + "22", color: statusColor[c.status] || "#3b82f6", textTransform: "capitalize" }}>
                      {c.status || "new"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                    {sequences[c.id]
                      ? <SequencePill seq={sequences[c.id]} onClick={() => setModalSeq(sequences[c.id])} />
                      : <span style={{ color: "#475569", fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => startEdit(c)}
                      style={{ background: "none", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", fontSize: 12, padding: "4px 12px", cursor: "pointer", transition: "all 0.2s" }}
                      onMouseEnter={e => { e.target.style.borderColor = "#6366f1"; e.target.style.color = "#a78bfa"; }}
                      onMouseLeave={e => { e.target.style.borderColor = "#334155"; e.target.style.color = "#94a3b8"; }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 150 && (
            <p style={{ color: "#64748b", fontSize: 12, textAlign: "center", marginTop: 12 }}>Showing first 150 of {filtered.length}</p>
          )}
        </div>
      )}

      {modalSeq && <SequenceModal supabase={supabase} seq={modalSeq} onClose={() => setModalSeq(null)} onChange={loadSequences} />}
      <Toast message={toast} />
    </div>
  );
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

      {/* Template list */}
      {templates.map(t => (
        <div key={t.id} style={{ ...cardStyle, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 15 }}>{t.name}</div>
            <div style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>Subject: {t.subject}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setEditing(t.id); setForm({ name: t.name, subject: t.subject, body: t.body }); setPreview(null); }} style={btnSecondary}>Edit</button>
            <button onClick={() => deleteTemplate(t.id)} style={{ ...btnSecondary, color: "#f87171", borderColor: "#f8717133" }}>Delete</button>
          </div>
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
  const [filter, setFilter] = useState("new");

  const load = useCallback(async () => {
    const { data: c } = await supabase.from("sc_contacts").select("*");
    const { data: t } = await supabase.from("email_templates").select("*");
    setContacts((c || []).filter(x => x.email));
    setTemplates(t || []);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filtered = contacts.filter(c => {
    if (filter === "burlington") return (c.counties_served || "").toLowerCase().includes("burlington");
    if (filter === "new") return c.status === "new";
    if (filter === "not_contacted") return c.status === "new" || c.status === null;
    return true;
  });

  const toggleAll = () => {
    if (selectedContacts.size === filtered.length) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(filtered.map(c => c.id)));
    }
  };

  const personalize = (text, contact) => {
    return (text || "")
      .replace(/\{\{agency_name\}\}/g, contact.agency_name || "your agency")
      .replace(/\{\{contact_name\}\}/g, contact.contact_name || "Support Coordinator")
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
      <p style={{ color: "#64748b", fontSize: 13, marginBottom: 20 }}>Select a template and contacts, then send in controlled batches to protect your domain reputation.</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div>
          <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Template</label>
          <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="">Select template...</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>Filter</label>
          <select value={filter} onChange={e => { setFilter(e.target.value); setSelectedContacts(new Set()); }} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="all">All with Email ({contacts.length})</option>
            <option value="new">New / Not Contacted</option>
            <option value="burlington">Burlington County</option>
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

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("email_sequences").select("*").order("created_at", { ascending: false });
    setSequences(data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

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

      <p style={{ color: "#475569", fontSize: 12, marginBottom: 16 }}>
        “Run sequence check” triggers the daily runner now — it sends every step whose send date is due today. The same job runs automatically each morning via Vercel Cron.
      </p>

      {runResult && (
        <div style={{ ...cardStyle, marginBottom: 20, borderColor: runResult.error ? "#f8717155" : "#6366f155" }}>
          {runResult.error ? (
            <p style={{ color: "#f87171", fontSize: 13, margin: 0 }}>Error: {runResult.error}</p>
          ) : (
            <>
              <p style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>{runResult.message}</p>
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
      )}

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
                    <button
                      onClick={() => setModalSeq(s)}
                      style={{ background: "none", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", fontSize: 12, padding: "4px 12px", cursor: "pointer" }}
                    >
                      View
                    </button>
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

// ── Main App ──
const TABS = [
  { id: "contacts", label: "Contacts", icon: "👥" },
  { id: "templates", label: "Templates", icon: "📝" },
  { id: "campaigns", label: "Campaigns", icon: "🚀" },
  { id: "sequences", label: "Sequences", icon: "🔁" },
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
