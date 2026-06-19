import { useState, useEffect, useCallback, useRef } from "react";
import * as api from "./api";
import TeamManagement from "./TeamManagement";

// ── Theme ──────────────────────────────────────────────────────
// Monochrome + red. Two hex palettes (light/dark) swapped at runtime — kept as real
// hex (not CSS vars) so the pervasive `color + "alpha"` pattern still works.
// In monochrome every former hue collapses to a neutral ink tone; red is the ONLY
// color, reserved for genuine urgency. "green" now plays the role of the ink accent.
const palettes = {
  dark: {
    bg:"#0c0d10", panel:"#131519", card:"#15171b", cardHi:"#1c1f25", border:"#23262c", borderB:"#31353d",
    text:"#9aa0a8", dim:"#666b73", muted:"#9aa0a8", bright:"#e9ebee",
    green:"#e9ebee", greenD:"#e9ebee12",
    blue:"#9aa0a8",  blueD:"#9aa0a812",
    amber:"#c4c9cf", amberD:"#c4c9cf12",
    red:"#f0616d",   redD:"#f0616d20",
    ok:"#3fcf87",
    purple:"#9aa0a8",purpleD:"#9aa0a812",
    cyan:"#9aa0a8",  cyanD:"#9aa0a812",
    slack:"#a594c9", slackD:"#a594c918",
    gmail:"#d08a6f", gmailD:"#d08a6f18",
    cal:"#7fa3c4",   calD:"#7fa3c418",
  },
  light: {
    bg:"#fcfcfb", panel:"#ffffff", card:"#ffffff", cardHi:"#f4f4f2", border:"#eae9e4", borderB:"#dad8d2",
    text:"#585d64", dim:"#9499a0", muted:"#585d64", bright:"#18181b",
    green:"#18181b", greenD:"#18181b0a",
    blue:"#585d64",  blueD:"#585d640a",
    amber:"#3a3d42", amberD:"#3a3d420a",
    red:"#d63a4a",   redD:"#d63a4a14",
    ok:"#1a9e5f",
    purple:"#585d64",purpleD:"#585d640a",
    cyan:"#585d64",  cyanD:"#585d640a",
    slack:"#8338b8", slackD:"#8338b814",
    gmail:"#c2410c", gmailD:"#c2410c14",
    cal:"#2b6cb0",   calD:"#2b6cb014",
  },
};
let T = palettes.dark;

// Maps that derive from the palette — rebuilt whenever the theme flips.
let srcStyle, urgC, prioC, stC, ttC, tyC;
const buildMaps = () => {
  srcStyle = {
    gmail:    { color:T.gmail, bg:T.gmailD, icon:"ti-mail",         label:"gmail"  },
    slack:    { color:T.slack, bg:T.slackD, icon:"ti-brand-slack",  label:"slack"  },
    calendar: { color:T.cal,   bg:T.calD,   icon:"ti-calendar",     label:"cal"    },
    manual:   { color:T.muted, bg:T.cardHi, icon:"ti-pencil",       label:"manual" },
  };
  urgC  = { high:T.red, medium:T.muted, low:T.dim };
  prioC = { P1:[T.red,T.redD], P2:[T.bright,T.cardHi], P3:[T.muted,T.cardHi], P4:[T.dim,T.cardHi] };
  stC   = { "Not Started":T.dim, "In Progress":T.muted, "Waiting on Others":T.muted, "Completed":T.bright };
  ttC   = { decision:T.muted, action:T.muted, delegate:T.muted, followup:T.muted, people:T.muted };
  tyC   = { deep_work:T.muted, meeting:T.cal, followup:T.muted, comms:T.gmail, buffer:T.dim, strategic:T.muted };
};
buildMaps();
const setPalette = (mode) => { T = palettes[mode] || palettes.dark; buildMaps(); };

// Priority of an important (Slack/Gmail) item — use the AI's explicit P1–P4 if present,
// else derive it from urgency. Lets us rank the "Needs you" feed and drive urgency.
const prioRank = { P1:0, P2:1, P3:2, P4:3 };
const prioOf   = (u={}) => /^P[1-4]$/.test(u.priority||"") ? u.priority : (u.urgency==="high"?"P1":u.urgency==="low"?"P3":"P2");
const tyI   = { deep_work:"ti-brain", meeting:"ti-calendar-event", followup:"ti-arrow-back", comms:"ti-mail", buffer:"ti-clock", strategic:"ti-telescope" };

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
  { cmd:"/feedback",    desc:"Log an idea or fix for FRIDAY — collated for later (no AI call)" },
];

const sans = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const mono = "'JetBrains Mono', ui-monospace, monospace";
const M    = { fontFamily: sans };          // body default — reads like a product
const MONO = { fontFamily: mono };          // data: numbers, times, small labels

const makeCss = (T) => `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
@import url('https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css');
* { box-sizing: border-box; margin: 0; padding: 0 }
body, #root { background: ${T.bg}; min-height: 100vh; font-family: ${sans};
  -webkit-font-smoothing: antialiased; color: ${T.text}; letter-spacing: -0.01em;
  transition: background .2s ease, color .2s ease; }
::-webkit-scrollbar { width: 7px; height: 7px }
::-webkit-scrollbar-track { background: transparent }
::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 4px }
::-webkit-scrollbar-thumb:hover { background: ${T.borderB} }
input, select, textarea {
  background: ${T.bg}; color: ${T.bright};
  border: 1px solid ${T.border}; border-radius: 8px;
  padding: 10px 13px; font-size: 13.5px;
  font-family: ${sans}; outline: none; transition: border .15s, box-shadow .15s;
}
input::placeholder { color: ${T.dim} }
input:focus, select:focus, textarea:focus { border-color: ${T.bright}; box-shadow: 0 0 0 3px ${T.bright}1a }
button { cursor: pointer; font-family: ${sans} }
a { color: ${T.bright}; text-decoration: none }
a:hover { opacity: .7 }
@keyframes spin    { from { transform: rotate(0)   } to { transform: rotate(360deg) } }
@keyframes blink   { 0%,100% { opacity:1 } 50% { opacity:0 } }
@keyframes fadeIn  { from { opacity:0; transform:translateY(-6px) } to { opacity:1; transform:translateY(0) } }
@keyframes rise    { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
.spin   { animation: spin 1s linear infinite }
.blink  { animation: blink 1.1s step-end infinite }
.fadeIn { animation: fadeIn .14s ease }
.rise   { animation: rise .22s cubic-bezier(.2,.7,.3,1) both }
.hovcard { transition: background .14s, border-color .14s, transform .14s }
.hovcard:hover { background: ${T.cardHi}; border-color: ${T.borderB} }
.hovrow { transition: background .12s }
.hovrow:hover { background: ${T.cardHi}80 }
@keyframes urgpulse { 0%,100% { box-shadow: 0 0 0 0 ${T.red}00 } 50% { box-shadow: 0 0 0 5px ${T.red}26 } }
.urgpulse { animation: urgpulse 1.4s ease-in-out infinite }
`;

// ── Small components ───────────────────────────────────────────
const Tag     = ({ children, color=T.muted, bg }) => (
  <span style={{ fontSize:10.5, fontWeight:600, padding:"2px 8px", borderRadius:20,
    color, background:bg||color+"1f", letterSpacing:".01em", whiteSpace:"nowrap", ...M }}>{children}</span>
);
const SrcTag  = ({ source }) => {
  const s = srcStyle[source] || srcStyle.manual;
  return (
    <span style={{ fontSize:10.5, fontWeight:600, padding:"2px 8px", borderRadius:20,
      color:s.color, background:s.color+"18",
      display:"inline-flex", alignItems:"center", gap:4, ...M }}>
      <i className={`ti ${s.icon}`} style={{ fontSize:11 }} />{s.label}
    </span>
  );
};
const Blk     = ({ children, style={}, accent }) => (
  <div className="hovcard" style={{ background:T.card, border:`1px solid ${T.border}`,
    borderLeft:accent?`2.5px solid ${accent}`:`1px solid ${T.border}`,
    borderRadius:10, padding:"13px 16px", marginBottom:8, ...style }}>{children}</div>
);
const Lbl     = ({ children, right }) => (
  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", margin:"4px 0 11px" }}>
    <span style={{ fontSize:11, fontWeight:600, color:T.muted, letterSpacing:".14em",
      textTransform:"uppercase", ...MONO }}>{children}</span>
    {right}
  </div>
);
const Note    = ({ children }) => (
  <div style={{ fontSize:12.5, color:T.dim, marginTop:5, lineHeight:1.6, ...M }}>{children}</div>
);
const SlackLnk = ({ url }) => url ? (
  <a href={url} target="_blank" rel="noopener noreferrer"
    style={{ fontSize:11.5, color:T.slack, display:"inline-flex", alignItems:"center", gap:4, marginTop:8, fontWeight:500, ...M }}>
    <i className="ti ti-brand-slack" style={{ fontSize:13 }} />open in Slack <i className="ti ti-arrow-up-right" style={{ fontSize:12 }} />
  </a>
) : null;
const MailLnk = ({ url }) => url ? (
  <a href={url} target="_blank" rel="noopener noreferrer"
    style={{ fontSize:11.5, color:T.gmail, display:"inline-flex", alignItems:"center", gap:4, marginTop:8, fontWeight:500, ...M }}>
    <i className="ti ti-mail" style={{ fontSize:13 }} />open in Gmail <i className="ti ti-arrow-up-right" style={{ fontSize:12 }} />
  </a>
) : null;
const Cursor  = () => (
  <span className="blink" style={{ display:"inline-block", width:6, height:15, borderRadius:1,
    background:T.green, marginLeft:3, verticalAlign:"-2px" }} />
);
// A framed dashboard panel with a header (title, icon, optional count + action).
const Panel = ({ title, icon, accent=T.muted, count, action, children, bodyStyle={}, style={} }) => (
  <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"15px 17px", ...style }}>
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:13 }}>
      {icon && <i className={`ti ${icon}`} style={{ fontSize:15, color:accent }} />}
      <span style={{ fontSize:11.5, fontWeight:600, color:T.muted, letterSpacing:".11em", textTransform:"uppercase", ...MONO }}>{title}</span>
      {count != null && count !== 0 && (
        <span style={{ fontSize:10.5, fontWeight:700, color:accent, background:accent+"22", borderRadius:20, padding:"1px 8px", ...MONO }}>{count}</span>
      )}
      <span style={{ flex:1 }} />
      {action}
    </div>
    <div style={bodyStyle}>{children}</div>
  </div>
);
// Small circular focus/productivity score.
const FocusScore = ({ score }) => {
  const c = score >= 70 ? T.green : score >= 40 ? T.amber : T.red;
  const r = 17, circ = 2 * Math.PI * r;
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:9, background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"6px 13px 6px 8px" }}>
      <svg width="42" height="42" style={{ transform:"rotate(-90deg)" }}>
        <circle cx="21" cy="21" r={r} fill="none" stroke={T.border} strokeWidth="4" />
        <circle cx="21" cy="21" r={r} fill="none" stroke={c} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - score / 100)} style={{ transition:"stroke-dashoffset .6s ease" }} />
      </svg>
      <div style={{ lineHeight:1.1 }}>
        <div style={{ fontSize:16, fontWeight:700, color:T.bright, ...MONO }}>{score}<span style={{ fontSize:10, color:T.dim }}>%</span></div>
        <div style={{ fontSize:9.5, color:T.dim, letterSpacing:".06em", textTransform:"uppercase", ...MONO }}>focus</div>
      </div>
    </div>
  );
};

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
    <div style={{ display:"flex", gap:7, flexWrap:"wrap", marginBottom:14 }}>
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
            style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:11.5, padding:"5px 11px", fontWeight:500,
              border:`1px solid ${connected ? T.border : T.borderB}`, borderRadius:20,
              background:connected ? T.card : "transparent", color:connected ? T.text : T.muted, ...M }}>
            <span style={{ width:6, height:6, borderRadius:"50%", background:connected?c:T.dim,
              boxShadow:connected?`0 0 6px ${c}99`:"none" }} />
            {s.label}
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
  const [view,     setView]     = useState("cockpit");   // "cockpit" | "team"
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
  const [correcting, setCorrecting] = useState(null);   // which flag key is being corrected
  const [correctText, setCorrectText] = useState("");
  const [corrected,  setCorrected]  = useState({});     // flag key -> reported
  const [copied,   setCopied]   = useState(null);   // which prepared draft was just copied
  const [learnOpen, setLearnOpen] = useState(false);
  const [learnRead, setLearnRead] = useState(() => { try { return localStorage.getItem("friday_learn_read"); } catch { return null; } });
  const [rightTab, setRightTab] = useState("loops");   // which right-panel section is shown
  const [showAll,  setShowAll]  = useState({});         // per-section "expanded" flag
  const [feedback, setFeedback] = useState([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [newFeedback, setNewFeedback] = useState("");
  const [banner,   setBanner]   = useState(null);
  const [sheetUrl, setSheetUrl] = useState(null);
  const [memStats, setMemStats] = useState(null);
  const [profile,  setProfile]  = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [directives, setDirectives] = useState([]);
  const [showDirectives, setShowDirectives] = useState(false);
  const [newDirective, setNewDirective] = useState("");
  const [clock,    setClock]    = useState(Date.now());  // ticks the urgency countdown
  const [theme,    setTheme]    = useState(() => { try { return localStorage.getItem("friday_theme") || "light"; } catch { return "light"; } });
  const chatEndRef = useRef(null);
  const inputRef   = useRef(null);

  // Apply the active palette on every render (idempotent) so T + maps match the theme
  // before any child component reads them.
  setPalette(theme);
  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");
  useEffect(() => { try { localStorage.setItem("friday_theme", theme); } catch {} }, [theme]);

  // Editorial section-header tokens (kicker + count over a hairline) — derived from the
  // live palette so they flip with the theme.
  const SH  = { display:"flex", alignItems:"baseline", gap:10, marginBottom:16, paddingBottom:11, borderBottom:`1px solid ${T.border}` };
  const SHk = { fontSize:11, fontWeight:700, color:T.bright, letterSpacing:".15em", textTransform:"uppercase", ...MONO };
  const SHc = { fontSize:11, color:T.dim, ...MONO };

  // Copy a prepared draft to the clipboard (the "approve" step is the user sending it).
  const copyDraft = (key, text) => {
    try { navigator.clipboard?.writeText(text); } catch {}
    setCopied(key);
    setTimeout(() => setCopied(c => (c === key ? null : c)), 1600);
  };

  useEffect(() => { init(); }, []);

  // Urgency engine: re-tick every 20s so the "next hard edge" countdown stays live.
  useEffect(() => { const id = setInterval(() => setClock(Date.now()), 20000); return () => clearInterval(id); }, []);

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
    try { const fb = await api.getFeedback(); setFeedback(fb.feedback || []); } catch {}
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
  const sendCorrection = async (key, u) => {
    if (!correctText.trim()) return;
    try { await api.addCorrection(u.title || "", correctText.trim()); } catch {}
    setCorrected(c => ({ ...c, [key]: true }));
    setCorrecting(null); setCorrectText("");
  };

  const openLearn = () => {
    setLearnOpen(o => !o);
    const arr = Array.isArray(data?.learn) ? data.learn : (data?.learn?.title ? [data.learn] : []);
    const t = arr.map(l => l.title).join("|");
    if (t) { try { localStorage.setItem("friday_learn_read", t); } catch {} setLearnRead(t); }
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

    // /feedback — capture a product idea/fix. Stored locally, no AI call (free).
    if (/^\/feedback\b/i.test(msg)) {
      const text = msg.replace(/^\/feedback\b/i, "").trim();
      setChatInput(""); setSlashRes([]);
      setChatHist(h => [...h, { role: "user", content: msg }]);
      if (!text) {
        setChatHist(h => [...h, { role: "assistant", content: "Add your note after /feedback — e.g. `/feedback let me reorder the schedule blocks`." }]);
        return;
      }
      try {
        const r = await api.addFeedback(text);
        setFeedback(r.feedback || []);
        setChatHist(h => [...h, { role: "assistant", content: `Logged ✓ — that's ${(r.feedback || []).length} idea${(r.feedback||[]).length===1?"":"s"} collated. See the full list from the "feedback" link in the footer.` }]);
      } catch {
        setChatHist(h => [...h, { role: "assistant", content: "couldn't save that — server unreachable." }]);
      }
      return;
    }

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
      <style>{makeCss(T)}</style>
      <div style={{ textAlign:"center", ...M }}>
        <div style={{ width:46, height:46, borderRadius:13, margin:"0 auto 16px", background:`linear-gradient(135deg, ${T.green}, ${T.cyan})`,
          display:"flex", alignItems:"center", justifyContent:"center", boxShadow:`0 8px 30px ${T.green}44` }}>
          <span style={{ fontSize:24, fontWeight:800, color:T.bg }}>F</span>
        </div>
        <div style={{ fontSize:20, fontWeight:700, color:T.bright, letterSpacing:".04em" }}>FRIDAY</div>
        <div style={{ fontSize:11.5, color:T.muted, marginTop:6 }}>Focused Realtime Intelligence for Daily Accountability &amp; Yield</div>
        <div style={{ fontSize:12, color:T.dim, marginTop:18 }}>initializing<span className="blink">_</span></div>
      </div>
    </div>
  );

  if (!data) return (
    <div style={{ background:T.bg, minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <style>{makeCss(T)}</style>
      <div style={{ textAlign:"center", ...M, maxWidth:460, width:"100%" }}>
        <div style={{ width:46, height:46, borderRadius:13, margin:"0 auto 16px", background:`linear-gradient(135deg, ${T.green}, ${T.cyan})`,
          display:"flex", alignItems:"center", justifyContent:"center", boxShadow:`0 8px 30px ${T.green}44` }}>
          <span style={{ fontSize:24, fontWeight:800, color:T.bg }}>F</span>
        </div>
        <div style={{ fontSize:20, fontWeight:700, color:T.bright, letterSpacing:".04em", marginBottom:6 }}>FRIDAY</div>
        <div style={{ fontSize:12, color:T.muted, marginBottom:24 }}>Connect your sources to generate your first briefing.</div>
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
  const lessons = Array.isArray(learn) ? learn : (learn && learn.title ? [learn] : []);
  const lessonsKey = lessons.map(l => l.title).join("|");
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
  // Focus score = how CLEAR you are. 100 when nothing's on you; each open Slack tag
  // or captured item lowers it, and clearing them pushes it back up. Email is excluded
  // (low-signal by design) so it never unfairly tanks the score. Meant to motivate.
  const focusScore = loops ? Math.max(8, Math.min(100, 100 - (sOpen + mOpen) * 9)) : null;
  const now   = new Date(clock);
  const timeStr = now.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:false });
  const dateStr = now.toLocaleDateString("en-IN", { weekday:"short", day:"2-digit", month:"short" });

  // ── Urgency engine (aggressive, work-hours) — all client-side, zero Claude tokens ──
  // What needs you NOW is driven by Slack/Gmail importance (priority-ranked), not the
  // calendar. The next meeting is kept only as a secondary time cue (a real hard stop).
  const atToday = (t) => { const [h,m] = (t||"0:0").split(":").map(Number); const d = new Date(clock); d.setHours(h, m, 0, 0); return d; };
  // Priority-ranked important items (Slack/Gmail) — this is the headline of the bar + card.
  const importantItems = (briefing?.critical_updates || [])
    .map(u => ({ ...u, prio: prioOf(u) }))
    .sort((a, b) => prioRank[a.prio] - prioRank[b.prio]);
  const topItem = importantItems[0] || null;
  // Next real calendar hard stop (secondary time cue).
  const edges = (schedule || [])
    .filter(b => b.type === "meeting" && b.time)
    .map(b => ({ label: b.block, at: atToday(b.time) }))
    .filter(e => e.at > now).sort((a, b) => a.at - b.at);
  const nextEdge = edges[0] || null;
  const edgeMins = nextEdge ? Math.max(0, Math.round((nextEdge.at - now) / 60000)) : null;
  const fmtLeft  = (m) => m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`;
  const edgeAt   = nextEdge ? nextEdge.at.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:false }) : null;
  // Heat = priority of the top item (what actually needs you), escalated if a meeting is imminent.
  const heat = topItem ? (prioC[topItem.prio]?.[0] || T.amber)
    : edgeMins == null ? T.dim : edgeMins <= 30 ? T.red : edgeMins <= 60 ? T.amber : T.green;
  const hot  = (topItem?.prio === "P1") || (edgeMins != null && edgeMins <= 15);  // pulse + "now" framing
  const offHours = now.getHours() >= 21 || now.getHours() < 10;  // engine live 10:00–21:00 (work edges only)

  // A "+ show all (N)" / "show less" toggle for a capped section.
  const Expander = ({ k, total, cap }) => total > cap ? (
    <button onClick={() => setShowAll(s => ({ ...s, [k]: !s[k] }))}
      style={{ fontSize:11.5, color:T.muted, background:"transparent", border:`1px solid ${T.border}`,
        borderRadius:8, padding:"6px 11px", marginTop:6, display:"inline-flex", alignItems:"center", gap:5, ...M }}>
      <i className={`ti ti-chevron-${showAll[k]?"up":"down"}`} style={{ fontSize:13 }} />
      {showAll[k] ? "show less" : `show all (${total})`}
    </button>
  ) : null;

  // Today's schedule — auto-anchored to NOW: completed blocks collapse into a header,
  // the current/next block sits at the top, and upcoming blocks are capped (expand for the rest).
  const renderSchedule = () => {
    const all = schedule || [];
    if (!all.length) return <Note>no schedule yet — hit sync</Note>;
    const rows = all.map((b, i) => {
      const [h, m]   = (b.time || "0:0").split(":").map(Number);
      const start    = new Date(clock); start.setHours(h, m, 0, 0);
      const next     = all[i + 1];
      const [nh, nm] = next ? (next.time || "0:0").split(":").map(Number) : [h+1, 0];
      const end      = new Date(clock); end.setHours(nh, nm, 0, 0);
      return { b, isNow: now >= start && now < end, isPast: now >= end };
    });
    const activeIdx = rows.findIndex(r => !r.isPast);
    const anchor    = activeIdx === -1 ? Math.max(0, rows.length - 3) : activeIdx;  // current/next, or tail if day's done
    const past      = rows.slice(0, anchor);
    const fromNow   = rows.slice(anchor);
    const upShown   = showAll.today ? fromNow : fromNow.slice(0, 7);
    const showPast  = !!showAll.todayPast;
    const rendered  = (showPast ? past : []).concat(upShown);
    return (
      <div style={{ position:"relative" }}>
        {past.length > 0 && (
          <button onClick={() => setShowAll(s => ({ ...s, todayPast: !s.todayPast }))}
            style={{ fontSize:11.5, color:T.dim, background:"transparent", border:`1px solid ${T.border}`,
              borderRadius:8, padding:"6px 11px", marginBottom:10, display:"inline-flex", alignItems:"center", gap:6, ...M }}>
            <i className={`ti ti-chevron-${showPast?"up":"down"}`} style={{ fontSize:13 }} />
            <i className="ti ti-circle-check" style={{ fontSize:13, color:T.green }} />
            {showPast ? "hide earlier" : `${past.length} earlier ${past.length===1?"block":"blocks"} done`}
          </button>
        )}
        {rendered.map((r, i) => {
          const b = r.b, isNow = r.isNow, isPast = r.isPast;
          const c = tyC[b.type] || T.muted;
          return (
            <div key={i} style={{ display:"flex", gap:11, alignItems:"stretch", opacity:isPast?0.4:1 }}>
              <div style={{ width:38, flexShrink:0, textAlign:"right", paddingTop:11 }}>
                <div style={{ fontSize:11.5, fontWeight:600, color:isNow?T.green:T.muted, ...MONO }}>{b.time}</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
                <div style={{ width:26, height:26, borderRadius:8, marginTop:8, background:isNow?c:T.bg,
                  border:`1px solid ${isNow?c:T.border}`, display:"flex", alignItems:"center", justifyContent:"center",
                  boxShadow:isNow?`0 0 0 4px ${c}22`:"none", zIndex:1 }}>
                  <i className={`ti ${tyI[b.type]||"ti-clock"}`} style={{ fontSize:13, color:isNow?T.bg:c }} />
                </div>
                {i < rendered.length-1 && <div style={{ width:1.5, flex:1, background:T.border, minHeight:12 }} />}
              </div>
              <div style={{ flex:1, minWidth:0, marginBottom:7, paddingTop:9 }}>
                <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                  <span style={{ flex:1, fontSize:13, fontWeight:600, color:isNow?T.bright:T.text, lineHeight:1.3 }}>{b.block}</span>
                  {isNow && <span style={{ fontSize:9, fontWeight:700, color:T.bg, background:T.green, padding:"1px 6px", borderRadius:20, ...MONO }}>NOW</span>}
                </div>
                {b.notes && <div style={{ fontSize:11.5, color:T.dim, lineHeight:1.5, marginTop:2 }}>{b.notes}</div>}
              </div>
            </div>
          );
        })}
        {activeIdx === -1 && <Note>day's done ✓ — set tomorrow up</Note>}
        <Expander k="today" total={fromNow.length} cap={7} />
      </div>
    );
  };

  // Open loops — capture box + manual + Slack + email, each capped (expand for all).
  const renderLoops = () => {
    const exp = !!showAll.loops;
    const sl = exp ? slackOpen : slackOpen.slice(0, 6);
    const em = exp ? emailOpen : emailOpen.slice(0, 6);
    const moreThanCap = slackOpen.length > 6 || emailOpen.length > 6;
    const colHead = (icon, label, count, color, extra) => (
      <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:11 }}>
        <i className={`ti ${icon}`} style={{ fontSize:13, color }} />
        <span style={{ fontSize:10.5, fontWeight:700, color, letterSpacing:".12em", ...MONO }}>{label}</span>
        <span style={{ fontSize:10.5, color:T.dim, ...MONO }}>{count}</span>
        {extra}
      </div>
    );
    return (
      <>
        <div style={{ display:"flex", gap:8, marginBottom:16 }}>
          <input value={newLoop} onChange={e => setNewLoop(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addLoop()}
            placeholder="jot something on you — Program Master update, call vendor…" style={{ flex:1 }} />
          <button onClick={addLoop} style={{ padding:"9px 16px", background:T.bright, border:"none", borderRadius:8, color:T.bg, fontWeight:600, fontSize:12.5, ...M }}>add</button>
        </div>
        {loops?.errors?.google && (
          <div onClick={() => doConnect("google")} title="Reconnect Google"
            style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontSize:12,
              color:T.red, background:T.redD, border:`1px solid ${T.red}44`, borderRadius:8, padding:"9px 12px", marginBottom:14, ...M }}>
            <i className="ti ti-mail-off" style={{ fontSize:14, flexShrink:0 }} />
            <span style={{ flex:1 }}>Google sign-in expired — email loops paused. <b style={{ fontWeight:600, textDecoration:"underline" }}>Reconnect</b></span>
          </div>
        )}
        {!loops ? <Note>detecting open loops…</Note> : (sOpen + eOpen + mOpen === 0 && !loops?.errors?.google) ? (
          <div style={{ textAlign:"center", padding:"34px 0", color:T.dim }}>
            <i className="ti ti-circle-check" style={{ fontSize:28, color:T.ok, marginBottom:8, display:"block" }} />
            <div style={{ fontSize:13.5, color:T.ok }}>All caught up</div>
            <div style={{ fontSize:12, color:T.dim, marginTop:3 }}>nothing's waiting on a reply from you</div>
          </div>
        ) : (
          <>
            {/* Captured — full width */}
            {manualOpen.length > 0 && (
              <div style={{ marginBottom:20 }}>
                {colHead("ti-pin", "CAPTURED", mOpen, T.muted)}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))", gap:"8px 14px" }}>
                  {manualOpen.map(m => (
                    <div key={m.id} className="hovcard" style={{ display:"flex", gap:10, alignItems:"center", background:T.card,
                      border:`1px solid ${T.border}`, borderLeft:`3px solid ${T.borderB}`, borderRadius:10, padding:"10px 12px" }}>
                      <button onClick={() => doneLoop(m.id)} title="Mark done"
                        style={{ width:18, height:18, borderRadius:6, border:`1.5px solid ${T.borderB}`, background:"transparent",
                          display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:T.ok, fontSize:11 }}>✓</button>
                      <span style={{ flex:1, fontSize:12.5, color:T.text, lineHeight:1.45 }}>{m.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Slack | Email — two columns */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))", gap:"6px 34px", alignItems:"start" }}>
              {slackOpen.length > 0 && (
                <div style={{ minWidth:0 }}>
                  {colHead("ti-brand-slack", "SLACK", sOpen, T.slack)}
                  {sl.map((m, i) => (
                    <a key={m.id || i} href={m.slack_url} target="_blank" rel="noopener noreferrer" style={{ display:"block", textDecoration:"none" }}>
                      <div className="hovcard" style={{ background:T.card, border:`1px solid ${T.border}`, borderLeft:`3px solid ${T.slack}`, borderRadius:10, padding:"10px 13px", marginBottom:7 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginBottom:3 }}>
                          <span style={{ fontSize:11.5, color:T.slack, fontWeight:600 }}>#{m.channel}</span>
                          <span style={{ fontSize:10, fontWeight:m.ageHours>=24?700:400, color:m.ageHours>=24?T.red:T.dim, ...MONO }}>{m.ageHours>=24 ? `${Math.floor(m.ageHours/24)}d` : `${m.ageHours}h`}</span>
                        </div>
                        <div style={{ fontSize:12.5, color:T.text, lineHeight:1.5 }}>
                          <span style={{ color:T.muted }}>@{m.user}: </span>
                          {(m.text || "").replace(/<@[A-Z0-9]+\|([^>]+)>/g, "@$1").replace(/\s+/g," ").slice(0, 130)}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
              {emailOpen.length > 0 && (
                <div style={{ minWidth:0 }}>
                  {colHead("ti-mail", "EMAIL · TO YOU", `${eOpen}${loops?.summary?.emailUnread ? ` · ${loops.summary.emailUnread} unread` : ""}`, T.gmail,
                    loops?.summary?.emailCcFyi > 0 ? <span title="You're only Cc'd on these — FYI" style={{ marginLeft:"auto", fontSize:10, color:T.dim, ...MONO }}>{loops.summary.emailCcFyi} cc'd · set aside</span> : null)}
                  {em.map((t, i) => (
                    <a key={t.id || i} href={t.gmail_url || undefined} target={t.gmail_url ? "_blank" : undefined} rel="noopener noreferrer"
                      title={t.gmail_url ? "open in Gmail" : undefined}
                      style={{ display:"block", textDecoration:"none", cursor:t.gmail_url ? "pointer" : "default" }}>
                      <div className="hovcard" style={{ background:T.card, border:`1px solid ${T.border}`, borderLeft:`3px solid ${T.gmail}`, borderRadius:10, padding:"10px 13px", marginBottom:7, opacity:t.unread?1:0.7 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginBottom:2 }}>
                          <span style={{ fontSize:12.5, color:T.bright, fontWeight:t.unread?600:500 }}>
                            {t.unread && <span style={{ color:T.gmail, marginRight:5 }}>●</span>}
                            {(t.from || "").replace(/<.*>/, "").replace(/"/g,"").trim().slice(0, 30)}
                          </span>
                          {t.gmail_url && <i className="ti ti-arrow-up-right" style={{ fontSize:12, color:T.dim }} />}
                        </div>
                        <div style={{ fontSize:12, color:T.text, lineHeight:1.45 }}>{(t.subject || "(no subject)").slice(0, 80)}</div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
            {moreThanCap && (
              <button onClick={() => setShowAll(s => ({ ...s, loops: !s.loops }))}
                style={{ fontSize:11.5, color:T.muted, background:"transparent", border:`1px solid ${T.border}`,
                  borderRadius:8, padding:"7px 13px", marginTop:12, display:"inline-flex", alignItems:"center", gap:5, ...M }}>
                <i className={`ti ti-chevron-${exp?"up":"down"}`} style={{ fontSize:13 }} />
                {exp ? "show less" : `show all (${sOpen + eOpen})`}
              </button>
            )}
          </>
        )}
      </>
    );
  };

  // Standup — leadership / team toggle.
  const renderStandup = () => (
    <>
      <div style={{ display:"flex", gap:6, marginBottom:14 }}>
        {["leadership", "team"].map(m => (
          <button key={m} onClick={() => setSdMode(m)} style={{ fontSize:12, padding:"6px 14px", borderRadius:8,
            border:`1px solid ${sdMode===m?(m==="leadership"?T.blue:T.green)+"66":T.border}`,
            background:sdMode===m?(m==="leadership"?T.blueD:T.greenD):"transparent",
            color:sdMode===m?(m==="leadership"?T.blue:T.green):T.muted, fontWeight:sdMode===m?600:500, ...M }}>
            {m}
          </button>
        ))}
      </div>
      {sdMode === "leadership" && ["yesterday","today","blockers"].map(k => (
        <div key={k} style={{ marginBottom:14 }}>
          <div style={{ fontSize:10.5, fontWeight:600, color:{yesterday:T.muted,today:T.green,blockers:T.red}[k], letterSpacing:".09em", textTransform:"uppercase", marginBottom:7, ...MONO }}>{k}</div>
          {(standup?.leadership?.[k] || []).map((item, i) => (
            <div key={i} style={{ display:"flex", gap:9, marginBottom:7 }}>
              <span style={{ color:{yesterday:T.muted,today:T.green,blockers:T.red}[k], fontSize:12, flexShrink:0, marginTop:2 }}>•</span>
              <span style={{ fontSize:12.5, color:T.text, lineHeight:1.55 }}>{item}</span>
            </div>
          ))}
        </div>
      ))}
      {sdMode === "team" && (
        <div>
          {["yesterday","today"].map(k => (
            <div key={k} style={{ marginBottom:14 }}>
              <div style={{ fontSize:10.5, fontWeight:600, color:k==="today"?T.green:T.muted, letterSpacing:".09em", textTransform:"uppercase", marginBottom:7, ...MONO }}>{k}</div>
              {(standup?.team?.[k] || []).map((item, i) => (
                <div key={i} style={{ display:"flex", gap:9, marginBottom:7 }}>
                  <span style={{ color:k==="today"?T.green:T.muted, fontSize:12, flexShrink:0, marginTop:2 }}>•</span>
                  <span style={{ fontSize:12.5, color:T.text, lineHeight:1.55 }}>{item}</span>
                </div>
              ))}
            </div>
          ))}
          <div style={{ fontSize:10.5, fontWeight:600, color:T.amber, letterSpacing:".09em", textTransform:"uppercase", marginBottom:7, ...MONO }}>delegate</div>
          {(standup?.team?.delegate || []).map((item, i) => (
            <div key={i} style={{ display:"flex", gap:9, alignItems:"flex-start", background:T.bg, border:`1px solid ${T.border}`, borderRadius:8, padding:"9px 12px", marginBottom:5 }}>
              <span style={{ color:T.amber, fontSize:13, flexShrink:0 }}>→</span>
              <span style={{ fontSize:12.5, color:T.text, lineHeight:1.5 }}>{item}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (view === "team") return (
    <div style={{ background:T.bg, minHeight:"100vh", padding:"24px clamp(16px,4vw,40px) 60px", width:"100%", maxWidth:1480, margin:"0 auto", ...M }}>
      <style>{makeCss(T)}</style>
      <TeamManagement T={T} theme={theme} toggleTheme={toggleTheme} onBack={() => setView("cockpit")} />
    </div>
  );

  return (
    <div style={{ background:T.bg, minHeight:"100vh", padding:"24px clamp(16px,4vw,40px) 110px", width:"100%", maxWidth:1480, margin:"0 auto", ...M }}>
      <style>{makeCss(T)}</style>

      {/* Floating Learn-today — out of the way; glance only if you want to */}
      {lessons.length > 0 && (
        <div style={{ position:"fixed", bottom:20, left:20, zIndex:300 }}>
          {learnOpen && (
            <div className="fadeIn" style={{ position:"absolute", bottom:64, left:0, width:380,
              background:T.panel, border:`1px solid ${T.borderB}`, borderRadius:14, overflow:"hidden",
              boxShadow:`0 24px 48px rgba(0,0,0,.35)` }}>
              <div style={{ padding:"12px 15px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:8 }}>
                <i className="ti ti-bulb" style={{ fontSize:15, color:T.bright }} />
                <span style={{ fontSize:11, fontWeight:700, color:T.muted, letterSpacing:".14em", flex:1, ...MONO }}>LEARN TODAY · {lessons.length}</span>
                <button onClick={() => setLearnOpen(false)} style={{ background:"transparent", border:"none", color:T.dim, fontSize:14 }}><i className="ti ti-x" /></button>
              </div>
              <div style={{ maxHeight:460, overflowY:"auto" }}>
                {lessons.map((L, i) => (
                  <div key={i} style={{ padding:"13px 15px", borderBottom: i < lessons.length-1 ? `1px solid ${T.border}` : "none" }}>
                    <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:6 }}>
                      <span style={{ fontSize:10, fontWeight:700, color:T.dim, ...MONO }}>{String(i+1).padStart(2,"0")}</span>
                      <div style={{ fontSize:14, fontWeight:600, color:T.bright, lineHeight:1.3, flex:1 }}>{L.title}</div>
                      {L.category && <span style={{ fontSize:9.5, fontWeight:600, color:T.muted, background:T.cardHi, border:`1px solid ${T.border}`, borderRadius:5, padding:"2px 6px", ...MONO }}>{L.category}</span>}
                    </div>
                    <div style={{ fontSize:12.5, color:T.text, lineHeight:1.6, marginBottom:L.example?8:0 }}>{L.lesson}</div>
                    {L.example && (
                      <div style={{ fontSize:11.5, color:T.text, background:T.cardHi, border:`1px solid ${T.border}`,
                        borderRadius:8, padding:"8px 10px", margin:"0 0 8px", whiteSpace:"pre-wrap", lineHeight:1.5, ...MONO }}>{L.example}</div>
                    )}
                    {L.try_this && (
                      <div style={{ fontSize:12, color:T.muted, lineHeight:1.55 }}>
                        <span style={{ color:T.ok, fontWeight:700 }}>try today → </span>{L.try_this}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <button onClick={openLearn} title="Learn something new today"
            style={{ width:48, height:48, borderRadius:"50%", background:learnOpen?T.card:T.panel,
              border:`1px solid ${learnOpen?T.bright:T.borderB}`, color:T.bright, position:"relative",
              display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 18px rgba(0,0,0,.22)" }}>
            <i className={`ti ${learnOpen?"ti-x":"ti-bulb"}`} style={{ fontSize:20 }} />
            {!learnOpen && learnRead !== lessonsKey && (
              <span style={{ position:"absolute", top:9, right:9, width:9, height:9, borderRadius:"50%",
                background:T.ok, border:`2px solid ${T.panel}`, boxShadow:`0 0 8px ${T.ok}` }} />
            )}
          </button>
        </div>
      )}

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
          background:chatOpen?T.card:`linear-gradient(135deg, ${T.green}, ${T.cyan})`,
          border:chatOpen?`1px solid ${T.borderB}`:"none",
          color:chatOpen?T.muted:T.bg, display:"flex", alignItems:"center", justifyContent:"center",
          boxShadow:chatOpen?"none":`0 6px 22px ${T.green}55` }}>
          <i className={`ti ${chatOpen ? "ti-x" : "ti-sparkles"}`} style={{ fontSize:23, lineHeight:1 }} />
        </button>
        {!chatOpen && (
          <div style={{ position:"absolute", bottom:60, right:0, fontSize:9, color:T.dim,
            whiteSpace:"nowrap", background:T.panel, padding:"2px 6px", borderRadius:3,
            border:`1px solid ${T.border}`, ...M }}>⌘K</div>
        )}
      </div>

      {/* Masthead */}
      <header style={{ display:"flex", alignItems:"center", gap:13, flexWrap:"wrap",
        paddingBottom:15, borderBottom:`1px solid ${T.border}`, marginBottom:24 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:12 }}>
          <div style={{ fontSize:17, fontWeight:700, color:T.bright, letterSpacing:"0.04em" }}>FRIDAY</div>
          <span style={{ fontSize:11.5, color:T.dim, ...MONO }}>{dateStr} · {timeStr}</span>
        </div>

        <span style={{ flex:1, minWidth:12 }} />

        {/* connection dots */}
        <div style={{ display:"flex", alignItems:"center", gap:11 }}>
          {SERVICES.map(s => {
            const st = conns.find(c => c.provider === s.provider) || {};
            const on = !!st.connected;
            return (
              <span key={s.key} title={`${s.label}: ${on ? "connected" : "tap to connect"}`}
                onClick={() => on ? doDisconnect(s.provider) : doConnect(s.provider)}
                style={{ display:"inline-flex", alignItems:"center", gap:5, cursor:"pointer", color:on?T.bright:T.dim }}>
                <span style={{ width:6, height:6, borderRadius:"50%", background:on?T.ok:T.border, boxShadow:on?`0 0 5px ${T.ok}aa`:"none" }} />
                <i className={`ti ${s.icon}`} style={{ fontSize:14 }} />
              </span>
            );
          })}
        </div>
        {/* Team Management page */}
        <button onClick={() => setView("team")} title="Team Management"
          style={{ fontSize:12.5, padding:"7px 13px", borderRadius:9, border:`1px solid ${T.border}`, background:"transparent", color:T.muted, display:"inline-flex", alignItems:"center", gap:6, ...M }}>
          <i className="ti ti-users" style={{ fontSize:14 }} /> Team
        </button>
        {/* theme toggle */}
        <button onClick={toggleTheme} title={theme==="dark"?"Switch to light":"Switch to dark"}
          style={{ width:34, height:34, borderRadius:9, border:`1px solid ${T.border}`, background:"transparent",
            color:T.muted, display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
          <i className={`ti ${theme==="dark"?"ti-sun":"ti-moon"}`} style={{ fontSize:16 }} />
        </button>
        <button onClick={doSync} disabled={syncing} style={{ fontSize:12.5, padding:"8px 16px", fontWeight:600,
          background:T.bright, border:"none", borderRadius:9, color:T.bg, display:"inline-flex", alignItems:"center", gap:6,
          opacity:syncing?0.6:1, ...M }}>
          <i className={`ti ti-refresh ${syncing ? "spin" : ""}`} style={{ fontSize:13 }} />
          {syncing ? "syncing…" : "Sync"}
        </button>
      </header>

      {/* Contextual urgency strip — appears only when something is truly imminent or a P1 is hot */}
      {!offHours && hot && (topItem || nextEdge) && (
        <div className="urgpulse" style={{ display:"flex", alignItems:"center", gap:11, marginBottom:18,
          background:T.redD, border:`1px solid ${T.red}55`, borderRadius:10, padding:"11px 15px" }}>
          <i className="ti ti-bolt" style={{ fontSize:16, color:T.red, flexShrink:0 }} />
          <span style={{ flex:1, minWidth:0, fontSize:13.5, fontWeight:600, color:T.bright, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {topItem ? topItem.title : nextEdge.label}
          </span>
          {nextEdge && (
            <span style={{ fontSize:13, fontWeight:700, color:T.red, flexShrink:0, ...MONO }}>{fmtLeft(edgeMins)} · {nextEdge.label}</span>
          )}
        </div>
      )}

      {/* Lead — today's focus (left) + momentum panel (right) */}
      <section style={{ marginBottom:30, display:"grid", gridTemplateColumns:"minmax(0,1.6fr) minmax(0,1fr)", gap:"40px", alignItems:"start" }}>
        <div style={{ minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:9 }}>
            <span style={{ fontSize:11, fontWeight:600, color:T.muted, letterSpacing:".16em", textTransform:"uppercase", ...MONO }}>Today's Focus</span>
            <span style={{ fontSize:11, color:T.dim, ...MONO }}>as of {timeStr}</span>
          </div>
          <div style={{ fontSize:26, fontWeight:600, color:T.bright, lineHeight:1.3, letterSpacing:"-0.022em" }}>
            {summary?.focus_of_day || "Ready when you are."}{!summary?.focus_of_day && <Cursor />}
          </div>
          {summary?.risk_flag && (
            <div style={{ fontSize:13, color:T.red, marginTop:14, display:"flex", alignItems:"flex-start", gap:8, lineHeight:1.55 }}>
              <i className="ti ti-alert-triangle" style={{ fontSize:14, marginTop:2, flexShrink:0 }} />
              <span><b style={{ fontWeight:600 }}>Risk · </b>{summary.risk_flag}</span>
            </div>
          )}
        </div>

        {/* Momentum panel */}
        <div style={{ minWidth:0, background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"15px 17px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
            <span style={{ fontSize:10.5, fontWeight:700, color:T.muted, letterSpacing:".15em", textTransform:"uppercase", ...MONO }}>Momentum</span>
            <span style={{ flex:1 }} />
            <button onClick={refreshLoops} disabled={loopsBusy} title="Re-scan"
              style={{ background:"transparent", border:"none", color:T.dim, cursor:"pointer" }}>
              <i className={`ti ti-refresh ${loopsBusy?"spin":""}`} style={{ fontSize:13 }} />
            </button>
          </div>
          {(() => {
            const cleared = (loops?.summary?.slackClosed || 0) + (loops?.summary?.emailClosed || 0);
            const xp  = cleared * 10;
            const pct = Math.min(100, cleared * 20);
            const label = cleared >= 5 ? "on fire 🔥" : cleared >= 3 ? "momentum ⚡" : cleared >= 1 ? "rolling" : "warming up — clear a loop";
            return (
              <div>
                <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:9 }}>
                  <span style={{ fontSize:26, fontWeight:700, color:cleared>0?T.bright:T.dim, lineHeight:1, ...MONO }}>{cleared}</span>
                  <span style={{ fontSize:11.5, color:T.muted }}>loops cleared</span>
                  <span style={{ flex:1 }} />
                  <span style={{ fontSize:12, fontWeight:600, color:T.muted, ...MONO }}>{xp} XP</span>
                </div>
                <div style={{ height:5, background:T.border, borderRadius:3, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${pct}%`, background:cleared>0?T.ok:T.border, borderRadius:3, transition:"width .5s ease" }} />
                </div>
                <div style={{ fontSize:11, color:cleared>=3?T.ok:T.dim, marginTop:8, ...MONO }}>{label}</div>
              </div>
            );
          })()}
        </div>
      </section>

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

      {/* ── Main: Needs you  |  The day ── */}
      <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1.6fr) minmax(0,1fr)", gap:"40px", alignItems:"start" }}>

        {/* NEEDS YOU — headline feed */}
        <div style={{ minWidth:0 }}>
          <div style={SH}>
            <span style={SHk}>Needs You</span>
            <span style={SHc}>{importantItems.length}</span>
          </div>
          {importantItems.length === 0 && <Note>nothing needs you right now</Note>}
          {importantItems.map((u, i) => {
            const pc = prioC[u.prio] || prioC.P3;
            const key = `cu-${u.id ?? i}`;
            const open = expanded[key] ?? (i === 0);
            return (
              <div key={key} className="hovcard" style={{ background:T.card, border:`1px solid ${T.border}`,
                borderLeft:`3px solid ${u.prio==="P1"?T.red:T.border}`, borderRadius:12, marginBottom:11, overflow:"hidden" }}>
                <div onClick={() => setExpanded(e => ({ ...e, [key]: !open }))}
                  style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"15px 16px", cursor:"pointer" }}>
                  <span title={`priority ${u.prio}`} style={{ fontSize:10.5, fontWeight:700, color:pc[0], background:pc[1],
                    border:`1px solid ${pc[0]}33`, borderRadius:6, padding:"2px 7px", flexShrink:0, marginTop:1, ...MONO }}>{u.prio}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:15, fontWeight:600, color:T.bright, lineHeight:1.4 }}>{u.title}</div>
                    {!open && <div style={{ fontSize:12.5, color:T.dim, lineHeight:1.5, marginTop:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.detail}</div>}
                    {open && (
                      <div style={{ marginTop:9 }}>
                        <div style={{ fontSize:13.5, color:T.text, lineHeight:1.65 }}>{u.detail}</div>
                        <div onClick={e => e.stopPropagation()} style={{ display:"flex", alignItems:"center", gap:12, marginTop:8, flexWrap:"wrap" }}>
                          {u.slack_url && <SlackLnk url={u.slack_url} />}
                          {u.gmail_url && <MailLnk url={u.gmail_url} />}
                          {corrected[key] ? (
                            <span style={{ fontSize:11.5, color:T.ok, display:"inline-flex", alignItems:"center", gap:4 }}><i className="ti ti-check" /> thanks — FRIDAY will learn this</span>
                          ) : correcting === key ? (
                            <span style={{ display:"inline-flex", gap:6, flex:1, minWidth:210 }}>
                              <input autoFocus value={correctText} onChange={e => setCorrectText(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") sendCorrection(key, u); if (e.key === "Escape") setCorrecting(null); }}
                                placeholder="What's wrong? e.g. this is about lectures, not payouts"
                                style={{ flex:1, fontSize:12, padding:"5px 9px", borderRadius:7, border:`1px solid ${T.border}`, background:T.bg, color:T.text }} />
                              <button onClick={() => sendCorrection(key, u)} style={{ fontSize:12, padding:"5px 11px", borderRadius:7, border:"none", background:T.bright, color:T.bg, fontWeight:600 }}>Send</button>
                            </span>
                          ) : (
                            <button onClick={() => { setCorrecting(key); setCorrectText(""); }}
                              title="Report a wrong flag — FRIDAY will learn and correct over time"
                              style={{ fontSize:11, color:T.dim, background:"none", border:`1px solid ${T.border}`, borderRadius:6, padding:"3px 8px", display:"inline-flex", alignItems:"center", gap:4 }}>
                              <i className="ti ti-alert-circle" style={{ fontSize:12 }} /> flag wrong
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <i className={`ti ${srcStyle[u.source]?.icon || "ti-pencil"}`} title={u.source} style={{ fontSize:13, color:(srcStyle[u.source]||srcStyle.manual).color, flexShrink:0, marginTop:3 }} />
                  <i className={`ti ti-chevron-${open?"up":"down"}`} style={{ fontSize:14, color:T.dim, flexShrink:0, marginTop:3 }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* RAIL — who's waiting on you */}
        <div style={{ minWidth:0, position:"sticky", top:18 }}>
          <div style={SH}>
            <span style={SHk}>Waiting On You</span>
            {briefing?.stakeholder_followups?.length>0 && <span style={SHc}>{briefing.stakeholder_followups.length}</span>}
          </div>
          {!(briefing?.stakeholder_followups?.length) ? <Note>nobody's blocked on you</Note> :
            briefing.stakeholder_followups.map((f, i) => (
              <div key={i} style={{ display:"flex", gap:11, alignItems:"flex-start", padding:"12px 2px", borderBottom:`1px solid ${T.border}` }}>
                <div style={{ fontSize:11, fontWeight:700, color:T.muted, background:T.cardHi, padding:"4px 7px", borderRadius:5, flexShrink:0, ...MONO }}>
                  {(f.person || "?").split(" ").map(w => w[0]).join("").slice(0, 2)}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13.5, fontWeight:600, color:T.bright }}>{f.person}</div>
                  <div style={{ fontSize:12.5, color:T.text, margin:"2px 0", lineHeight:1.45 }}>{f.topic}</div>
                  <div style={{ fontSize:11, color:T.dim }}>since {f.waiting_since} · via {f.channel}</div>
                  {f.slack_url && <SlackLnk url={f.slack_url} />}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* ── Open loops ── */}
      <section style={{ marginTop:36, paddingTop:24, borderTop:`1px solid ${T.border}` }}>
        <div style={SH}><span style={SHk}>Open Loops</span><span style={SHc}>{sOpen+eOpen+mOpen}</span></div>
        {renderLoops()}
      </section>

      {/* Footer */}
      <div style={{ marginTop:24, paddingTop:14, borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
        <span style={{ display:"flex", gap:14, alignItems:"center" }}>
          <button onClick={() => setShowDirectives(true)} title="Standing priorities FRIDAY always keeps in mind"
            style={{ fontSize:11, color:T.muted, background:"transparent", border:"none", display:"inline-flex", alignItems:"center", gap:5, ...M }}>
            <i className="ti ti-flag-3" style={{ fontSize:13, color:T.amber }} />{directives.length} priorities
          </button>
          <button onClick={() => setShowFeedback(true)} title="Ideas & fixes you've logged for FRIDAY (⌘K → /feedback)"
            style={{ fontSize:11, color:T.muted, background:"transparent", border:"none", display:"inline-flex", alignItems:"center", gap:5, ...M }}>
            <i className="ti ti-message-report" style={{ fontSize:13, color:T.cyan }} />{feedback.filter(f=>f.status==="open").length} feedback
          </button>
          {memStats?.total > 0 && (
            <button onClick={() => profile && setShowProfile(true)} title={profile ? "View learned profile" : "Items FRIDAY has learned"}
              style={{ fontSize:11, color:T.muted, background:"transparent", border:"none", display:"inline-flex", alignItems:"center", gap:5, cursor:profile?"pointer":"default", ...M }}>
              <i className="ti ti-brain" style={{ fontSize:13, color:T.purple }} />{memStats.total} learned{profile ? " · profile" : ""}
            </button>
          )}
          {conns.some(c => c.provider === "google" && c.connected) && (
            <button onClick={openMemorySheet} title="Open FRIDAY's memory in Google Sheets"
              style={{ fontSize:11, color:T.muted, background:"transparent", border:"none", display:"inline-flex", alignItems:"center", gap:5, ...M }}>
              <i className="ti ti-table" style={{ fontSize:13, color:T.green }} />memory sheet
            </button>
          )}
        </span>
        <span style={{ display:"flex", gap:14, alignItems:"center" }}>
          {usage && (
            <span title={`Today's real Claude usage (from your subscription).\n${usage.calls} call${usage.calls===1?"":"s"} · ${usage.tokens.toLocaleString()} tokens · ~$${usage.cost.toFixed(2)} equiv.\nAuto-briefings: ${usage.autoGens}/${usage.autoCap} (cap). ~15.6k tokens/call is fixed Claude Code overhead.`}
              style={{ fontSize:10.5, display:"inline-flex", alignItems:"center", gap:5, ...MONO,
                color: usage.cost > 3 ? T.red : usage.cost > 1 ? T.amber : T.muted }}>
              <i className="ti ti-bolt" style={{ fontSize:12, color: usage.cost > 1 ? "currentColor" : T.green }} />
              {usage.tokens >= 1000 ? (usage.tokens/1000).toFixed(0)+"k" : usage.tokens} · ${usage.cost.toFixed(2)} · {usage.autoGens}/{usage.autoCap}
            </span>
          )}
          <span style={{ fontSize:10.5, color:T.dim, ...M }}>{lastSaved ? `synced ${lastSaved.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}` : ""} · ⌘K</span>
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

      {/* Feedback modal — collated ideas/fixes for FRIDAY */}
      {showFeedback && (
        <div onClick={() => setShowFeedback(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)",
          zIndex:400, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:T.panel, border:`1px solid ${T.cyan}44`, borderRadius:14,
            maxWidth:660, width:"100%", maxHeight:"82vh", overflowY:"auto", padding:"22px 24px", boxShadow:"0 24px 48px rgba(0,0,0,.7)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <span style={{ fontSize:12.5, fontWeight:700, color:T.cyan, letterSpacing:".1em", ...MONO }}>
                <i className="ti ti-message-report" style={{ marginRight:7 }} />FEEDBACK · THE BUILD LIST
              </span>
              <button onClick={() => setShowFeedback(false)} style={{ background:"transparent", border:"none", color:T.dim, fontSize:16 }}>
                <i className="ti ti-x" />
              </button>
            </div>
            <div style={{ fontSize:11.5, color:T.dim, marginBottom:14, lineHeight:1.6 }}>
              Every idea or fix you log (here or via <span style={{ color:T.cyan }}>⌘K → /feedback</span>) collects here, so we can shape FRIDAY over time. Tick what's shipped.
            </div>
            <div style={{ display:"flex", gap:6, marginBottom:16 }}>
              <input value={newFeedback} onChange={e => setNewFeedback(e.target.value)}
                onKeyDown={async e => { if (e.key === "Enter" && newFeedback.trim()) { const t = newFeedback.trim(); setNewFeedback(""); try { const r = await api.addFeedback(t); setFeedback(r.feedback || []); } catch {} } }}
                placeholder="add an idea or fix…" style={{ flex:1 }} />
              <button onClick={async () => { const t = newFeedback.trim(); if (!t) return; setNewFeedback(""); try { const r = await api.addFeedback(t); setFeedback(r.feedback || []); } catch {} }}
                style={{ padding:"9px 16px", background:T.cyan, border:"none", borderRadius:8, color:T.bg, fontWeight:600, fontSize:12.5, ...M }}>add</button>
            </div>
            {feedback.length === 0
              ? <Note>nothing logged yet — try ⌘K then /feedback your-idea</Note>
              : feedback.map(f => {
                  const done = f.status === "done";
                  return (
                    <div key={f.id} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"10px 0", borderBottom:`1px solid ${T.border}44`, opacity:done?0.5:1 }}>
                      <button onClick={async () => { try { const r = await api.doneFeedback(f.id, done?"open":"done"); setFeedback(r.feedback || []); } catch {} }}
                        title={done?"Reopen":"Mark shipped"}
                        style={{ width:18, height:18, marginTop:1, borderRadius:5, border:`1.5px solid ${done?T.green:T.borderB}`,
                          background:done?T.greenD:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:T.green, fontSize:11 }}>
                        {done && "✓"}
                      </button>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, color:done?T.dim:T.text, lineHeight:1.55, textDecoration:done?"line-through":"none" }}>{f.text}</div>
                        <div style={{ fontSize:10, color:T.dim, marginTop:3, ...MONO }}>{new Date(f.created_at).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}</div>
                      </div>
                      <button onClick={async () => { try { const r = await api.deleteFeedback(f.id); setFeedback(r.feedback || []); } catch {} }} title="Delete"
                        style={{ background:"transparent", border:"none", color:T.dim, fontSize:13, flexShrink:0 }}>
                        <i className="ti ti-trash" />
                      </button>
                    </div>
                  );
                })
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
