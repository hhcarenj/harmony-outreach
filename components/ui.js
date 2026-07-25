/**
 * Shared design-system primitives.
 *
 * These were originally defined at the top of pages/index.js. They moved here
 * unchanged so tab modules living outside that file (Care Management) render
 * identically to the original Outreach CRM tabs.
 */
import { useState } from "react";

// ── Shared Styles ──
export const cardStyle = {
  background: "#111827",
  border: "1px solid #1e293b",
  borderRadius: 14,
  padding: 24,
};
export const inputStyle = {
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
export const btnPrimary = {
  padding: "10px 24px",
  background: "linear-gradient(135deg, #6366f1, #0ea5e9)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};
export const btnSecondary = {
  padding: "10px 24px",
  background: "#1e293b",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
export const pillStyle = (active) => ({
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

// Smaller pill used for sub-view toggles inside a tab (matches the Tracker tab).
export const pillToggle = (active) => ({ ...pillStyle(active), padding: "6px 16px", fontSize: 12 });

// Small uppercase field label used above form inputs.
export const fieldLabel = (text) => (
  <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>
    {text}
  </label>
);

/**
 * Sign-in gate for the dashboard.
 *
 * The CRM tables (clients, dsps, sc_contacts, …) only grant access to the
 * `authenticated` role, so the anon key alone reads nothing — a real login is
 * required. There is deliberately no "sign up" link: accounts are created by an
 * admin in the Supabase dashboard so the public can't self-register.
 */
export function LoginPanel({ supabase }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const signIn = async (e) => {
    e?.preventDefault();
    if (!email || !password) return;
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) setError(err.message);
    setBusy(false);
    // On success the App's onAuthStateChange listener swaps in the dashboard.
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", padding: 20 }}>
      <form onSubmit={signIn} style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 16, padding: 48, maxWidth: 440, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #0ea5e9, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>⚡</div>
          <h1 style={{ color: "#f1f5f9", fontSize: 22, margin: 0, fontWeight: 700 }}>Harmony Outreach</h1>
        </div>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
          Sign in to continue. This dashboard holds client and staff records — access is restricted to authorized staff accounts.
        </p>

        <div style={{ marginBottom: 18 }}>
          {fieldLabel("Email")}
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@harmonycarenj.org"
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: 18 }}>
          {fieldLabel("Password")}
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={inputStyle}
          />
        </div>

        {error && (
          <p style={{ color: "#f87171", fontSize: 13, marginBottom: 16, background: "#f8717111", border: "1px solid #f8717133", borderRadius: 8, padding: "10px 12px" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !email || !password}
          style={{ ...btnPrimary, width: "100%", padding: "12px 0", borderRadius: 10, fontSize: 15, opacity: busy || !email || !password ? 0.4 : 1, cursor: busy || !email || !password ? "not-allowed" : "pointer" }}
        >
          {busy ? "Signing in…" : "Sign In →"}
        </button>
        <p style={{ color: "#475569", fontSize: 11, marginTop: 18, marginBottom: 0, lineHeight: 1.6 }}>
          Need an account? Ask an admin to create one in Supabase → Authentication → Users. Self-registration is disabled.
        </p>
      </form>
    </div>
  );
}

export function Toast({ message }) {
  if (!message) return null;
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, background: "#111827", border: "1px solid #6366f1", borderRadius: 10, padding: "14px 20px", color: "#e2e8f0", fontSize: 14, fontWeight: 600, boxShadow: "0 10px 30px rgba(0,0,0,0.4)", zIndex: 1100, maxWidth: 360 }}>
      ✨ {message}
    </div>
  );
}

// Click-outside-to-close modal shell, matching the Sequence/Tracker modals.
export function Modal({ title, subtitle, onClose, children, maxWidth = 560 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle, maxWidth, width: "100%", maxHeight: "88vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 12 }}>
          <div>
            <h3 style={{ color: "#f1f5f9", fontSize: 17, margin: 0 }}>{title}</h3>
            {subtitle && <p style={{ color: "#64748b", fontSize: 13, margin: "4px 0 0" }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 12, flexShrink: 0 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
