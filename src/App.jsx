import { useState, useEffect, useCallback, useRef } from "react";
import * as api from "./api";

// ── Theme ──────────────────────────────────────────────────────
const T = {
  bg:"#080a0e", panel:"#0d1018", card:"#111520", border:"#1e2438", borderB:"#2a3350",
  text:"#c8d4e8", dim:"#5a6a8a", muted:"#8898bb", bright:"#eef2ff",
  green:"#00e87a", greenD:"#00e87a18",
  blue:"#4d9ef7", blueD:"#4d9ef718",
  amber:"#ffb347", amberD:"#ffb34718",
  red:"#ff4f4f", redD:"#ff4f4f18",
  purple:"#c07bff", purpleD:"#c07bff18",
  cyan:"#38d9f5", cyanD:"#38d9f518",
  slack:"#e8a838", slackD:"#e8a83818",
  gmail:"#08da12", gmailD:"#08da1218",
  cal:"#5b9cf6", calD:"#5b9cf618",
};

const srcStyle = {
  gmail:    { color:T.gmail,  bg:T.gmailD,  icon:"ti-mail",         label:"gmail"    },
  slack:    { color:T.slack,  bg:T.slackD,  icon:"ti-brand-slack",  label:"slack"    },
  calendar: { color:T.cal,    bg:T.calD,    icon:"ti-calendar",     label:"cal"      },
  manual:   { color:"#c8c8c8",bg:"#c8c8c815",icon:"ti-pencil",      label:"manual"   },
};
const urgC  = { high:T.red,    medium:T.amber, low:T.green };
const prioC = { P1:[T.red,T.redD], P2:[T.amber,T.amberD], P3:[T.blue,T.blueD], P4:[T.dim,T.panel] };
const stC   = { "Not Started":T.dim, "In Progress":T.blue, "Waiting on Others":T.amber, "Completed":T.green };
const ttC   = { decision:T.purple, action:T.blue, delegate:T.amber, followup:T.cyan, people:T.green };
const tyI   = { deep_work:"ti-brain", meeting:"ti-calendar-event", followup:"ti-arrow-back", comms:"ti-mail", buffer:"ti-clock", strategic:"ti-telescope" };
const tyC   = { deep_work:T.blue, meeting:T.green, followup:T.amber, comms:T.purple, buffer:T.muted, strategic:T.cyan };

const SLASH_COMMANDS = [
  { cmd:"/sync",        desc:"Refresh briefing from Gmail, Calendar and Slack" },
  { cmd:"/slackunread", desc:"Scan and triage unread Slack messages" },
  { cmd:"/emailtriage", desc:"Triage inbox — categorize and clear noise" },
  { cmd:"/standup",     desc:"Generate today's standup draft" },
  { cmd:"/focus",       desc:"What should I work on right now?" },
  { cmd:"/blockers",    desc:"List everything blocked or waiting" },
  { cmd:"/delegate",    desc:"What can I push to someone else today?" },
  { cmd:"/eod",         desc:"End of day — what's left, what carries forward" },
  { cmd:"/week",        desc:"Weekly review — wins, risks, next week priorities" },
  { cmd:"/draft",       desc:"Draft a reply to the most urgent email" },
];

const mono = "'JetBrains Mono', monospace";
const M    = { fontFamily: mono };

const css = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
@import url('https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css');
* { box-sizing: border-box; margin: 0; padding: 0 }
body, #root { background: ${T.bg}; min-height: 100vh }
::-webkit-scrollbar { width: 3px }
::-webkit-scrollbar-track { background: transparent }
::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 2px }
input, select, textarea {
  background: ${T.card}; color: ${T.text};
  border: 1px solid ${T.border}; border-radius: 4px;
  padding: 8px 12px; font-size: 13px;
  font-family: ${mono}; outline: none; transition: border .15s;
}
input:focus, select:focus, textarea:focus { border-color: ${T.green} }
button { cursor: pointer; font-family: ${mono} }
a { color: ${T.cyan}; text-decoration: none }
a:hover { opacity: .8 }
@keyframes spin    { from { transform: rotate(0)   } to { transform: rotate(360deg) } }
@keyframes blink   { 0%,100% { opacity:1 } 50% { opacity:0 } }
@keyframes fadeIn  { from { opacity:0; transform:translateY(-6px) } to { opacity:1; transform:translateY(0) } }
.spin   { animation: spin 1s linear infinite }
.blink  { animation: blink 1s step-end infinite }
.fadeIn { animation: fadeIn .12s ease }
`;

// ── Small components ───────────────────────────────────────────
const Tag     = ({ children, color=T.muted, bg }) => (
  <span style={{ fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:3,
    border:`1px solid ${color}55`, color, background:bg||color+"18", ...M }}>{children}</span>
);
const SrcTag  = ({ source }) => {
  const s = srcStyle[source] || srcStyle.manual;
  return (
    <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:3,
      border:`1px solid ${s.color}55`, color:s.color, background:s.bg,
      display:"inline-flex", alignItems:"center", gap:3, ...M }}>
      <i className={`ti ${s.icon}`} style={{ fontSize:11 }} />{s.label}
    </span>
  );
};
const Blk     = ({ children, style={}, accent }) => (
  <div style={{ background:T.card, border:`1px solid ${accent?accent+"55":T.border}`,
    borderLeft:accent?`2px solid ${accent}`:`1px solid ${T.border}`,
    borderRadius:5, padding:"12px 16px", marginBottom:8, ...style }}>{children}</div>
);
const Lbl     = ({ children }) => (
  <div style={{ fontSize:11, fontWeight:700, color:T.muted, letterSpacing:".1em",
    textTransform:"uppercase", marginBottom:10, marginTop:2, ...M }}>
    {children}
  </div>
);
const Note    = ({ children }) => (
  <div style={{ fontSize:12, color:T.muted, marginTop:5, lineHeight:1.6, ...M }}>{children}</div>
);
const SlackLnk = ({ url }) => url ? (
  <a href={url} target="_blank" rel="noopener noreferrer"
    style={{ fontSize:11, color:T.slack, display:"inline-flex", alignItems:"center", gap:3, marginTop:5, ...M }}>
    <i className="ti ti-brand-slack" style={{ fontSize:12 }} />open in slack →
  </a>
) : null;
const Cursor  = () => (
  <span className="blink" style={{ display:"inline-block", width:7, height:13,
    background:T.green, marginLeft:2, verticalAlign:"middle" }} />
);

// ── XP Bar ─────────────────────────────────────────────────────
const XPBar = ({ tasks, overrides }) => {
  const all   = tasks.map(t => ({ ...t, status: overrides[t.id] || t.status }));
  const total = all.length || 1;
  const done  = all.filter(t => t.status === "Completed").length;
  const p1done= all.filter(t => t.priority === "P1" && t.status === "Completed").length;
  const xp    = done * 10 + p1done * 25;
  const pct   = Math.min(100, Math.round((done / total) * 100));
  const streak= done >= 5 ? "🔥 on fire" : done >= 3 ? "⚡ momentum" : done >= 1 ? "✓ started" : "";
  const bar   = pct >= 75 ? T.green : pct >= 40 ? T.amber : T.blue;
  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:6, padding:"12px 16px", marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:12, fontWeight:700, color:T.green, letterSpacing:".08em", ...M }}>TODAY</span>
          {streak && <span style={{ fontSize:11, color:T.amber, ...M }}>{streak}</span>}
        </div>
        <div style={{ display:"flex", gap:12, alignItems:"center" }}>
          <span style={{ fontSize:11, color:T.muted, ...M }}>{done}/{total} tasks</span>
          <span style={{ fontSize:12, fontWeight:700, color:T.amber, ...M }}>{xp} XP</span>
          <span style={{ fontSize:14, fontWeight:700, color:bar, ...M }}>{pct}%</span>
        </div>
      </div>
      <div style={{ height:5, background:T.border, borderRadius:3, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`,
          background:`linear-gradient(90deg,${T.blue},${bar})`,
          borderRadius:3, transition:"width .6s cubic-bezier(.4,0,.2,1)" }} />
      </div>
      {pct === 100 && (
        <div style={{ marginTop:8, fontSize:11, color:T.green, textAlign:"center", ...M }}>
          all tasks complete · {xp} XP earned today 🎯
        </div>
      )}
    </div>
  );
};

// ── Connect bar ────────────────────────────────────────────────
// Gmail + Calendar are both covered by one Google sign-in; Slack is its own.
const SERVICES = [
  { key:"gmail",    provider:"google", label:"Gmail",    icon:"ti-mail",        color:T.gmail },
  { key:"calendar", provider:"google", label:"Calendar", icon:"ti-calendar",    color:T.cal   },
  { key:"slack",    provider:"slack",  label:"Slack",    icon:"ti-brand-slack", color:T.slack },
];

const ConnectBar = ({ conns, onConnect, onDisconnect }) => {
  const byProvider = Object.fromEntries((conns || []).map(c => [c.provider, c]));
  return (
    <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
      {SERVICES.map(s => {
        const st        = byProvider[s.provider] || {};
        const connected = !!st.connected;
        const configured= st.configured !== false;
        const c         = connected ? s.color : T.dim;
        const title = !configured
          ? `Not set up yet — add ${s.provider.toUpperCase()} credentials in .env (see CONNECTORS.md)`
          : connected
            ? `Connected${st.account ? ` · ${st.account}` : ""} — click to disconnect`
            : `Connect ${s.label}`;
        return (
          <button key={s.key} title={title}
            onClick={() => connected ? onDisconnect(s.provider) : onConnect(s.provider)}
            style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:12, padding:"7px 12px",
              border:`1px solid ${connected ? c+"66" : T.border}`, borderRadius:5,
              background:connected ? c+"14" : "transparent", color:c, ...M }}>
            <i className={`ti ${s.icon}`} style={{ fontSize:14 }} />
            {connected ? s.label : `connect ${s.label.toLowerCase()}`}
            {connected && <span style={{ color:c, fontSize:11 }}>✓</span>}
            {!configured && <span style={{ color:T.dim, fontSize:10 }}>· setup</span>}
          </button>
        );
      })}
    </div>
  );
};

// ── Main App ───────────────────────────────────────────────────
export default function App() {
  const [tab,      setTab]      = useState("briefing");
  const [data,     setData]     = useState(null);
  const [ov,       setOv]       = useState({});
  const [custom,   setCustom]   = useState([]);
  const [filter,   setFilter]   = useState("all");
  const [sdMode,   setSdMode]   = useState("leadership");
  const [loading,  setLoading]  = useState(true);
  const [syncing,  setSyncing]  = useState(false);
  const [lastSaved,setLastSaved]= useState(null);
  const [newTask,  setNewTask]  = useState({ show:false, text:"", priority:"P2", due:"", type:"action" });
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput,setChatInput]= useState("");
  const [chatHist, setChatHist] = useState([]);
  const [chatLoad, setChatLoad] = useState(false);
  const [slashRes, setSlashRes] = useState([]);
  const [conns,    setConns]    = useState([]);
  const [status,   setStatus]   = useState(null);
  const [usage,    setUsage]    = useState(null);
  const [loops,    setLoops]    = useState(null);
  const [loopsBusy,setLoopsBusy]= useState(false);
  const [newLoop,  setNewLoop]  = useState("");
  const [expanded, setExpanded] = useState({});
  const [banner,   setBanner]   = useState(null);
  const [sheetUrl, setSheetUrl] = useState(null);
  const [memStats, setMemStats] = useState(null);
  const [profile,  setProfile]  = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [directives, setDirectives] = useState([]);
  const [showDirectives, setShowDirectives] = useState(false);
  const [newDirective, setNewDirective] = useState("");
  const chatEndRef = useRef(null);
  const inputRef   = useRef(null);

  useEffect(() => { init(); }, []);

  // Handle the OAuth return (?connect=google&status=ok) and load connections
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const provider = p.get("connect");
    const status   = p.get("status");
    if (provider) {
      setBanner(
        status === "ok"      ? { kind:"ok",  text:`${provider} connected ✓` }
      : status === "denied"  ? { kind:"err", text:`${provider} sign-in was cancelled` }
                             : { kind:"err", text:`${provider} connection failed — check setup` }
      );
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setBanner(null), 5000);
    }
    loadConns();
  }, []);

  const loadConns = async () => {
    try { const r = await api.getConnections(); setConns(r.connections || []); } catch {}
    try { const s = await api.getMemorySheet(); setSheetUrl(s.url || null); } catch {}
    try { const m = await api.getMemoryStats(); setMemStats(m); } catch {}
    try { const p = await api.getProfile(); setProfile(p.profile || null); } catch {}
    try { const dr = await api.getDirectives(); setDirectives(dr.directives || []); } catch {}
    try { const st = await api.getStatus(); setStatus(st); } catch {}
    try { const u = await api.getUsage(); setUsage(u); } catch {}
    try { const lp = await api.getOpenLoops(); setLoops(lp); } catch {}
  };

  const addDirective = async () => {
    const text = newDirective.trim();
    if (!text) return;
    setNewDirective("");
    try { const r = await api.addDirective(text); setDirectives(r.directives || []); } catch {}
  };
  const removeDirective = async (id) => {
    try { const r = await api.deleteDirective(id); setDirectives(r.directives || []); } catch {}
  };

  const openMemorySheet = async () => {
    // Lazily create + backfill on first use, then open
    try {
      const r = await api.backfillMemory();
      setSheetUrl(r.url);
      if (r.url) window.open(r.url, "_blank");
      setBanner({ kind:"ok", text:`memory sheet ready · ${r.count} rows synced` });
    } catch (e) {
      setBanner({ kind:"err", text:"couldn't open memory sheet — " + (e.message || "").slice(0, 60) });
    }
    setTimeout(() => setBanner(null), 5000);
  };

  const anyConnected = conns.some(c => c.connected);

  const refreshLoops = async () => {
    setLoopsBusy(true);
    try { const lp = await api.getOpenLoops(true); setLoops(lp); } catch {}
    setLoopsBusy(false);
  };
  const addLoop = async () => {
    const text = newLoop.trim();
    if (!text) return;
    setNewLoop("");
    try { const r = await api.addManualLoop(text); setLoops(l => ({ ...(l || {}), manual: r.manual })); } catch {}
  };
  const doneLoop = async (id) => {
    try { const r = await api.doneManualLoop(id); setLoops(l => ({ ...(l || {}), manual: r.manual })); } catch {}
  };

  // " (resets ~3:40 PM)" — friendly reset time for the usage-limit messaging
  const fmtReset = (iso) => iso
    ? ` (resets ~${new Date(iso).toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" })})`
    : "";

  const doConnect    = (provider) => {
    const c = conns.find(x => x.provider === provider);
    if (c && !c.configured) {
      setBanner({ kind:"err", text:`${provider} needs a one-time setup — see CONNECTORS.md, then restart` });
      setTimeout(() => setBanner(null), 6000);
      return;
    }
    api.connect(provider);
  };
  const doDisconnect = async (provider) => {
    try { await api.disconnect(provider); } catch {}
    loadConns();
  };

  const doSync = async () => {
    if (!anyConnected) { setBanner({ kind:"err", text:"connect a source first (Gmail / Calendar / Slack)" }); setTimeout(() => setBanner(null), 4000); return; }
    setSyncing(true);
    try {
      const r = await api.sync();
      if (r.cached) {
        if (r.briefing) setData(r.briefing);
        setBanner({ kind:"ok", text:"up to date — nothing changed since the last briefing." });
      } else if (r.queued) {
        // Claude is at its limit / offline — the job is parked and will run on recovery.
        setStatus(r);
        setBanner({ kind:"ok", text:`Claude is at its usage limit${fmtReset(r.blockedUntil)} — your briefing is queued and will refresh automatically once it resets.` });
      } else if (r.generating) {
        // Generation runs in the background (Claude takes a few min); the 30s poll
        // will swap in the new briefing automatically when it's ready.
        setBanner({ kind:"ok", text:"FRIDAY is rewriting your briefing with Claude — takes a couple of minutes, it'll update on its own." });
      }
    } catch (e) {
      setBanner({ kind:"err", text:"sync failed — " + (e.message || "error").slice(0, 80) });
    }
    setSyncing(false);
    setTimeout(() => setBanner(null), 9000);
  };

  // Poll for new briefings every 30s (and refresh queue/limit status)
  useEffect(() => {
    const poll = setInterval(async () => {
      try { const st = await api.getStatus(); setStatus(st); } catch {}
      try { const u = await api.getUsage(); setUsage(u); } catch {}
      try { const lp = await api.getOpenLoops(); setLoops(lp); } catch {}
      try {
        const res = await api.getBriefing();
        if (res.briefing) {
          const incoming = new Date(res.briefing.savedAt).getTime();
          const current  = lastSaved ? lastSaved.getTime() : 0;
          if (incoming > current) {
            setData(res.briefing);
            setOv(res.overrides || {});
            setCustom(res.customTasks || []);
            setLastSaved(new Date(res.briefing.savedAt));
          }
        }
      } catch {}
    }, 30000);
    return () => clearInterval(poll);
  }, [lastSaved]);

  useEffect(() => { if (chatOpen) setTimeout(() => inputRef.current?.focus(), 80); }, [chatOpen]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatHist, chatLoad]);
  useEffect(() => {
    const h = e => {
      if (e.key === "Escape") { setChatOpen(false); setSlashRes([]); }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setChatOpen(o => !o); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const init = async () => {
    setLoading(true);
    try {
      const res = await api.getBriefing();
      if (res.briefing) {
        setData(res.briefing);
        setOv(res.overrides || {});
        setCustom(res.customTasks || []);
        setLastSaved(new Date(res.briefing.savedAt));
      }
    } catch (e) { console.error("Init error:", e); }
    setLoading(false);
  };

  const cycleStatus = async (id, cur) => {
    const c    = ["Not Started", "In Progress", "Waiting on Others", "Completed"];
    const next = c[(c.indexOf(cur) + 1) % c.length];
    setOv(o => ({ ...o, [id]: next }));
    try { await api.updateTaskStatus(id, next); } catch {}
  };

  const addTask = async () => {
    if (!newTask.text.trim()) return;
    const task = {
      id: "c_" + Date.now(), task: newTask.text, owner: "Me",
      due: newTask.due || "—", status: "Not Started",
      priority: newTask.priority, priority_reason: "Manual entry",
      source: "manual", type: newTask.type,
    };
    setCustom(c => [...c, task]);
    setNewTask({ show: false, text: "", priority: "P2", due: "", type: "action" });
    try { await api.addCustomTask(task); } catch {}
  };

  const allTasks = () => {
    const base = (data?.action_items || []).map(t => ({ ...t, status: ov[t.id] || t.status }));
    const all  = [...base, ...custom.map(t => ({ ...t, status: ov[t.id] || t.status }))];
    if (filter === "all")     return all;
    if (filter === "pending") return all.filter(t => t.status !== "Completed");
    if (["P1","P2","P3"].includes(filter)) return all.filter(t => t.priority === filter);
    return all;
  };

  const handleChatInput = e => {
    const val = e.target.value;
    setChatInput(val);
    if (val.startsWith("/")) setSlashRes(SLASH_COMMANDS.filter(c => c.cmd.startsWith(val.toLowerCase())));
    else setSlashRes([]);
  };
  const pickSlash = cmd => { setChatInput(cmd + " "); setSlashRes([]); inputRef.current?.focus(); };

  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoad) return;
    setChatInput(""); setSlashRes([]);
    const h = [...chatHist, { role: "user", content: msg }];
    setChatHist(h); setChatLoad(true);
    try {
      const res = await api.sendChat(
        h.map(m => ({ role: m.role, content: m.content })),
        data
      );
      if (res.queued) {
        // Claude is at its limit — park the question and resolve it when it's answered.
        setStatus(res);
        setChatHist(prev => [...prev, { role:"assistant", jobId:res.jobId, pending:true,
          content:`⏳ Claude is at its usage limit${fmtReset(res.blockedUntil)}. I've queued this — it'll answer here automatically once the limit resets.` }]);
        pollChatJob(res.jobId);
      } else {
        setChatHist(prev => [...prev, { role: "assistant", content: res.reply }]);
      }
    } catch {
      setChatHist(prev => [...prev, { role: "assistant", content: "error: server unreachable." }]);
    }
    setChatLoad(false);
  };

  // A queued chat answer arrives later — poll the outbox job and swap it in.
  const pollChatJob = (jobId) => {
    const iv = setInterval(async () => {
      try {
        const { job } = await api.getOutboxJob(jobId);
        if (!job) return;
        if (job.status === "done") {
          clearInterval(iv);
          setChatHist(prev => prev.map(m => m.jobId === jobId
            ? { role:"assistant", content: job.result?.reply || "(no answer)" } : m));
        } else if (job.status === "failed") {
          clearInterval(iv);
          setChatHist(prev => prev.map(m => m.jobId === jobId
            ? { role:"assistant", content: "couldn't complete this — " + (job.error || "error") } : m));
        }
      } catch {}
    }, 15000);
    setTimeout(() => clearInterval(iv), 30 * 60 * 1000); // safety stop
  };

  if (loading) return (
    <div style={{ background:T.bg, height:"100vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <style>{css}</style>
      <div style={{ textAlign:"center", ...M }}>
        <div style={{ fontSize:22, fontWeight:700, color:T.green, marginBottom:6, letterSpacing:".2em" }}>FRIDAY</div>
        <div style={{ fontSize:11, color:T.muted, marginBottom:20 }}>Focused Realtime Intelligence for Daily Accountability &amp; Yield</div>
        <div style={{ fontSize:12, color:T.dim }}>initializing<span className="blink">_</span></div>
      </div>
    </div>
  );

  if (!data) return (
    <div style={{ background:T.bg, minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <style>{css}</style>
      <div style={{ textAlign:"center", ...M, maxWidth:460, width:"100%" }}>
        <div style={{ fontSize:22, fontWeight:700, color:T.green, marginBottom:6, letterSpacing:".2em" }}>FRIDAY</div>
        <div style={{ fontSize:11, color:T.muted, marginBottom:24 }}>Connect your sources to generate your first briefing.</div>
        {banner && (
          <div style={{ fontSize:12, marginBottom:16, padding:"8px 12px", borderRadius:5,
            color:banner.kind==="ok"?T.green:T.red, background:(banner.kind==="ok"?T.green:T.red)+"14",
            border:`1px solid ${(banner.kind==="ok"?T.green:T.red)}44`, ...M }}>{banner.text}</div>
        )}
        <div style={{ display:"flex", justifyContent:"center" }}>
          <ConnectBar conns={conns} onConnect={doConnect} onDisconnect={doDisconnect} />
        </div>
        <button onClick={doSync} disabled={syncing || !anyConnected}
          style={{ marginTop:8, fontSize:13, padding:"10px 22px", borderRadius:5,
            background:anyConnected?T.greenD:"transparent", border:`1px solid ${anyConnected?T.green+"66":T.border}`,
            color:anyConnected?T.green:T.dim, ...M }}>
          <i className={`ti ti-sparkles ${syncing?"spin":""}`} style={{ fontSize:13, verticalAlign:"-2px", marginRight:6 }} />
          {syncing ? "generating briefing..." : "generate briefing"}
        </button>
        <div style={{ fontSize:11, color:T.dim, lineHeight:1.8, marginTop:22 }}>
          First time? Each service needs a one-time setup in <span style={{ color:T.cyan }}>CONNECTORS.md</span>.<br/>
          Already automated? n8n can also POST to <span style={{ color:T.cyan }}>/api/briefing</span>.
        </div>
      </div>
    </div>
  );

  const { briefing, standup, schedule, summary, learn } = data || {};
  const taskList = allTasks();
  const rawTasks = data?.action_items || [];
  const p1    = rawTasks.map(t => ({ ...t, status: ov[t.id] || t.status })).filter(t => t.priority === "P1" && t.status !== "Completed").length;
  const pend  = taskList.filter(t => t.status !== "Completed").length;
  const meets = (schedule || []).filter(b => b.type === "meeting").length;
  const fups  = (briefing?.stakeholder_followups || []).length;
  const slackOpen = loops?.slackOpen || [];
  const emailOpen = loops?.emailOpen || [];
  const manualOpen = loops?.manual || [];
  const sOpen = loops?.summary?.slackOpen ?? slackOpen.length;
  const eOpen = loops?.summary?.emailOpen ?? emailOpen.length;
  const mOpen = manualOpen.length;
  const now   = new Date();
  const timeStr = now.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:false });
  const dateStr = now.toLocaleDateString("en-IN", { weekday:"short", day:"2-digit", month:"short" });

  return (
    <div style={{ background:T.bg, minHeight:"100vh", padding:16, paddingBottom:120, ...M }}>
      <style>{css}</style>

      {/* Floating chat */}
      <div style={{ position:"fixed", bottom:20, right:20, zIndex:300 }}>
        {chatOpen && (
          <div className="fadeIn" style={{ position:"absolute", bottom:64, right:0, width:380,
            background:T.panel, border:`1px solid ${T.green}55`, borderRadius:10, overflow:"hidden",
            boxShadow:`0 24px 48px rgba(0,0,0,.7), 0 0 0 1px ${T.green}11` }}>
            <div style={{ padding:"10px 14px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:T.green }} />
              <span style={{ fontSize:12, fontWeight:700, color:T.green, letterSpacing:".15em", flex:1 }}>FRIDAY</span>
              <span style={{ fontSize:10, color:T.dim }}>⌘K · esc</span>
              <button onClick={() => setChatOpen(false)} style={{ background:"transparent", border:"none", color:T.dim, fontSize:14 }}>
                <i className="ti ti-x" />
              </button>
            </div>
            {chatHist.length === 0 && (
              <div style={{ padding:"10px 14px" }}>
                {["/focus", "/blockers", "/delegate", "/standup", "/eod"].map(cmd => {
                  const c = SLASH_COMMANDS.find(x => x.cmd === cmd);
                  return (
                    <div key={cmd} onClick={() => pickSlash(cmd)} style={{ padding:"6px 10px", borderRadius:4,
                      border:`1px solid ${T.border}`, cursor:"pointer", display:"flex",
                      gap:8, alignItems:"flex-start", marginBottom:4 }}>
                      <span style={{ color:T.green, fontSize:12, flexShrink:0, ...M }}>{cmd}</span>
                      <span style={{ fontSize:11, color:T.muted, ...M }}>{c?.desc}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {chatHist.length > 0 && (
              <div style={{ maxHeight:300, overflowY:"auto", padding:"10px 14px", display:"flex", flexDirection:"column", gap:8 }}>
                {chatHist.map((m, i) => (
                  <div key={i} style={{ display:"flex", gap:6, alignItems:"flex-start" }}>
                    <span style={{ fontSize:10, fontWeight:700, color:m.role==="user"?T.green:T.cyan, flexShrink:0, paddingTop:2, ...M }}>
                      {m.role === "user" ? "rk" : "friday"}
                    </span>
                    <span style={{ fontSize:10, color:T.dim, paddingTop:2, flexShrink:0, ...M }}>&gt;</span>
                    <span style={{ fontSize:12, color:m.role==="user"?T.bright:T.text, lineHeight:1.6, flex:1, whiteSpace:"pre-wrap", ...M }}>
                      {m.content}
                    </span>
                  </div>
                ))}
                {chatLoad && (
                  <div style={{ display:"flex", gap:6 }}>
                    <span style={{ fontSize:10, fontWeight:700, color:T.cyan, ...M }}>friday</span>
                    <span style={{ fontSize:10, color:T.dim, ...M }}>&gt;</span>
                    <span style={{ fontSize:12, color:T.dim, ...M }}>thinking<span className="blink">_</span></span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}
            {slashRes.length > 0 && (
              <div style={{ borderTop:`1px solid ${T.border}`, maxHeight:160, overflowY:"auto" }}>
                {slashRes.map(c => (
                  <div key={c.cmd} onClick={() => pickSlash(c.cmd)} style={{ padding:"8px 14px", cursor:"pointer",
                    display:"flex", gap:10, borderBottom:`1px solid ${T.border}22` }}>
                    <span style={{ color:T.green, fontSize:12, flexShrink:0, minWidth:110, ...M }}>{c.cmd}</span>
                    <span style={{ fontSize:11, color:T.muted, ...M }}>{c.desc}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ borderTop:`1px solid ${T.border}`, padding:"8px 14px", display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:11, color:T.green, flexShrink:0, ...M }}>rk&gt;</span>
              <input ref={inputRef} value={chatInput} onChange={handleChatInput}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
                  if (e.key === "Tab" && slashRes.length > 0) { e.preventDefault(); pickSlash(slashRes[0].cmd); }
                }}
                style={{ flex:1, background:"transparent", border:"none", fontSize:12, padding:"2px 0", color:T.green }}
                placeholder="ask or type / for commands..." />
              <button onClick={sendChat} style={{ background:"transparent", border:"none", color:T.green, fontSize:14 }}>
                <i className="ti ti-send" />
              </button>
            </div>
          </div>
        )}
        <button onClick={() => setChatOpen(o => !o)} style={{ width:54, height:54, borderRadius:"50%",
          background:chatOpen?T.card:T.bg, border:`2px solid ${chatOpen?T.borderB:T.green}`,
          color:chatOpen?T.muted:T.green, fontSize:24, display:"flex", alignItems:"center", justifyContent:"center",
          boxShadow:chatOpen?"none":`0 0 0 1px ${T.green}33, 0 4px 24px ${T.green}22` }}>
          <i className={`ti ${chatOpen ? "ti-x" : "ti-message-circle-2"}`} style={{ fontSize:24, lineHeight:1 }} />
        </button>
        {!chatOpen && (
          <div style={{ position:"absolute", bottom:60, right:0, fontSize:9, color:T.dim,
            whiteSpace:"nowrap", background:T.panel, padding:"2px 6px", borderRadius:3,
            border:`1px solid ${T.border}`, ...M }}>⌘K</div>
        )}
      </div>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:8 }}>
        <div>
          <div style={{ fontSize:11, color:T.dim, marginBottom:4 }}>
            <span style={{ color:T.green, fontWeight:700, letterSpacing:".2em" }}>FRIDAY</span>
            <span style={{ color:T.dim, margin:"0 6px" }}>/</span>
            <span style={{ color:T.muted }}>friday --session {dateStr} {timeStr}</span>
          </div>
          <div style={{ fontSize:15, fontWeight:600, color:T.bright, lineHeight:1.4 }}>
            {summary?.focus_of_day || "ready"}<Cursor />
          </div>
          {summary?.risk_flag && (
            <div style={{ fontSize:12, color:T.red, marginTop:5, display:"flex", alignItems:"flex-start", gap:6 }}>
              <i className="ti ti-alert-triangle" style={{ fontSize:13, marginTop:1, flexShrink:0 }} />
              {summary.risk_flag}
            </div>
          )}
        </div>
        <button onClick={doSync} disabled={syncing} style={{ fontSize:11, padding:"7px 14px",
          background:"transparent", border:`1px solid ${T.border}`, borderRadius:4, color:T.muted, ...M }}>
          <i className={`ti ti-refresh ${syncing ? "spin" : ""}`} style={{ fontSize:12, verticalAlign:"-2px", marginRight:4 }} />
          {syncing ? "syncing..." : "sync"}
        </button>
      </div>

      {banner && (
        <div style={{ fontSize:12, marginBottom:12, padding:"8px 12px", borderRadius:5,
          color:banner.kind==="ok"?T.green:T.red, background:(banner.kind==="ok"?T.green:T.red)+"14",
          border:`1px solid ${(banner.kind==="ok"?T.green:T.red)}44`, ...M }}>{banner.text}</div>
      )}

      {/* Offline-sync / usage-limit strip — only shows when something is parked */}
      {status && (status.claudeBlocked || status.offline || status.pending > 0) && (
        <div style={{ fontSize:12, marginBottom:12, padding:"8px 12px", borderRadius:5,
          color:T.amber, background:T.amberD, border:`1px solid ${T.amber}44`,
          display:"flex", alignItems:"center", gap:8, ...M }}>
          <i className={`ti ${status.offline ? "ti-wifi-off" : "ti-clock-pause"}`} style={{ fontSize:14 }} />
          <span style={{ flex:1 }}>
            {status.offline
              ? "Offline — work is queued and will sync automatically when you're back online."
              : status.claudeBlocked
                ? `Claude is at its usage limit${fmtReset(status.blockedUntil)} — ${status.pending} item${status.pending===1?"":"s"} queued, will sync in once it resets.`
                : `${status.pending} item${status.pending===1?"":"s"} in the sync pipeline…`}
          </span>
        </div>
      )}

      <ConnectBar conns={conns} onConnect={doConnect} onDisconnect={doDisconnect} />

      {/* Metrics — what's actually on you (auto-detected) */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:16 }}>
        {[[sOpen,"slack open",T.slack,"ti-brand-slack"],
          [eOpen,"email open",T.cal,"ti-mail"],
          [meets,"meetings",T.green,"ti-calendar-event"],
          [fups,"follow-ups",T.amber,"ti-user-up"]]
          .map(([v,l,c,ic]) => (
            <div key={l} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"12px 14px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <i className={`ti ${ic}`} style={{ fontSize:13, color:c }} />
                <span style={{ fontSize:22, fontWeight:700, color:T.bright, ...M }}>{v}</span>
              </div>
              <div style={{ fontSize:10, color:T.dim, marginTop:3, letterSpacing:".04em", ...M }}>{l}</div>
            </div>
          ))}
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:2, marginBottom:16, background:T.panel, borderRadius:8, padding:3, border:`1px solid ${T.border}` }}>
        {["briefing","loops","standup","schedule"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ flex:1, fontSize:12.5, padding:"9px", border:"none",
            background:tab===t?T.card:"transparent", color:tab===t?T.green:T.muted, borderRadius:6, transition:"all .12s",
            fontWeight:tab===t?600:400, ...M }}>
            {t === "loops" ? `loops${sOpen+mOpen ? ` · ${sOpen+mOpen}` : ""}` : t}
          </button>
        ))}
      </div>

      {/* ── Briefing ── */}
      {tab === "briefing" && (
        <div>
          {learn && learn.title && (
            <div style={{ background:`linear-gradient(135deg, ${T.purpleD}, ${T.cyanD})`,
              border:`1px solid ${T.purple}44`, borderLeft:`2px solid ${T.purple}`, borderRadius:6,
              padding:"12px 16px", marginBottom:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:7 }}>
                <i className="ti ti-bulb" style={{ fontSize:14, color:T.purple }} />
                <span style={{ fontSize:11, fontWeight:700, color:T.purple, letterSpacing:".12em", ...M }}>LEARN TODAY</span>
                {learn.category && <Tag color={T.cyan}>{learn.category}</Tag>}
              </div>
              <div style={{ fontSize:14, fontWeight:600, color:T.bright, marginBottom:5 }}>{learn.title}</div>
              <div style={{ fontSize:13, color:T.text, lineHeight:1.65, marginBottom:learn.example?7:0 }}>{learn.lesson}</div>
              {learn.example && (
                <div style={{ fontSize:12, color:T.cyan, background:T.bg, border:`1px solid ${T.border}`,
                  borderRadius:4, padding:"7px 10px", margin:"2px 0 7px", whiteSpace:"pre-wrap", ...M }}>{learn.example}</div>
              )}
              {learn.try_this && (
                <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>
                  <span style={{ color:T.green, fontWeight:700 }}>try today → </span>{learn.try_this}
                </div>
              )}
            </div>
          )}
          <Lbl>critical updates</Lbl>
          {(briefing?.critical_updates || []).map((u, i) => {
            const c = urgC[u.urgency || "medium"];
            const key = `cu-${i}`;
            const open = expanded[key] ?? (i === 0); // first one open, rest collapsed
            return (
              <div key={i} style={{ background:T.card, border:`1px solid ${T.border}`, borderLeft:`2px solid ${c}`,
                borderRadius:6, marginBottom:6, overflow:"hidden" }}>
                <div onClick={() => setExpanded(e => ({ ...e, [key]: !open }))}
                  style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px", cursor:"pointer" }}>
                  <span style={{ width:7, height:7, borderRadius:"50%", background:c, flexShrink:0 }} />
                  <span style={{ flex:1, fontSize:14, fontWeight:600, color:T.bright, lineHeight:1.35 }}>{u.title}</span>
                  <i className={`ti ${srcStyle[u.source]?.icon || "ti-pencil"}`} style={{ fontSize:13, color:(srcStyle[u.source]||srcStyle.manual).color, flexShrink:0 }} />
                  <i className={`ti ti-chevron-${open?"up":"down"}`} style={{ fontSize:14, color:T.dim, flexShrink:0 }} />
                </div>
                {open && (
                  <div style={{ padding:"0 14px 12px 31px" }}>
                    <div style={{ fontSize:13, color:T.text, lineHeight:1.7 }}>{u.detail}</div>
                    {u.slack_url && <SlackLnk url={u.slack_url} />}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ height:18 }} />

          <Lbl>decisions needed</Lbl>
          {!(briefing?.decisions_needed?.length)
            ? <Note>no pending decisions</Note>
            : briefing.decisions_needed.map((d, i) => {
                const key = `dn-${i}`;
                const open = expanded[key] ?? false;
                return (
                  <div key={i} style={{ background:T.card, border:`1px solid ${T.border}`, borderLeft:`2px solid ${T.purple}`,
                    borderRadius:6, marginBottom:6, overflow:"hidden" }}>
                    <div onClick={() => setExpanded(e => ({ ...e, [key]: !open }))}
                      style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px", cursor:"pointer" }}>
                      <i className="ti ti-help-circle" style={{ fontSize:14, color:T.purple, flexShrink:0 }} />
                      <span style={{ flex:1, fontSize:14, fontWeight:600, color:T.bright, lineHeight:1.35 }}>{d.title}</span>
                      {d.from && <span style={{ fontSize:11, color:T.dim, flexShrink:0, ...M }}>{d.from}</span>}
                      <i className={`ti ti-chevron-${open?"up":"down"}`} style={{ fontSize:14, color:T.dim, flexShrink:0 }} />
                    </div>
                    {open && <div style={{ padding:"0 14px 12px 38px", fontSize:13, color:T.text, lineHeight:1.6 }}>{d.context}</div>}
                  </div>
                );
              })
          }
          <div style={{ height:18 }} />

          <Lbl>stakeholder follow-ups</Lbl>
          {(briefing?.stakeholder_followups || []).map((f, i) => (
            <Blk key={i} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
              <div style={{ fontSize:12, fontWeight:700, color:T.cyan, background:T.cyanD,
                padding:"5px 8px", borderRadius:3, flexShrink:0, ...M }}>
                {(f.person || "?").split(" ").map(w => w[0]).join("").slice(0, 2)}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:600, color:T.bright, marginBottom:3 }}>{f.person}</div>
                <div style={{ fontSize:12, color:T.text, marginBottom:3 }}>{f.topic}</div>
                <div style={{ fontSize:11, color:T.dim }}>since {f.waiting_since} · via {f.channel}</div>
                {f.slack_url && <SlackLnk url={f.slack_url} />}
              </div>
            </Blk>
          ))}
        </div>
      )}

      {/* ── Open Loops ── */}
      {tab === "loops" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div style={{ fontSize:12, color:T.muted, lineHeight:1.6, ...M }}>
              Things still on you — auto-detected from what you've replied to. Nothing to tick off.
            </div>
            <button onClick={refreshLoops} disabled={loopsBusy} style={{ fontSize:11, padding:"6px 12px",
              background:"transparent", border:`1px solid ${T.border}`, borderRadius:5, color:T.muted, flexShrink:0, ...M }}>
              <i className={`ti ti-refresh ${loopsBusy?"spin":""}`} style={{ fontSize:12, verticalAlign:"-2px", marginRight:4 }} />
              refresh
            </button>
          </div>

          {/* Quick capture — for in-person / calls / anything with no digital trace */}
          <div style={{ display:"flex", gap:6, marginBottom:8 }}>
            <input value={newLoop} onChange={e => setNewLoop(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addLoop()}
              placeholder="jot something that's on you — e.g. Program Master update, call vendor…"
              style={{ flex:1 }} />
            <button onClick={addLoop} style={{ padding:"8px 16px", background:T.green, border:"none",
              borderRadius:5, color:T.bg, fontWeight:700, fontSize:12, ...M }}>add</button>
          </div>

          {/* Captured — things you noted yourself (highest priority, only you know these) */}
          {manualOpen.length > 0 && (
            <div style={{ marginBottom:18 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, margin:"6px 0 10px" }}>
                <i className="ti ti-pin" style={{ fontSize:14, color:T.purple }} />
                <span style={{ fontSize:12, fontWeight:700, color:T.purple, letterSpacing:".08em", ...M }}>CAPTURED · ON YOU</span>
                <span style={{ fontSize:11, color:T.dim, ...M }}>{mOpen}</span>
              </div>
              {manualOpen.map(m => (
                <div key={m.id} style={{ display:"flex", gap:10, alignItems:"center", background:T.card,
                  border:`1px solid ${T.border}`, borderLeft:`2px solid ${T.purple}`, borderRadius:6, padding:"10px 14px", marginBottom:6 }}>
                  <button onClick={() => doneLoop(m.id)} title="Mark done"
                    style={{ width:18, height:18, borderRadius:4, border:`1.5px solid ${T.borderB}`, background:"transparent",
                      display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:T.green, fontSize:11 }}>✓</button>
                  <span style={{ flex:1, fontSize:13, color:T.text, lineHeight:1.5, ...M }}>{m.text}</span>
                  <i className="ti ti-trash" onClick={() => doneLoop(m.id)} style={{ fontSize:13, color:T.dim, cursor:"pointer", flexShrink:0 }} />
                </div>
              ))}
            </div>
          )}

          {!loops ? <Note>// detecting open loops…</Note> : (sOpen + eOpen + mOpen === 0) ? (
            <div style={{ textAlign:"center", padding:"40px 0", color:T.dim }}>
              <i className="ti ti-circle-check" style={{ fontSize:30, color:T.green, marginBottom:10, display:"block" }} />
              <div style={{ fontSize:14, color:T.green, ...M }}>All caught up</div>
              <div style={{ fontSize:12, color:T.dim, marginTop:4, ...M }}>nothing's waiting on a reply from you</div>
            </div>
          ) : (
            <>
              {/* Slack open loops — primary */}
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <i className="ti ti-brand-slack" style={{ fontSize:14, color:T.slack }} />
                <span style={{ fontSize:12, fontWeight:700, color:T.slack, letterSpacing:".08em", ...M }}>SLACK · WAITING ON YOU</span>
                <span style={{ fontSize:11, color:T.dim, ...M }}>{sOpen}</span>
              </div>
              {slackOpen.length === 0 ? <Note>// you're clear on Slack</Note> : slackOpen.map((m, i) => (
                <a key={m.id || i} href={m.slack_url} target="_blank" rel="noopener noreferrer"
                  style={{ display:"block", textDecoration:"none" }}>
                  <div style={{ background:T.card, border:`1px solid ${T.border}`, borderLeft:`2px solid ${T.slack}`,
                    borderRadius:6, padding:"10px 14px", marginBottom:6, transition:"border .12s" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginBottom:4 }}>
                      <span style={{ fontSize:12, color:T.slack, fontWeight:600, ...M }}>#{m.channel}</span>
                      <span style={{ fontSize:10, color:m.ageHours>=24?T.red:T.dim, ...M }}>
                        {m.ageHours>=24 ? `${Math.floor(m.ageHours/24)}d` : `${m.ageHours}h`} ago
                      </span>
                    </div>
                    <div style={{ fontSize:13, color:T.text, lineHeight:1.55, ...M }}>
                      <span style={{ color:T.muted }}>@{m.user}: </span>
                      {(m.text || "").replace(/<@[A-Z0-9]+\|([^>]+)>/g, "@$1").replace(/\s+/g," ").slice(0, 160)}
                    </div>
                  </div>
                </a>
              ))}

              {/* Email open loops — secondary */}
              <div style={{ display:"flex", alignItems:"center", gap:8, margin:"18px 0 10px" }}>
                <i className="ti ti-mail" style={{ fontSize:14, color:T.cal }} />
                <span style={{ fontSize:12, fontWeight:700, color:T.cal, letterSpacing:".08em", ...M }}>EMAIL · WAITING ON YOU</span>
                <span style={{ fontSize:11, color:T.dim, ...M }}>{eOpen}{loops?.summary?.emailUnread ? ` · ${loops.summary.emailUnread} unread` : ""}</span>
              </div>
              {emailOpen.length === 0 ? <Note>// inbox clear</Note> : emailOpen.map((t, i) => (
                <div key={t.id || i} style={{ background:T.card, border:`1px solid ${T.border}`, borderLeft:`2px solid ${T.cal}`,
                  borderRadius:6, padding:"10px 14px", marginBottom:6, opacity:t.unread?1:0.7 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginBottom:3 }}>
                    <span style={{ fontSize:13, color:T.bright, fontWeight:t.unread?600:500, ...M }}>
                      {t.unread && <span style={{ color:T.cal, marginRight:6 }}>●</span>}
                      {(t.from || "").replace(/<.*>/, "").replace(/"/g,"").trim().slice(0, 34)}
                    </span>
                    <span style={{ fontSize:10, color:T.dim, ...M }}>{t.unread ? "unread" : "read"}</span>
                  </div>
                  <div style={{ fontSize:12.5, color:T.text, lineHeight:1.5, ...M }}>{(t.subject || "(no subject)").slice(0, 90)}</div>
                  {t.snippet && <div style={{ fontSize:11, color:T.dim, marginTop:3, lineHeight:1.5, ...M }}>{t.snippet.slice(0, 110)}</div>}
                </div>
              ))}
              {loops?.summary?.emailShown < eOpen && (
                <Note>// +{eOpen - loops.summary.emailShown} more open in Gmail (showing unread &amp; most recent first)</Note>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Standup ── */}
      {tab === "standup" && (
        <div>
          <div style={{ display:"flex", gap:6, marginBottom:14 }}>
            {["leadership", "team"].map(m => (
              <button key={m} onClick={() => setSdMode(m)} style={{ fontSize:12, padding:"7px 16px",
                border:`1px solid ${sdMode===m?(m==="leadership"?T.blue:T.green)+"66":T.border}`,
                borderRadius:4, background:sdMode===m?(m==="leadership"?T.blueD:T.greenD):"transparent",
                color:sdMode===m?(m==="leadership"?T.blue:T.green):T.muted, ...M }}>
                {m === "leadership" ? "// leadership" : "// team"}
              </button>
            ))}
          </div>
          {sdMode === "leadership" && ["yesterday","today","blockers"].map(k => (
            <div key={k} style={{ marginBottom:16 }}>
              <Lbl>{k}</Lbl>
              {(standup?.leadership?.[k] || []).map((item, i) => (
                <div key={i} style={{ display:"flex", gap:10, marginBottom:8 }}>
                  <span style={{ color:{yesterday:T.muted,today:T.green,blockers:T.red}[k], fontSize:12, flexShrink:0, marginTop:1 }}>+</span>
                  <span style={{ fontSize:13, color:T.text, lineHeight:1.6 }}>{item}</span>
                </div>
              ))}
            </div>
          ))}
          {sdMode === "team" && (
            <div>
              {["yesterday","today"].map(k => (
                <div key={k} style={{ marginBottom:16 }}>
                  <Lbl>{k}</Lbl>
                  {(standup?.team?.[k] || []).map((item, i) => (
                    <div key={i} style={{ display:"flex", gap:10, marginBottom:8 }}>
                      <span style={{ color:k==="today"?T.green:T.muted, fontSize:12, flexShrink:0, marginTop:1 }}>+</span>
                      <span style={{ fontSize:13, color:T.text, lineHeight:1.6 }}>{item}</span>
                    </div>
                  ))}
                </div>
              ))}
              <Lbl>delegate</Lbl>
              {(standup?.team?.delegate || []).map((item, i) => (
                <Blk key={i} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"10px 14px" }}>
                  <span style={{ color:T.amber, fontSize:13, flexShrink:0 }}>→</span>
                  <span style={{ fontSize:13, color:T.text, lineHeight:1.5 }}>{item}</span>
                </Blk>
              ))}
            </div>
          )}
          <div style={{ marginTop:10 }}>
            <button style={{ fontSize:12, padding:"8px 16px",
              background:sdMode==="leadership"?T.blueD:T.greenD,
              border:`1px solid ${sdMode==="leadership"?T.blue:T.green}44`,
              borderRadius:4, color:sdMode==="leadership"?T.blue:T.green, ...M }}>
              $ draft {sdMode}-standup ↗
            </button>
          </div>
        </div>
      )}

      {/* ── Tasks ── */}
      {tab === "tasks" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginBottom:12 }}>
            <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
              {["all","pending","P1","P2","P3"].map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{ fontSize:12, padding:"5px 12px",
                  border:`1px solid ${filter===f?T.green:T.border}`, borderRadius:3,
                  background:filter===f?T.greenD:"transparent", color:filter===f?T.green:T.muted, ...M }}>
                  {f}
                </button>
              ))}
            </div>
            <button onClick={() => setNewTask(n => ({ ...n, show:true }))} style={{ fontSize:12, padding:"6px 14px",
              background:T.greenD, border:`1px solid ${T.green}44`, borderRadius:3, color:T.green, ...M }}>
              + new task
            </button>
          </div>

          {newTask.show && (
            <Blk style={{ marginBottom:10, background:T.bg }}>
              <input style={{ width:"100%", marginBottom:8 }} placeholder="task description..."
                value={newTask.text} onChange={e => setNewTask(n => ({ ...n, text:e.target.value }))}
                onKeyDown={e => e.key === "Enter" && addTask()} />
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                <select style={{ flex:1 }} value={newTask.priority} onChange={e => setNewTask(n => ({ ...n, priority:e.target.value }))}>
                  {["P1","P2","P3","P4"].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select style={{ flex:1 }} value={newTask.type} onChange={e => setNewTask(n => ({ ...n, type:e.target.value }))}>
                  {["action","decision","delegate","followup","people"].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input type="date" style={{ flex:1 }} value={newTask.due} onChange={e => setNewTask(n => ({ ...n, due:e.target.value }))} />
                <button onClick={addTask} style={{ padding:"7px 16px", background:T.green, border:"none", borderRadius:3, color:T.bg, fontWeight:700, fontSize:12, ...M }}>add</button>
                <button onClick={() => setNewTask({ show:false, text:"", priority:"P2", due:"", type:"action" })} style={{ padding:"7px 12px", background:"transparent", border:`1px solid ${T.border}`, borderRadius:3, color:T.dim, fontSize:12, ...M }}>esc</button>
              </div>
            </Blk>
          )}

          {taskList.length === 0
            ? <Note>// no tasks matching filter</Note>
            : taskList.map((task, i) => {
                const status = ov[task.id] || task.status;
                const [pc, pb] = prioC[task.priority] || prioC.P4;
                const sc = stC[status] || T.dim;
                const nxtLabel = { "Not Started":"→ start", "In Progress":"→ block", "Waiting on Others":"→ done", "Completed":"→ reopen" }[status] || "→ next";
                return (
                  <Blk key={task.id} style={{ opacity:status==="Completed"?0.4:1, marginBottom:6 }}>
                    <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                      <button onClick={() => cycleStatus(task.id, status)} style={{ marginTop:3, width:18, height:18, borderRadius:3,
                        border:`1.5px solid ${status==="Completed"?T.green:T.borderB}`,
                        background:status==="Completed"?T.greenD:"transparent",
                        display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        {status === "Completed" && <span style={{ fontSize:10, color:T.green }}>✓</span>}
                      </button>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:14, fontWeight:500, color:status==="Completed"?T.dim:T.bright,
                          textDecoration:status==="Completed"?"line-through":"none",
                          marginBottom:6, lineHeight:1.4, wordBreak:"break-word" }}>{task.task}</div>
                        <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center", marginBottom:4 }}>
                          <Tag color={pc} bg={pb}>{task.priority}</Tag>
                          <Tag color={sc} bg={sc+"15"}>{status}</Tag>
                          {task.type && <Tag color={ttC[task.type]||T.dim} bg={(ttC[task.type]||T.dim)+"15"}>{task.type}</Tag>}
                          {task.source && <SrcTag source={task.source} />}
                          {task.owner && <span style={{ fontSize:11, color:T.muted, ...M }}>👤 {task.owner}</span>}
                          {task.due && task.due !== "—" && <span style={{ fontSize:11, color:T.muted, ...M }}>📅 {task.due}</span>}
                        </div>
                        {task.priority_reason && <Note>// {task.priority_reason}</Note>}
                      </div>
                      <button onClick={() => cycleStatus(task.id, status)} style={{ fontSize:11, padding:"4px 10px",
                        border:`1px solid ${T.border}`, borderRadius:3, background:"transparent",
                        color:T.muted, flexShrink:0, whiteSpace:"nowrap", ...M }}>{nxtLabel}</button>
                    </div>
                  </Blk>
                );
              })
          }
        </div>
      )}

      {/* ── Schedule ── */}
      {tab === "schedule" && (
        <div>
          <Lbl>today {dateStr} · IST</Lbl>
          {(schedule || []).map((b, i) => {
            const [h, m]   = (b.time || "0:0").split(":").map(Number);
            const start    = new Date(); start.setHours(h, m, 0, 0);
            const next     = schedule[i + 1];
            const [nh, nm] = next ? (next.time || "0:0").split(":").map(Number) : [h+1, 0];
            const end      = new Date(); end.setHours(nh, nm, 0, 0);
            const isNow    = now >= start && now < end;
            const isPast   = now >= end;
            return (
              <div key={i} style={{ display:"flex", gap:12, alignItems:"flex-start",
                padding:isNow?"10px":"10px 0", marginBottom:2,
                borderBottom:`1px solid ${T.border}44`, opacity:isPast?0.4:1,
                background:isNow?T.green+"0a":"transparent",
                borderRadius:isNow?"6px":"0", transition:"all .2s" }}>
                <div style={{ width:52, flexShrink:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:isNow?T.green:isPast?T.dim:T.cyan, ...M }}>{b.time}</div>
                  {isNow && <div style={{ fontSize:9, color:T.green, letterSpacing:".1em", marginTop:2, ...M }}>NOW</div>}
                </div>
                <div style={{ width:28, height:28, borderRadius:4,
                  background:(tyC[b.type]||T.dim)+(isNow?"33":"18"),
                  display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <i className={`ti ${tyI[b.type]||"ti-clock"}`} style={{ fontSize:14, color:tyC[b.type]||T.dim }} />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:600, color:isNow?T.bright:isPast?T.muted:T.text, lineHeight:1.3, marginBottom:4 }}>{b.block}</div>
                  {b.notes && <div style={{ fontSize:12, color:isNow?T.muted:T.dim, lineHeight:1.6, ...M }}>{b.notes}</div>}
                </div>
                <Tag color={tyC[b.type]||T.dim}>{(b.type||"").replace("_"," ")}</Tag>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop:16, paddingTop:10, borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:10, color:T.dim, ...M }}>
          FRIDAY v1.0 · {lastSaved ? `synced ${lastSaved.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}` : ""}
        </span>
        <span style={{ display:"flex", gap:12, alignItems:"center" }}>
          {usage && (
            <span title={`Today's real Claude usage (from your subscription).\n${usage.calls} call${usage.calls===1?"":"s"} · ${usage.tokens.toLocaleString()} tokens · ~$${usage.cost.toFixed(2)} equiv.\nAuto-briefings: ${usage.autoGens}/${usage.autoCap} (cap). ~15.6k tokens/call is fixed Claude Code overhead.`}
              style={{ fontSize:10, display:"inline-flex", alignItems:"center", gap:4, ...M,
                color: usage.cost > 3 ? T.red : usage.cost > 1 ? T.amber : T.green }}>
              <i className="ti ti-bolt" style={{ fontSize:12 }} />
              {usage.calls} · {usage.tokens >= 1000 ? (usage.tokens/1000).toFixed(0)+"k" : usage.tokens} tok · ${usage.cost.toFixed(2)}
              <span style={{ color:T.dim }}>· {usage.autoGens}/{usage.autoCap}</span>
            </span>
          )}
          <button onClick={() => setShowDirectives(true)} title="Standing priorities FRIDAY always keeps in mind"
            style={{ fontSize:10, color:T.amber, background:"transparent", border:"none", display:"inline-flex", alignItems:"center", gap:4, ...M }}>
            <i className="ti ti-flag" style={{ fontSize:12 }} />{directives.length} priorities
          </button>
          {memStats?.total > 0 && (
            <button onClick={() => profile && setShowProfile(true)} title={profile ? "View learned profile" : "Items FRIDAY has learned"}
              style={{ fontSize:10, color:T.purple, background:"transparent", border:"none", display:"inline-flex", alignItems:"center", gap:4, cursor:profile?"pointer":"default", ...M }}>
              <i className="ti ti-brain" style={{ fontSize:12 }} />{memStats.total} learned{profile ? " · profile" : ""}
            </button>
          )}
          {conns.some(c => c.provider === "google" && c.connected) && (
            <button onClick={openMemorySheet} title="Open FRIDAY's memory in Google Sheets"
              style={{ fontSize:10, color:T.green, background:"transparent", border:"none", display:"inline-flex", alignItems:"center", gap:4, ...M }}>
              <i className="ti ti-table" style={{ fontSize:12 }} />memory sheet ↗
            </button>
          )}
          <span style={{ fontSize:10, color:T.dim, ...M }}>⌘K · type / for commands</span>
        </span>
      </div>

      {/* Priorities / directives modal */}
      {showDirectives && (
        <div onClick={() => setShowDirectives(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)",
          zIndex:400, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:T.panel, border:`1px solid ${T.amber}55`, borderRadius:10,
            maxWidth:640, width:"100%", maxHeight:"80vh", overflowY:"auto", padding:"20px 24px", boxShadow:"0 24px 48px rgba(0,0,0,.7)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <span style={{ fontSize:13, fontWeight:700, color:T.amber, letterSpacing:".1em", ...M }}>
                <i className="ti ti-flag" style={{ marginRight:6 }} />STANDING PRIORITIES
              </span>
              <button onClick={() => setShowDirectives(false)} style={{ background:"transparent", border:"none", color:T.dim, fontSize:16 }}>
                <i className="ti ti-x" />
              </button>
            </div>
            <div style={{ fontSize:11, color:T.dim, marginBottom:14, lineHeight:1.6, ...M }}>
              Things FRIDAY always keeps in mind — they shape every briefing and answer. Add anything you want it to never forget.
            </div>
            <div style={{ display:"flex", gap:6, marginBottom:14 }}>
              <input value={newDirective} onChange={e => setNewDirective(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addDirective()}
                placeholder="e.g. Always prioritise Program Master accuracy..."
                style={{ flex:1 }} />
              <button onClick={addDirective} style={{ padding:"8px 16px", background:T.amber, border:"none", borderRadius:4, color:T.bg, fontWeight:700, fontSize:12, ...M }}>add</button>
            </div>
            {directives.length === 0
              ? <Note>// no standing priorities yet</Note>
              : directives.map(d => (
                <div key={d.id} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"9px 0", borderBottom:`1px solid ${T.border}44` }}>
                  <span style={{ color:T.amber, fontSize:13, flexShrink:0, marginTop:1 }}>⚑</span>
                  <span style={{ fontSize:12.5, color:T.text, lineHeight:1.6, flex:1, ...M }}>{d.text}</span>
                  <button onClick={() => removeDirective(d.id)} title="Remove"
                    style={{ background:"transparent", border:"none", color:T.dim, fontSize:13, flexShrink:0 }}>
                    <i className="ti ti-trash" />
                  </button>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* Profile modal */}
      {showProfile && profile && (
        <div onClick={() => setShowProfile(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)",
          zIndex:400, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:T.panel, border:`1px solid ${T.purple}55`, borderRadius:10,
            maxWidth:640, width:"100%", maxHeight:"80vh", overflowY:"auto", padding:"20px 24px", boxShadow:"0 24px 48px rgba(0,0,0,.7)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <span style={{ fontSize:13, fontWeight:700, color:T.purple, letterSpacing:".1em", ...M }}>
                <i className="ti ti-brain" style={{ marginRight:6 }} />LEARNED PROFILE
              </span>
              <button onClick={() => setShowProfile(false)} style={{ background:"transparent", border:"none", color:T.dim, fontSize:16 }}>
                <i className="ti ti-x" />
              </button>
            </div>
            <pre style={{ fontSize:12.5, color:T.text, lineHeight:1.7, whiteSpace:"pre-wrap", fontFamily:mono }}>{profile}</pre>
            <div style={{ fontSize:10, color:T.dim, marginTop:14, ...M }}>
              synthesized from {memStats?.total || 0} items · {Object.entries(memStats?.bySource||{}).map(([k,v])=>`${v} ${k}`).join(" · ")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
