import { useState, useEffect } from "react";
import * as api from "./api";

const sans = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const mono = "'JetBrains Mono', ui-monospace, monospace";
const MONO = { fontFamily: mono };

// very light markdown → spans (bold + headings + line breaks), enough for a MOM
const renderMd = (txt, T) =>
  (txt || "").split("\n").map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith("**") && p.endsWith("**")
        ? <strong key={j} style={{ color: T.bright }}>{p.slice(2, -2)}</strong>
        : <span key={j}>{p}</span>
    );
    const head = /^#{1,4}\s/.test(line);
    return (
      <div key={i} style={{ marginBottom: head ? 8 : 3, fontWeight: head ? 700 : 400,
        color: head ? T.bright : T.text, fontSize: head ? 14 : 13.2 }}>
        {head ? line.replace(/^#{1,4}\s/, "") : parts}
      </div>
    );
  });

const STATUS = {
  shared:  { label: "Shared",  icon: "ti-circle-check-filled" },
  missing: { label: "Missing", icon: "ti-alert-triangle-filled" },
  pending: { label: "Pending", icon: "ti-circle-dashed" },
};

export default function TeamManagement({ T, theme, toggleTheme, onBack }) {
  const [team, setTeam] = useState(null);
  const [standups, setStandups] = useState([]);
  const [pointers, setPointers] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [editUrl, setEditUrl] = useState({});
  const [showHistory, setShowHistory] = useState(false);

  const load = async () => {
    try { setTeam(await api.getTeam()); } catch (e) { setErr(e.message); }
    try { setStandups((await api.getStandups()).standups || []); } catch {}
  };
  useEffect(() => { load(); }, []);

  const statusColor = (s) => s === "shared" ? T.ok : s === "missing" ? T.red : T.dim;
  const setReport = async (member, status) => { await api.setTeamReport(member, status); load(); };
  const saveUrl = async (member) => {
    await api.setTeamMember(member, editUrl[member] || "");
    setEditUrl(({ [member]: _, ...rest }) => rest); load();
  };
  const generate = async () => {
    if (!pointers.trim()) return;
    setBusy(true); setErr(null);
    try { await api.runStandup(pointers); setPointers(""); await load(); }
    catch (e) { setErr(e.message.includes("limit") ? "Claude is at its usage limit — try again later." : "Couldn't generate — " + e.message.slice(0, 80)); }
    setBusy(false);
  };

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 };
  const members = team?.members || [];
  const nextPoints = team?.latestStandup?.next_points || [];
  const sharedCount = members.filter(m => m.report?.status === "shared").length;
  const missingCount = members.filter(m => m.report?.status === "missing").length;

  // group members by pod, preserving order
  const pods = {};
  members.forEach(m => { (pods[m.pod] = pods[m.pod] || []).push(m); });

  const stat = (n, label, color) => (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color, ...MONO }}>{n}</span>
      <span style={{ fontSize: 10.5, color: T.dim, letterSpacing: ".06em" }}>{label}</span>
    </span>
  );

  const memberCard = (m) => {
    const st = m.report?.status || "pending";
    return (
      <div key={m.name} style={{ ...card, padding: "13px 15px", borderLeft: `3px solid ${statusColor(st)}` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: T.bright }}>{m.name}</span>
          {m.designation && <span style={{ fontSize: 10.5, color: T.muted }}>{m.designation}</span>}
        </div>
        <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.45, marginBottom: 9 }}>
          {(m.responsibilities || []).slice(0, 3).join(" · ")}
        </div>
        {editUrl[m.name] !== undefined ? (
          <div style={{ display: "flex", gap: 6, marginBottom: 9 }}>
            <input autoFocus value={editUrl[m.name]} placeholder="https://dashboard-link…"
              onChange={e => setEditUrl(s => ({ ...s, [m.name]: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && saveUrl(m.name)}
              style={{ flex: 1, fontSize: 12, padding: "6px 9px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.bg, color: T.text }} />
            <button onClick={() => saveUrl(m.name)} style={{ fontSize: 12, padding: "6px 10px", borderRadius: 7, border: "none", background: T.bright, color: T.bg, fontWeight: 600 }}>Save</button>
          </div>
        ) : (
          <div style={{ marginBottom: 9 }}>
            {m.dashboard_url ? (
              <span>
                <a href={m.dashboard_url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, color: T.cyan || T.bright, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <i className="ti ti-layout-dashboard" style={{ fontSize: 13 }} /> Project dashboard
                </a>
                <button onClick={() => setEditUrl(s => ({ ...s, [m.name]: m.dashboard_url }))}
                  style={{ fontSize: 11, color: T.dim, background: "none", border: "none", marginLeft: 8 }}>edit</button>
              </span>
            ) : (
              <button onClick={() => setEditUrl(s => ({ ...s, [m.name]: "" }))}
                style={{ fontSize: 12, color: T.dim, background: "none", border: `1px dashed ${T.border}`, borderRadius: 7, padding: "5px 9px" }}>
                + add dashboard link
              </button>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          {Object.entries(STATUS).map(([key, v]) => (
            <button key={key} onClick={() => setReport(m.name, key)}
              style={{ flex: 1, fontSize: 11, padding: "5px 4px", borderRadius: 7, fontWeight: 600,
                border: `1px solid ${st === key ? statusColor(key) : T.border}`,
                background: st === key ? `${statusColor(key)}1f` : "transparent",
                color: st === key ? statusColor(key) : T.dim, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              <i className={`ti ${v.icon}`} style={{ fontSize: 11 }} /> {v.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* NAV BAR — title, live stats, controls (saves the vertical space) */}
      <header style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
        paddingBottom: 14, borderBottom: `1px solid ${T.border}`, marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.bright, letterSpacing: "0.04em", fontFamily: sans }}>FRIDAY</div>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.muted }}>Team Management</span>
        </div>
        {/* live stats inline */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "5px 13px", borderRadius: 9, background: T.card, border: `1px solid ${T.border}` }}>
          {stat(sharedCount, "shared", T.ok)}
          {stat(missingCount, "missing", missingCount ? T.red : T.dim)}
          {stat(members.length, "team", T.muted)}
          <span style={{ fontSize: 10.5, color: T.dim, ...MONO }}>wk {team?.weekStart || "—"}</span>
        </div>
        <span style={{ flex: 1, minWidth: 12 }} />
        <button onClick={onBack}
          style={{ fontSize: 12.5, padding: "7px 14px", borderRadius: 9, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <i className="ti ti-arrow-left" style={{ fontSize: 14 }} /> Cockpit
        </button>
        <button onClick={toggleTheme} title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          style={{ width: 34, height: 34, borderRadius: 9, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <i className={`ti ${theme === "dark" ? "ti-sun" : "ti-moon"}`} style={{ fontSize: 16 }} />
        </button>
      </header>

      {/* TOP — 50/50: Discussion points  |  Pointers for MOM */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 26, alignItems: "stretch" }}>
        {/* Discussion points (next standup) */}
        <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <i className="ti ti-clipboard-list" style={{ fontSize: 16, color: T.bright }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", color: T.muted }}>STANDUP — DISCUSSION POINTS</span>
          </div>
          {nextPoints.length ? (
            <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
              {nextPoints.map((p, i) => <li key={i} style={{ fontSize: 13, color: T.text, lineHeight: 1.45 }}>{p}</li>)}
            </ol>
          ) : (
            <div style={{ fontSize: 13, color: T.dim, margin: "auto 0" }}>No agenda yet — run a standup and FRIDAY builds next week's points automatically.</div>
          )}
        </div>
        {/* Pointers for MOM (capture) */}
        <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <i className="ti ti-microphone-2" style={{ fontSize: 16, color: T.bright }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", color: T.muted }}>POINTERS FOR MOM</span>
          </div>
          <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 10 }}>Jot rough notes per person — FRIDAY writes the minutes + next week's points.</div>
          <textarea value={pointers} onChange={e => setPointers(e.target.value)}
            placeholder={"Rajesh — …\nRahul — …\nYashas — …"}
            style={{ flex: 1, minHeight: 120, width: "100%", fontSize: 13, padding: "11px 13px", borderRadius: 9,
              border: `1px solid ${T.border}`, background: T.bg, color: T.text, resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }} />
          {err && <div style={{ fontSize: 12, color: T.red, marginTop: 8 }}>{err}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button onClick={generate} disabled={busy || !pointers.trim()}
              style={{ fontSize: 13, padding: "9px 18px", borderRadius: 9, border: "none", fontWeight: 600,
                background: T.bright, color: T.bg, opacity: busy || !pointers.trim() ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 7 }}>
              <i className={`ti ti-sparkles ${busy ? "spin" : ""}`} style={{ fontSize: 14 }} />
              {busy ? "writing minutes…" : "Generate MOM"}
            </button>
          </div>
        </div>
      </div>

      {/* BOTTOM — People & project dashboards, grouped by POD in rows */}
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", color: T.muted, marginBottom: 12 }}>PEOPLE &amp; PROJECT DASHBOARDS</div>
      {Object.entries(pods).map(([pod, mem]) => (
        <div key={pod} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.dim, letterSpacing: ".1em", marginBottom: 9, ...MONO }}>{pod.toUpperCase()}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 13 }}>
            {mem.map(memberCard)}
          </div>
        </div>
      ))}

      {/* Latest MOM + history */}
      {team?.latestStandup?.mom && (
        <div style={{ ...card, padding: "18px 20px", marginTop: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", color: T.muted }}>LATEST MINUTES — {team.latestStandup.date}</span>
            <button onClick={() => setShowHistory(h => !h)} style={{ fontSize: 11.5, color: T.dim, background: "none", border: "none" }}>
              {showHistory ? "hide history" : `history (${standups.length})`}
            </button>
          </div>
          <div>{renderMd(team.latestStandup.mom, T)}</div>
        </div>
      )}
      {showHistory && standups.slice(1).map(s => (
        <div key={s.id} style={{ ...card, padding: "14px 18px", marginBottom: 10, opacity: 0.85 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.muted, marginBottom: 8, ...MONO }}>{s.date}</div>
          <div>{renderMd(s.mom, T)}</div>
        </div>
      ))}
    </div>
  );
}
