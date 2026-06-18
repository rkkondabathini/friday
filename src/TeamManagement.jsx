import { useState, useEffect } from "react";
import * as api from "./api";

const sans = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const mono = "'JetBrains Mono', ui-monospace, monospace";
const MONO = { fontFamily: mono };

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
  missed:  { label: "Missed",  icon: "ti-alert-triangle-filled" },
  pending: { label: "Pending", icon: "ti-circle-dashed" },
};

export default function TeamManagement({ T, theme, toggleTheme, onBack }) {
  const [team, setTeam] = useState(null);
  const [standups, setStandups] = useState([]);
  const [pointers, setPointers] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [editAgenda, setEditAgenda] = useState(null);
  const [selected, setSelected] = useState(null);     // selected member name
  const [editLink, setEditLink] = useState({});       // projectId -> draft url
  const [newProj, setNewProj] = useState("");

  const load = async () => {
    try { setTeam(await api.getTeam()); } catch (e) { setErr(e.message); }
    try { setStandups((await api.getStandups()).standups || []); } catch {}
  };
  useEffect(() => { load(); }, []);

  const statusColor = (s) => s === "shared" ? T.ok : s === "missed" ? T.red : T.dim;

  const generate = async () => {
    if (!pointers.trim()) return;
    setBusy(true); setErr(null);
    try { await api.runStandup(pointers); setPointers(""); await load(); }
    catch (e) { setErr(e.message.includes("limit") ? "Claude is at its usage limit — try again later." : "Couldn't generate — " + e.message.slice(0, 80)); }
    setBusy(false);
  };
  const saveAgenda = async () => {
    const points = (editAgenda || "").split("\n").map(l => l.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean);
    await api.setTeamAgenda(points); setEditAgenda(null); load();
  };
  const setStatus = async (id, status) => { await api.setProjectStatus(id, status); load(); };
  const saveLink = async (id) => { await api.updateProject(id, null, editLink[id] || ""); setEditLink(({ [id]: _, ...r }) => r); load(); };
  const addProject = async (member) => { if (!newProj.trim()) return; await api.addProject(member, newProj.trim(), ""); setNewProj(""); load(); };
  const delProject = async (id) => { await api.deleteProject(id); load(); };

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 };
  const members = team?.members || [];
  const nextPoints = team?.agenda || [];
  const stats = team?.stats || { shared: 0, missed: 0, pending: 0 };
  const selName = selected || members[0]?.name;
  const selMember = members.find(m => m.name === selName);

  const statChip = (n, label, color) => (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color, ...MONO }}>{n}</span>
      <span style={{ fontSize: 10.5, color: T.dim, letterSpacing: ".06em" }}>{label}</span>
    </span>
  );

  return (
    <div>
      {/* NAV BAR */}
      <header style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
        paddingBottom: 14, borderBottom: `1px solid ${T.border}`, marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.bright, letterSpacing: "0.04em", fontFamily: sans }}>FRIDAY</div>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.muted }}>Team Management</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "5px 13px", borderRadius: 9, background: T.card, border: `1px solid ${T.border}` }}>
          {statChip(stats.shared, "shared", T.ok)}
          {statChip(stats.missed, "missed", stats.missed ? T.red : T.dim)}
          {statChip(stats.pending, "pending", T.muted)}
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

      {/* TOP — Discussion Points (left, full) | Pointers for MOM (right) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 26, alignItems: "stretch" }}>
        {/* Discussion points */}
        <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <i className="ti ti-clipboard-list" style={{ fontSize: 16, color: T.bright }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", color: T.muted, flex: 1 }}>STANDUP — DISCUSSION POINTS</span>
            {editAgenda === null
              ? <button onClick={() => setEditAgenda(nextPoints.join("\n"))} style={{ fontSize: 11.5, color: T.dim, background: "none", border: "none" }}><i className="ti ti-pencil" style={{ fontSize: 12 }} /> edit</button>
              : <span><button onClick={saveAgenda} style={{ fontSize: 11.5, color: T.ok, background: "none", border: "none", fontWeight: 600 }}>save</button><button onClick={() => setEditAgenda(null)} style={{ fontSize: 11.5, color: T.dim, background: "none", border: "none", marginLeft: 8 }}>cancel</button></span>}
          </div>
          {editAgenda !== null ? (
            <textarea value={editAgenda} onChange={e => setEditAgenda(e.target.value)} placeholder="One discussion point per line…"
              style={{ flex: 1, minHeight: 200, width: "100%", fontSize: 13, padding: "11px 13px", borderRadius: 9,
                border: `1px solid ${T.border}`, background: T.bg, color: T.text, resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }} />
          ) : nextPoints.length ? (
            <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
              {nextPoints.map((p, i) => <li key={i} style={{ fontSize: 13, color: T.text, lineHeight: 1.45 }}>{p}</li>)}
            </ol>
          ) : (
            <div style={{ fontSize: 13, color: T.dim, margin: "auto 0" }}>No agenda yet — click <b>edit</b> to set points, or run a standup.</div>
          )}
        </div>

        {/* RIGHT COLUMN — MOM (top) + Team projects (bottom), stacked */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Pointers for MOM — Generate button at top, bigger input */}
        <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <i className="ti ti-microphone-2" style={{ fontSize: 16, color: T.bright }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", color: T.muted, flex: 1 }}>POINTERS FOR MOM</span>
            <button onClick={generate} disabled={busy || !pointers.trim()}
              style={{ fontSize: 12.5, padding: "7px 14px", borderRadius: 8, border: "none", fontWeight: 600,
                background: T.bright, color: T.bg, opacity: busy || !pointers.trim() ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <i className={`ti ti-sparkles ${busy ? "spin" : ""}`} style={{ fontSize: 13 }} />
              {busy ? "writing…" : "Generate MOM"}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 10 }}>Jot rough notes per person — FRIDAY writes the minutes + next week's points.</div>
          <textarea value={pointers} onChange={e => setPointers(e.target.value)} placeholder={"Rajesh — …\nAravind — …\nRahul — …"}
            style={{ flex: 1, minHeight: 200, width: "100%", fontSize: 13, padding: "11px 13px", borderRadius: 9,
              border: `1px solid ${T.border}`, background: T.bg, color: T.text, resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }} />
          {err && <div style={{ fontSize: 12, color: T.red, marginTop: 8 }}>{err}</div>}
        </div>

        {/* Team projects — under the MOM panel in the right column */}
        <div style={{ ...card, padding: "16px 18px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", color: T.muted, marginBottom: 12 }}>TEAM PROJECTS</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, borderBottom: `1px solid ${T.border}`, paddingBottom: 12 }}>
        {members.map(m => {
          const active = m.name === selName;
          const miss = (m.projects || []).filter(p => p.status === "missed").length;
          return (
            <button key={m.name} onClick={() => setSelected(m.name)}
              style={{ fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 9,
                border: `1px solid ${active ? T.bright : T.border}`,
                background: active ? T.bright : "transparent", color: active ? T.bg : T.muted,
                display: "inline-flex", alignItems: "center", gap: 7 }}>
              {m.name}
              <span style={{ fontSize: 10.5, opacity: 0.8, ...MONO }}>{(m.projects || []).length}</span>
              {miss > 0 && <span style={{ width: 6, height: 6, borderRadius: "50%", background: active ? T.bg : T.red }} />}
            </button>
          );
        })}
      </div>

      {selMember && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: T.dim, marginBottom: 12 }}>
            {selMember.designation ? `${selMember.designation} · ` : ""}{(selMember.projects || []).length} projects ·
            <span style={{ color: T.ok }}> {(selMember.projects || []).filter(p => p.status === "shared").length} shared</span> ·
            <span style={{ color: T.red }}> {(selMember.projects || []).filter(p => p.status === "missed").length} missed</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {(selMember.projects || []).map(p => (
              <div key={p.id} style={{ ...card, padding: "12px 15px", borderLeft: `3px solid ${statusColor(p.status)}`,
                display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: T.text, flex: 1, minWidth: 180 }}>{p.name}</span>

                {/* sheet link */}
                {editLink[p.id] !== undefined ? (
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <input autoFocus value={editLink[p.id]} placeholder="https://sheet-link…"
                      onChange={e => setEditLink(s => ({ ...s, [p.id]: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && saveLink(p.id)}
                      style={{ width: 200, fontSize: 12, padding: "5px 9px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.bg, color: T.text }} />
                    <button onClick={() => saveLink(p.id)} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, border: "none", background: T.bright, color: T.bg, fontWeight: 600 }}>Save</button>
                  </span>
                ) : p.sheet_url ? (
                  <a href={p.sheet_url} target="_blank" rel="noreferrer" onDoubleClick={() => setEditLink(s => ({ ...s, [p.id]: p.sheet_url }))}
                    style={{ fontSize: 12, color: T.cyan || T.bright, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <i className="ti ti-table" style={{ fontSize: 13 }} /> Sheet
                  </a>
                ) : (
                  <button onClick={() => setEditLink(s => ({ ...s, [p.id]: "" }))}
                    style={{ fontSize: 11.5, color: T.dim, background: "none", border: `1px dashed ${T.border}`, borderRadius: 7, padding: "4px 9px" }}>+ link</button>
                )}

                {/* status buttons */}
                <span style={{ display: "inline-flex", gap: 5 }}>
                  {Object.entries(STATUS).map(([key, v]) => (
                    <button key={key} onClick={() => setStatus(p.id, key)} title={v.label}
                      style={{ fontSize: 11, padding: "5px 10px", borderRadius: 7, fontWeight: 600,
                        border: `1px solid ${p.status === key ? statusColor(key) : T.border}`,
                        background: p.status === key ? `${statusColor(key)}1f` : "transparent",
                        color: p.status === key ? statusColor(key) : T.dim, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <i className={`ti ${v.icon}`} style={{ fontSize: 11 }} /> {v.label}
                    </button>
                  ))}
                </span>
                <button onClick={() => delProject(p.id)} title="Remove project"
                  style={{ background: "none", border: "none", color: T.dim, fontSize: 14 }}><i className="ti ti-x" /></button>
              </div>
            ))}

            {/* add project */}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <input value={newProj} onChange={e => setNewProj(e.target.value)} onKeyDown={e => e.key === "Enter" && addProject(selMember.name)}
                placeholder={`+ add a project for ${selMember.name}…`}
                style={{ flex: 1, fontSize: 12.5, padding: "8px 12px", borderRadius: 8, border: `1px dashed ${T.border}`, background: "transparent", color: T.text }} />
              <button onClick={() => addProject(selMember.name)} disabled={!newProj.trim()}
                style={{ fontSize: 12.5, padding: "8px 14px", borderRadius: 8, border: "none", background: T.bright, color: T.bg, fontWeight: 600, opacity: newProj.trim() ? 1 : 0.5 }}>Add</button>
            </div>
          </div>
        </div>
      )}
        </div>{/* /projects card */}
      </div>{/* /right column */}
      </div>{/* /top grid */}

      {/* Latest MOM + history */}
      {team?.latestStandup?.mom && (
        <div style={{ ...card, padding: "18px 20px", marginBottom: 14 }}>
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
