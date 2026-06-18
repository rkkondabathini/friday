import { useState, useEffect } from "react";
import * as api from "./api";

const mono = "'JetBrains Mono', ui-monospace, monospace";
const MONO = { fontFamily: mono };

// very light markdown → spans (bold + line breaks), enough for a MOM
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

export default function TeamManagement({ T }) {
  const [team, setTeam] = useState(null);
  const [standups, setStandups] = useState([]);
  const [pointers, setPointers] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [editUrl, setEditUrl] = useState({});      // member -> draft url
  const [showHistory, setShowHistory] = useState(false);

  const load = async () => {
    try { setTeam(await api.getTeam()); } catch (e) { setErr(e.message); }
    try { setStandups((await api.getStandups()).standups || []); } catch {}
  };
  useEffect(() => { load(); }, []);

  const statusColor = (s) => s === "shared" ? T.ok : s === "missing" ? T.red : T.dim;

  const setReport = async (member, status) => {
    await api.setTeamReport(member, status);
    load();
  };
  const saveUrl = async (member) => {
    await api.setTeamMember(member, editUrl[member] || "");
    setEditUrl(({ [member]: _, ...rest }) => rest);
    load();
  };
  const generate = async () => {
    if (!pointers.trim()) return;
    setBusy(true); setErr(null);
    try {
      await api.runStandup(pointers);
      setPointers("");
      await load();
    } catch (e) { setErr(e.message.includes("limit") ? "Claude is at its usage limit — try again later." : "Couldn't generate — " + e.message.slice(0, 80)); }
    setBusy(false);
  };

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12 };
  const members = team?.members || [];
  const nextPoints = team?.latestStandup?.next_points || [];
  const sharedCount = members.filter(m => m.report?.status === "shared").length;
  const missingCount = members.filter(m => m.report?.status === "missing").length;

  return (
    <div>
      {/* Rhythm header */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: 22 }}>
        {/* Next standup agenda */}
        <div style={{ ...card, padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <i className="ti ti-clipboard-list" style={{ fontSize: 16, color: T.bright }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", color: T.muted }}>NEXT STANDUP — DISCUSSION POINTS</span>
          </div>
          {nextPoints.length ? (
            <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>
              {nextPoints.map((p, i) => (
                <li key={i} style={{ fontSize: 13.2, color: T.text, lineHeight: 1.4 }}>{p}</li>
              ))}
            </ol>
          ) : (
            <div style={{ fontSize: 13, color: T.dim }}>No agenda yet — run a standup below and FRIDAY will build next week's points automatically.</div>
          )}
        </div>
        {/* Reports pulse */}
        <div style={{ ...card, padding: "16px 18px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", color: T.muted, marginBottom: 12 }}>THIS WEEK</div>
          <div style={{ display: "flex", gap: 18, marginBottom: 10 }}>
            <div><div style={{ fontSize: 26, fontWeight: 700, color: T.ok, ...MONO }}>{sharedCount}</div><div style={{ fontSize: 11, color: T.dim }}>shared</div></div>
            <div><div style={{ fontSize: 26, fontWeight: 700, color: missingCount ? T.red : T.dim, ...MONO }}>{missingCount}</div><div style={{ fontSize: 11, color: T.dim }}>missing</div></div>
            <div><div style={{ fontSize: 26, fontWeight: 700, color: T.muted, ...MONO }}>{members.length}</div><div style={{ fontSize: 11, color: T.dim }}>team</div></div>
          </div>
          <div style={{ fontSize: 11.5, color: T.dim, ...MONO }}>week of {team?.weekStart || "—"}</div>
        </div>
      </div>

      {/* People — visibility on each person + their project dashboard + report status */}
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", color: T.muted, marginBottom: 12 }}>PEOPLE &amp; PROJECT DASHBOARDS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 14, marginBottom: 28 }}>
        {members.map(m => {
          const st = m.report?.status || "pending";
          return (
            <div key={m.name} style={{ ...card, padding: "14px 16px", borderLeft: `3px solid ${statusColor(st)}` }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: T.bright }}>{m.name}</span>
                <span style={{ fontSize: 10.5, color: T.dim, ...MONO }}>{m.pod}</span>
                {m.designation && <span style={{ fontSize: 10.5, color: T.muted }}>· {m.designation}</span>}
              </div>
              <div style={{ fontSize: 11.8, color: T.dim, lineHeight: 1.45, marginBottom: 10 }}>
                {(m.responsibilities || []).slice(0, 3).join(" · ")}
              </div>

              {/* Project dashboard link */}
              {editUrl[m.name] !== undefined ? (
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <input autoFocus value={editUrl[m.name]} placeholder="https://dashboard-link…"
                    onChange={e => setEditUrl(s => ({ ...s, [m.name]: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && saveUrl(m.name)}
                    style={{ flex: 1, fontSize: 12, padding: "6px 9px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.bg, color: T.text }} />
                  <button onClick={() => saveUrl(m.name)} style={{ fontSize: 12, padding: "6px 10px", borderRadius: 7, border: "none", background: T.bright, color: T.bg, fontWeight: 600 }}>Save</button>
                </div>
              ) : (
                <div style={{ marginBottom: 10 }}>
                  {m.dashboard_url ? (
                    <a href={m.dashboard_url} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12.2, color: T.cyan || T.bright, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <i className="ti ti-layout-dashboard" style={{ fontSize: 13 }} /> Project dashboard
                    </a>
                  ) : (
                    <button onClick={() => setEditUrl(s => ({ ...s, [m.name]: "" }))}
                      style={{ fontSize: 12, color: T.dim, background: "none", border: `1px dashed ${T.border}`, borderRadius: 7, padding: "5px 9px" }}>
                      + add dashboard link
                    </button>
                  )}
                  {m.dashboard_url && (
                    <button onClick={() => setEditUrl(s => ({ ...s, [m.name]: m.dashboard_url }))}
                      style={{ fontSize: 11, color: T.dim, background: "none", border: "none", marginLeft: 8 }}>edit</button>
                  )}
                </div>
              )}

              {/* This week's report status */}
              <div style={{ display: "flex", gap: 6 }}>
                {Object.entries(STATUS).map(([key, v]) => (
                  <button key={key} onClick={() => setReport(m.name, key)}
                    style={{ flex: 1, fontSize: 11.5, padding: "6px 4px", borderRadius: 7, fontWeight: 600,
                      border: `1px solid ${st === key ? statusColor(key) : T.border}`,
                      background: st === key ? `${statusColor(key)}1f` : "transparent",
                      color: st === key ? statusColor(key) : T.dim, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                    <i className={`ti ${v.icon}`} style={{ fontSize: 12 }} /> {v.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Friday standup capture → MOM */}
      <div style={{ ...card, padding: "18px 20px", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <i className="ti ti-microphone-2" style={{ fontSize: 16, color: T.bright }} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: T.bright }}>Friday Standup → FRIDAY writes the MOM</span>
        </div>
        <div style={{ fontSize: 12, color: T.dim, marginBottom: 12 }}>
          Jot rough pointers as you run the standup (per person is fine). FRIDAY turns it into clean minutes and builds next week's discussion points.
        </div>
        <textarea value={pointers} onChange={e => setPointers(e.target.value)}
          placeholder={"Rajesh — NPS rollout on track, blocker on batch IDs…\nRahul — payout cycle still 10d, exploring automation…\nYashas — 2 agreements pending QC…"}
          rows={6}
          style={{ width: "100%", fontSize: 13, padding: "11px 13px", borderRadius: 9, border: `1px solid ${T.border}`,
            background: T.bg, color: T.text, resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }} />
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

      {/* Latest MOM */}
      {team?.latestStandup?.mom && (
        <div style={{ ...card, padding: "18px 20px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", color: T.muted }}>LATEST MINUTES — {team.latestStandup.date}</span>
            <button onClick={() => setShowHistory(h => !h)} style={{ fontSize: 11.5, color: T.dim, background: "none", border: "none" }}>
              {showHistory ? "hide history" : `history (${standups.length})`}
            </button>
          </div>
          <div>{renderMd(team.latestStandup.mom, T)}</div>
        </div>
      )}

      {/* History */}
      {showHistory && standups.slice(1).map(s => (
        <div key={s.id} style={{ ...card, padding: "14px 18px", marginBottom: 10, opacity: 0.85 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.muted, marginBottom: 8, ...MONO }}>{s.date}</div>
          <div>{renderMd(s.mom, T)}</div>
        </div>
      ))}
    </div>
  );
}
